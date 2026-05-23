import { canonicalObjectLabel } from "./objectLabelUtils.js";

const FOLLOW_MODES = new Set(["cautious", "gentle", "curious"]);
const FOLLOW_POSITION_LOG_INTERVAL_MS = 600;
const DEFAULT_FOLLOW_CENTER_X = 0.5;
const DEFAULT_FOLLOW_CENTER_DEADBAND = 0.115;
const DEFAULT_FOLLOW_STEER_GAIN = 0.9;
const DEFAULT_MAX_FOLLOW_ANGULAR = 0.036;
const FOLLOW_STALE_GRACE_MS = 700;
const DEFAULT_FOLLOW_COMMAND_DURATION_MS = 30;
const DEFAULT_FOLLOW_COMMAND_REFRESH_MS = 70;

export class FollowTargetController {
  constructor({
    visionState,
    objectTracker,
    lifeEngine,
    commandQueue,
    eventBus,
    getPolicy,
    logger,
    tickMs = 50,
    lostTimeoutMs = 2000
  } = {}) {
    this.visionState = visionState;
    this.objectTracker = objectTracker;
    this.lifeEngine = lifeEngine;
    this.commandQueue = commandQueue;
    this.eventBus = eventBus;
    this.getPolicy = getPolicy;
    this.logger = logger;
    this.tickMs = clampNumber(tickMs, 20, 1000, 50);
    this.lostTimeoutMs = clampNumber(lostTimeoutMs, 500, 8000, 2000);
    this.running = false;
    this.targetLabel = null;
    this.targetTrackId = null;
    this.mode = "gentle";
    this.timer = null;
    this.lastSteeringAt = 0;
    this.lastSeenAt = null;
    this.lostAnnounced = false;
    this.paused = false;
    this.lastSteering = null;
    this.followMotionActive = false;
    this.lastMovementHeldReason = null;
    this.lastPositionLogAt = 0;
    this.lastStaleLogAt = 0;
  }

  start({ label, trackId = null, mode = "gentle" } = {}) {
    const targetLabel = canonicalObjectLabel(label);

    if (!targetLabel && !trackId) {
      return {
        ok: false,
        reason: "missing_target"
      };
    }

    this.targetLabel = targetLabel || this.targetLabel;
    this.targetTrackId = trackId ?? this.targetTrackId;
    this.mode = FOLLOW_MODES.has(mode) ? mode : "gentle";
    this.running = true;
    this.paused = false;
    this.lostAnnounced = false;
    this.lastSteeringAt = 0;
    this.lastSteering = null;
    this.followMotionActive = false;
    this.lastMovementHeldReason = null;
    this.lastSeenAt = Date.now();
    this.visionState?.setActiveTarget?.({
      label: this.targetLabel,
      trackId: this.targetTrackId
    });
    this.visionState?.setScenario?.({
      active: true,
      type: "follow_object",
      targetLabel: this.targetLabel,
      targetTrackId: this.targetTrackId,
      state: "following",
      lostSince: null,
      reason: "follow_started"
    });
    this.eventBus?.publish?.("vision_follow_started", this.getTarget(), { source: "vision" });
    this.log(`[roboflow] follow started target=${this.targetLabel} track=${this.targetTrackId ?? "none"} mode=${this.mode}`);
    this.scheduleTick();
    return {
      ok: true,
      target: this.getTarget()
    };
  }

  stop(reason = "follow_stop") {
    const wasRunning = this.running;
    this.running = false;
    this.paused = false;
    this.clearTimer();
    this.stopMotion(reason);
    this.visionState?.clearActiveTarget?.(reason);
    this.eventBus?.publish?.("vision_follow_stopped", {
      reason,
      targetLabel: this.targetLabel,
      targetTrackId: this.targetTrackId,
      wasRunning
    }, { source: "vision" });
    this.targetLabel = null;
    this.targetTrackId = null;
    this.lastSteering = null;
    this.followMotionActive = false;
    this.lastMovementHeldReason = null;
    this.log(`[roboflow] follow stopped reason=${reason}`);
    return {
      ok: true,
      reason,
      wasRunning
    };
  }

  pause(reason = "follow_pause") {
    this.paused = true;
    this.stopMotion(reason);
  }

  resume(reason = "follow_resume") {
    if (!this.running) {
      return;
    }

    this.paused = false;
    this.eventBus?.publish?.("vision_follow_resumed", { reason, target: this.getTarget() }, { source: "vision" });
  }

  tick() {
    if (!this.running || this.paused) {
      return this.getStatus();
    }

    const track = this.resolveTrack();
    const lostForMs = this.computeLostForMs(track);
    const targetVisibleNow = Boolean(track && track.visible && !track.lostAt && lostForMs < FOLLOW_STALE_GRACE_MS);

    if (!targetVisibleNow) {
      if (track?.visible && lostForMs < this.lostTimeoutMs) {
        this.handleTargetStale(track, lostForMs);
        return this.getStatus();
      }

      this.handleTargetLost(lostForMs);
      return this.getStatus();
    }

    this.lastSeenAt = Date.now();
    this.lostAnnounced = false;
    this.visionState?.setActiveTarget?.({
      label: track.label,
      trackId: track.id
    });
    this.visionState?.setScenario?.({
      active: true,
      type: "follow_object",
      targetLabel: track.label,
      targetTrackId: track.id,
      state: "following",
      lostSince: null,
      reason: "target_visible"
    });

    const steering = this.computeSteeringForTarget(track);
    this.logTargetPosition(track, steering);
    this.lastSteering = steering;

    if (steering.centered) {
      this.stopMotion("follow_target_centered");
      return this.getStatus();
    }

    const permission = this.canMove();
    if (!permission.allowed) {
      this.lastMovementHeldReason = permission.reason;
      this.handleMovementBlocked(permission.reason);
      this.log(`[roboflow] follow steering held target=${track.label} direction=${steering.direction} reason=${permission.reason}`, "debug");
      return {
        ...this.getStatus(),
        steeringHeldReason: permission.reason
      };
    }
    this.lastMovementHeldReason = null;

    const now = Date.now();
    const tuning = this.getTuning();
    if (now - this.lastSteeringAt < tuning.commandRefreshMs) {
      return this.getStatus();
    }

    this.lastSteeringAt = now;
    this.sendSteeringCommand(steering, track);
    return {
      ...this.getStatus(),
      lastSteering: steering
    };
  }

  getTarget() {
    return {
      label: this.targetLabel,
      trackId: this.targetTrackId,
      mode: this.mode
    };
  }

  getStatus() {
    const permission = this.canMove();

    return {
      running: this.running,
      targetLabel: this.targetLabel,
      targetTrackId: this.targetTrackId,
      mode: this.mode,
      tickMs: this.tickMs,
      lostTimeoutMs: this.lostTimeoutMs,
      lastSteeringAt: this.lastSteeringAt,
      lastSeenAt: this.lastSeenAt,
      lostAnnounced: this.lostAnnounced,
      paused: this.paused,
      tuning: this.getTuning(),
      lastSteering: this.lastSteering,
      followMotionActive: this.followMotionActive,
      motionAllowed: permission.allowed,
      motionHeldReason: permission.allowed ? null : this.lastMovementHeldReason ?? permission.reason
    };
  }

  isRunning() {
    return Boolean(this.running);
  }

  setRobotInterfaces({ commandQueue, lifeEngine } = {}) {
    if (commandQueue) {
      this.commandQueue = commandQueue;
    }

    if (lifeEngine) {
      this.lifeEngine = lifeEngine;
    }
  }

  computeSteeringForTarget(track = {}) {
    const tuning = this.getTuning();
    const centerX = clampNumber(track.centerX, 0, 1, tuning.targetCenterX);
    const errorX = centerX - tuning.targetCenterX;
    const absErrorX = Math.abs(errorX);

    if (absErrorX <= tuning.centerDeadband) {
      return {
        centered: true,
        direction: "centered",
        centerX,
        targetCenterX: tuning.targetCenterX,
        errorX,
        absErrorX,
        angular: 0,
        maxAngular: tuning.maxAngular,
        deadband: tuning.centerDeadband,
        commandDurationMs: tuning.commandDurationMs,
        commandRefreshMs: tuning.commandRefreshMs
      };
    }

    const angular = (errorX < 0 ? -1 : 1) * tuning.maxAngular;

    return {
      centered: false,
      direction: errorX < 0 ? "left" : "right",
      centerX,
      targetCenterX: tuning.targetCenterX,
      errorX,
      absErrorX,
      angular,
      maxAngular: tuning.maxAngular,
      deadband: tuning.centerDeadband,
      commandDurationMs: tuning.commandDurationMs,
      commandRefreshMs: tuning.commandRefreshMs
    };
  }

  getTuning() {
    const policy = this.policy();

    return {
      targetCenterX: clampNumber(policy.followTargetCenterX, 0.25, 0.75, DEFAULT_FOLLOW_CENTER_X),
      centerDeadband: clampNumber(policy.followCenterDeadband, 0.005, 0.2, DEFAULT_FOLLOW_CENTER_DEADBAND),
      steerGain: clampNumber(policy.followSteerGain, 0.05, 2.5, DEFAULT_FOLLOW_STEER_GAIN),
      maxAngular: clampNumber(policy.maxObjectFollowSpeed, 0, 0.12, DEFAULT_MAX_FOLLOW_ANGULAR),
      commandDurationMs: clampNumber(policy.followCommandDurationMs, 0, 600, DEFAULT_FOLLOW_COMMAND_DURATION_MS),
      commandRefreshMs: clampNumber(policy.followCommandRefreshMs, 0, 300, DEFAULT_FOLLOW_COMMAND_REFRESH_MS)
    };
  }

  logTargetPosition(track = {}, steering = null) {
    const now = Date.now();
    if (now - this.lastPositionLogAt < FOLLOW_POSITION_LOG_INTERVAL_MS) {
      return;
    }

    this.lastPositionLogAt = now;
    const centerX = clampNumber(track.centerX, 0, 1, 0.5);
    const centerY = clampNumber(track.centerY, 0, 1, 0.5);
    const bbox = track.bbox && typeof track.bbox === "object" ? track.bbox : {};
    const bboxText = [
      formatPixel(bbox.x),
      formatPixel(bbox.y),
      formatPixel(bbox.width),
      formatPixel(bbox.height)
    ].join(",");
    const direction = steering?.direction ?? "centered";
    const angular = Number.isFinite(Number(steering?.angular)) ? Number(steering.angular) : 0;
    const targetCenterX = Number.isFinite(Number(steering?.targetCenterX))
      ? Number(steering.targetCenterX)
      : this.getTuning().targetCenterX;

    this.log(
      `[roboflow] follow target position label=${track.label ?? this.targetLabel ?? "unknown"} track=${track.id ?? this.targetTrackId ?? "none"} center=(${formatNumber(centerX)},${formatNumber(centerY)}) targetX=${formatNumber(targetCenterX)} errorX=${formatNumber(centerX - targetCenterX)} area=${formatNumber(track.areaRatio)} bbox=(${bboxText}) steering=${direction} angular=${formatNumber(angular)}`,
      "debug"
    );
  }

  sendSteeringCommand(steering, track = {}) {
    const command = {
      linear: 0,
      angular: steering.angular,
      durationMs: this.getTuning().commandDurationMs,
      rampMs: 0,
      label: `roboflow_follow_turn_${steering.direction}`,
      log: false
    };
    const sender = this.commandQueue?.sendRealtimeMotion ?? this.commandQueue?.enqueueMotion;

    if (typeof sender !== "function") {
      this.log("[roboflow] follow steering skipped reason=motion_sender_unavailable", "warn");
      return;
    }

    this.followMotionActive = true;
    Promise.resolve(sender.call(this.commandQueue, command)).catch((error) => {
      this.followMotionActive = false;
      this.log(`[roboflow] follow steering failed target=${track.label ?? this.targetLabel} error=${error.message}`, "warn");
    });
  }

  handleTargetLost(lostForMs) {
    this.stopMotion("follow_target_lost");

    const label = this.targetLabel ?? "object";
    const lostSince = this.lastSeenAt ? new Date(this.lastSeenAt).toISOString() : new Date().toISOString();
    this.visionState?.setScenario?.({
      active: true,
      type: "follow_object",
      targetLabel: label,
      targetTrackId: this.targetTrackId,
      state: lostForMs >= this.lostTimeoutMs ? "lost" : "searching",
      lostSince,
      reason: "target_lost"
    });

    if (lostForMs < this.lostTimeoutMs || this.lostAnnounced) {
      return;
    }

    this.lostAnnounced = true;
    this.log(`[roboflow] target lost label=${label} lostForMs=${Math.round(lostForMs)}`, "warn");
    this.eventBus?.publish?.("vision_target_lost", {
      label,
      targetLabel: label,
      lostForMs
    }, { source: "vision", priority: 4 });
  }

  handleTargetStale(track = {}, lostForMs = 0) {
    this.stopMotion("follow_target_stale_frame");
    this.visionState?.setScenario?.({
      active: true,
      type: "follow_object",
      targetLabel: track.label ?? this.targetLabel,
      targetTrackId: this.targetTrackId,
      state: "following",
      lostSince: null,
      reason: "target_frame_stale"
    });
    const now = Date.now();
    if (now - this.lastStaleLogAt < FOLLOW_POSITION_LOG_INTERVAL_MS) {
      return;
    }

    this.lastStaleLogAt = now;
    this.log(
      `[roboflow] follow holding stale target label=${track.label ?? this.targetLabel ?? "object"} track=${track.id ?? this.targetTrackId ?? "none"} staleForMs=${Math.round(lostForMs)}`,
      "debug"
    );
  }

  setTarget(labelOrTrack) {
    if (typeof labelOrTrack === "string") {
      this.targetLabel = canonicalObjectLabel(labelOrTrack);
      this.targetTrackId = null;
      return this.getTarget();
    }

    if (labelOrTrack && typeof labelOrTrack === "object") {
      this.targetLabel = canonicalObjectLabel(labelOrTrack.label) || this.targetLabel;
      this.targetTrackId = labelOrTrack.id ?? labelOrTrack.trackId ?? this.targetTrackId;
    }

    return this.getTarget();
  }

  resolveTrack() {
    let trackById = null;

    if (this.targetTrackId) {
      trackById = this.objectTracker?.getTrackById?.(this.targetTrackId);
      if (isFreshTrack(trackById)) {
        return trackById;
      }
    }

    if (this.targetLabel) {
      const byLabel = this.objectTracker?.findBestTrackByLabel?.(this.targetLabel);
      if (byLabel) {
        if (trackById && byLabel.id !== trackById.id && isFreshTrack(byLabel)) {
          this.log(
            `[roboflow] follow switched track label=${byLabel.label} from=${trackById.id ?? "none"} to=${byLabel.id ?? "none"} reason=stale_duplicate_track`,
            "debug"
          );
        }
        this.targetTrackId = byLabel.id ?? byLabel.trackId ?? this.targetTrackId;
        return byLabel;
      }
    }

    return trackById ?? null;
  }

  computeLostForMs(track) {
    if (track?.lostForMs) {
      return Number(track.lostForMs);
    }

    const lastSeenAt = Number(track?.lastSeenAt ?? this.lastSeenAt ?? 0);
    return lastSeenAt ? Math.max(0, Date.now() - lastSeenAt) : this.lostTimeoutMs;
  }

  canMove() {
    const policy = this.policy();
    const lifeState = this.lifeEngine?.getState?.() ?? {};

    if (!policy.localMotionArmed) {
      return { allowed: false, reason: "local_motion_disarmed" };
    }

    if (!policy.followModeArmed) {
      return { allowed: false, reason: "follow_mode_disarmed" };
    }

    if (!policy.allowFollowMovement) {
      return { allowed: false, reason: "follow_movement_disallowed" };
    }

    if (!policy.robotConnected) {
      return { allowed: false, reason: "robot_not_connected" };
    }

    if (lifeState.obstacle) {
      return { allowed: false, reason: "obstacle_active" };
    }

    if (this.isCommandQueueBusy()) {
      return { allowed: false, reason: "command_queue_busy" };
    }

    return { allowed: true, reason: "ok" };
  }

  isCommandQueueBusy() {
    return Boolean(this.commandQueue?.isBusy?.()) || Number(this.commandQueue?.getQueueLength?.() ?? 0) > 0;
  }

  handleMovementBlocked(reason) {
    if (reason === "command_queue_busy") {
      return;
    }

    this.stopMotion(`follow_blocked:${reason}`, { allowWhileCommandBusy: true });
  }

  stopMotion(reason, { allowWhileCommandBusy = false } = {}) {
    if (!this.followMotionActive) {
      return;
    }

    if (this.isCommandQueueBusy() && !allowWhileCommandBusy) {
      this.followMotionActive = false;
      return;
    }

    this.followMotionActive = false;
    const stop = this.commandQueue?.sendRealtimeStop ?? this.commandQueue?.stopMotion ?? this.commandQueue?.cancelMotion;
    stop?.call?.(this.commandQueue, reason, { log: false })?.catch?.((error) => {
      this.log(`Follow stop failed: ${error.message}`, "warn");
    });
  }

  scheduleTick() {
    this.clearTimer();
    this.timer = globalThis.setInterval(() => {
      this.tick();
    }, this.tickMs);
  }

  clearTimer() {
    if (this.timer) {
      globalThis.clearInterval(this.timer);
      this.timer = null;
    }
  }

  policy() {
    return {
      localMotionArmed: false,
      followModeArmed: false,
      allowFollowMovement: false,
      localSpeechAllowed: true,
      robotConnected: false,
      followTargetCenterX: DEFAULT_FOLLOW_CENTER_X,
      followCenterDeadband: DEFAULT_FOLLOW_CENTER_DEADBAND,
      followSteerGain: DEFAULT_FOLLOW_STEER_GAIN,
      maxObjectFollowSpeed: DEFAULT_MAX_FOLLOW_ANGULAR,
      followCommandDurationMs: DEFAULT_FOLLOW_COMMAND_DURATION_MS,
      followCommandRefreshMs: DEFAULT_FOLLOW_COMMAND_REFRESH_MS,
      ...(typeof this.getPolicy === "function" ? this.getPolicy() : {})
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`${message}`, level);
    }
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "unknown";
}

function formatPixel(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : "unknown";
}

function isFreshTrack(track) {
  return Boolean(track && track.visible && !track.lostAt);
}
