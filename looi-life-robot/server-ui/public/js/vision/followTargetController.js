import { clampNumber } from "../core/runtimeUtils.js";
import { canonicalObjectLabel } from "./objectLabelUtils.js";

const FOLLOW_MODES = new Set(["cautious", "gentle", "curious"]);
const FOLLOW_POSITION_LOG_INTERVAL_MS = 600;
const DEFAULT_FOLLOW_CENTER_X = 0.5;
const DEFAULT_FOLLOW_CENTER_DEADBAND = 0.14;
const DEFAULT_FOLLOW_STEER_GAIN = 0.9;
const DEFAULT_MAX_FOLLOW_ANGULAR = 0.2;
const DEFAULT_FOLLOW_LOST_TIMEOUT_MS = 3000;
const DEFAULT_FOLLOW_COMMAND_DURATION_MS = 300;
const DEFAULT_FOLLOW_COMMAND_REFRESH_MS = 100;
const DEFAULT_FOLLOW_MAX_DETECTION_AGE_MS = 300;

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
    lostTimeoutMs = DEFAULT_FOLLOW_LOST_TIMEOUT_MS
  } = {}) {
    this.visionState = visionState;
    this.objectTracker = objectTracker;
    this.lifeEngine = lifeEngine;
    this.commandQueue = commandQueue;
    this.eventBus = eventBus;
    this.getPolicy = getPolicy;
    this.logger = logger;
    this.tickMs = clampNumber(tickMs, 20, 1000, 50);
    this.lostTimeoutMs = clampNumber(lostTimeoutMs, 500, 8000, DEFAULT_FOLLOW_LOST_TIMEOUT_MS);
    this.running = false;
    this.targetLabel = null;
    this.targetTrackId = null;
    this.mode = "gentle";
    this.state = "idle";
    this.targetVisible = false;
    this.lostForMs = 0;
    this.lostSince = null;
    this.timer = null;
    this.lastSteeringAt = 0;
    this.lastSeenAt = null;
    this.lostAnnounced = false;
    this.lastSteering = null;
    this.followMotionActive = false;
    this.lastMovementHeldReason = null;
    this.lastPositionLogAt = 0;
    this.lastStaleLogAt = 0;
    this.lastCommandLogAt = 0;
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
    const startingTrack = trackId
      ? this.objectTracker?.getTrackById?.(trackId)
      : this.objectTracker?.findBestTrackByLabel?.(targetLabel);
    const startingVisible = isFreshTrack(startingTrack);

    this.running = true;
    this.lostAnnounced = false;
    this.state = startingVisible ? "following" : "searching";
    this.targetVisible = startingVisible;
    this.lostForMs = startingVisible ? 0 : this.lostTimeoutMs;
    this.lostSince = startingVisible ? null : new Date().toISOString();
    this.lastSteeringAt = 0;
    this.lastSteering = null;
    this.followMotionActive = false;
    this.lastMovementHeldReason = null;
    this.lastCommandLogAt = 0;
    this.lastSeenAt = startingVisible ? Date.now() : null;
    this.targetTrackId = startingTrack?.id ?? startingTrack?.trackId ?? this.targetTrackId;
    this.updateVisionMirror("follow_started");
    this.eventBus?.publish?.("vision_follow_started", this.getTarget(), { source: "vision" });
    this.log(
      `[roboflow] follow started target=${this.targetLabel} track=${this.targetTrackId ?? "none"} state=${this.state} mode=${this.mode} lostTimeout=${Math.round(this.lostTimeoutMs)}ms ${formatTuningForLog(this.getTuning())}`
    );
    this.scheduleTick();
    return {
      ok: true,
      target: this.getTarget()
    };
  }

  stop(reason = "follow_stop") {
    const wasRunning = this.running;
    this.running = false;
    this.state = "idle";
    this.targetVisible = false;
    this.lostForMs = 0;
    this.lostSince = null;
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
    this.lastCommandLogAt = 0;
    this.log(`[roboflow] follow stopped reason=${reason}`);
    return {
      ok: true,
      reason,
      wasRunning
    };
  }

  tick() {
    if (!this.running) {
      return this.getStatus();
    }

    const track = this.resolveTrack();
    const lostForMs = this.computeLostForMs(track);
    const targetVisibleNow = isFreshTrack(track);

    if (!targetVisibleNow) {
      if (lostForMs < this.lostTimeoutMs) {
        this.handleTargetSearching(track, lostForMs);
        return this.getStatus();
      }

      this.handleTargetLost(lostForMs);
      return this.getStatus();
    }

    const tuning = this.getTuning();
    const detectionAgeMs = this.computeTrackAgeMs(track);
    if (detectionAgeMs > tuning.maxDetectionAgeMs) {
      this.handleTargetStale(track, detectionAgeMs, tuning);
      return this.getStatus();
    }

    this.lastSeenAt = Number(track?.lastSeenAt) || Date.now();
    this.targetLabel = track.label ?? this.targetLabel;
    this.targetTrackId = track.id ?? track.trackId ?? this.targetTrackId;
    this.targetVisible = true;
    this.lostForMs = 0;
    this.lostSince = null;
    const wasLost = this.state === "lost" || this.lostAnnounced;
    this.state = "following";
    this.updateVisionMirror("target_visible");

    if (wasLost) {
      this.lostAnnounced = false;
      this.log(`[roboflow] target reacquired label=${this.targetLabel} track=${this.targetTrackId ?? "none"}`);
      this.eventBus?.publish?.("vision_target_reacquired", {
        label: this.targetLabel,
        targetLabel: this.targetLabel,
        trackId: this.targetTrackId
      }, { source: "vision", priority: 4 });
    } else {
      this.lostAnnounced = false;
    }

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
      state: this.state,
      targetVisible: this.targetVisible,
      lostForMs: this.lostForMs,
      lostSince: this.lostSince,
      lastSteeringAt: this.lastSteeringAt,
      lastSeenAt: this.lastSeenAt,
      lostAnnounced: this.lostAnnounced,
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
      maxAngular: clampNumber(policy.maxObjectFollowSpeed, 0, 0.25, DEFAULT_MAX_FOLLOW_ANGULAR),
      commandDurationMs: clampNumber(policy.followCommandDurationMs, 0, 600, DEFAULT_FOLLOW_COMMAND_DURATION_MS),
      commandRefreshMs: clampNumber(policy.followCommandRefreshMs, 0, 300, DEFAULT_FOLLOW_COMMAND_REFRESH_MS),
      maxDetectionAgeMs: clampNumber(policy.followMaxDetectionAgeMs, 40, 3000, DEFAULT_FOLLOW_MAX_DETECTION_AGE_MS)
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
    const tuning = this.getTuning();
    const command = {
      linear: 0,
      angular: steering.angular,
      durationMs: tuning.commandDurationMs,
      rampMs: 0,
      label: `roboflow_follow_turn_${steering.direction}`,
      source: "roboflow_follow",
      targetLabel: track.label ?? this.targetLabel ?? "",
      direction: steering.direction,
      followIntervalMs: tuning.commandRefreshMs,
      followTolerance: tuning.centerDeadband,
      log: false
    };
    const sender = this.commandQueue?.sendRealtimeMotion ?? this.commandQueue?.enqueueMotion;

    if (typeof sender !== "function") {
      this.log("[roboflow] follow steering skipped reason=motion_sender_unavailable", "warn");
      return;
    }

    this.followMotionActive = true;
    const shouldLog = Date.now() - this.lastCommandLogAt >= FOLLOW_POSITION_LOG_INTERVAL_MS;
    if (shouldLog) {
      this.lastCommandLogAt = Date.now();
    }

    Promise.resolve(sender.call(this.commandQueue, command)).then(() => {
      if (shouldLog) {
        this.log(
          `[roboflow] follow steering sent target=${track.label ?? this.targetLabel ?? "unknown"} direction=${steering.direction} angular=${formatNumber(command.angular)} duration=${Math.round(command.durationMs)}ms interval=${Math.round(tuning.commandRefreshMs)}ms tolerance=${formatNumber(tuning.centerDeadband)}`,
          "debug"
        );
      }
    }).catch((error) => {
      this.followMotionActive = false;
      this.log(`[roboflow] follow steering failed target=${track.label ?? this.targetLabel} error=${error.message}`, "warn");
    });
  }

  handleTargetLost(lostForMs) {
    this.stopMotion("follow_target_lost");

    const label = this.targetLabel ?? "object";
    this.state = "lost";
    this.targetVisible = false;
    this.lostForMs = lostForMs;
    this.lostSince = this.lostSince ?? (this.lastSeenAt ? new Date(this.lastSeenAt).toISOString() : new Date().toISOString());
    this.updateVisionMirror("target_lost");

    if (this.lostAnnounced) {
      return;
    }

    this.lostAnnounced = true;
    this.log(`[roboflow] target lost label=${label} lostForMs=${Math.round(lostForMs)} state=lost`, "warn");
    this.eventBus?.publish?.("vision_target_lost", {
      label,
      targetLabel: label,
      lostForMs
    }, { source: "vision", priority: 4 });
  }

  handleTargetSearching(track = {}, lostForMs = 0) {
    this.stopMotion("follow_target_searching");
    this.state = "searching";
    this.targetVisible = false;
    this.lostForMs = lostForMs;
    this.lostSince = this.lostSince ?? (this.lastSeenAt ? new Date(this.lastSeenAt).toISOString() : new Date().toISOString());
    this.updateVisionMirror("target_searching");

    const now = Date.now();
    if (now - this.lastStaleLogAt < FOLLOW_POSITION_LOG_INTERVAL_MS) {
      return;
    }

    this.lastStaleLogAt = now;
    this.log(
      `[roboflow] follow searching target=${track?.label ?? this.targetLabel ?? "object"} track=${track?.id ?? this.targetTrackId ?? "none"} lostForMs=${Math.round(lostForMs)} notifyAfter=${Math.round(this.lostTimeoutMs)}ms`,
      "debug"
    );
  }

  handleTargetStale(track = {}, ageMs = 0, tuning = this.getTuning()) {
    this.stopMotion("follow_detection_stale");
    this.state = "searching";
    this.targetVisible = false;
    this.lostForMs = ageMs;
    this.lostSince = this.lostSince ?? (track?.lastSeenAt ? new Date(track.lastSeenAt).toISOString() : new Date().toISOString());
    this.updateVisionMirror("target_stale");

    const now = Date.now();
    if (now - this.lastStaleLogAt < FOLLOW_POSITION_LOG_INTERVAL_MS) {
      return;
    }

    this.lastStaleLogAt = now;
    this.log(
      `[roboflow] follow hold stale target=${track?.label ?? this.targetLabel ?? "object"} track=${track?.id ?? this.targetTrackId ?? "none"} detectionAge=${Math.round(ageMs)}ms maxAge=${Math.round(tuning.maxDetectionAgeMs)}ms`,
      "debug"
    );
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
    const trackLostForMs = Number(track?.lostForMs);
    if (Number.isFinite(trackLostForMs)) {
      return trackLostForMs;
    }

    const lastSeenAt = Number(track?.lastSeenAt ?? this.lastSeenAt ?? 0);
    return lastSeenAt ? Math.max(0, Date.now() - lastSeenAt) : this.lostTimeoutMs;
  }

  computeTrackAgeMs(track = {}) {
    const trackLostForMs = Number(track?.lostForMs);
    if (Number.isFinite(trackLostForMs)) {
      return Math.max(0, trackLostForMs);
    }

    const lastSeenAt = Number(track?.lastSeenAt ?? 0);
    return lastSeenAt ? Math.max(0, Date.now() - lastSeenAt) : Number.POSITIVE_INFINITY;
  }

  updateVisionMirror(reason = "follow_state") {
    if (this.running && this.targetLabel) {
      this.visionState?.setActiveTarget?.({
        label: this.targetLabel,
        trackId: this.targetTrackId,
        visible: this.targetVisible,
        lostForMs: this.lostForMs,
        lastSeenAt: this.lastSeenAt
      });
      this.visionState?.setScenario?.({
        active: true,
        type: "follow_object",
        targetLabel: this.targetLabel,
        targetTrackId: this.targetTrackId,
        state: this.state,
        lostSince: this.lostSince,
        reason
      });
    }
  }

  canMove() {
    const policy = this.policy();
    const lifeState = this.lifeEngine?.getState?.() ?? {};

    if (!policy.localMotionArmed) {
      return { allowed: false, reason: "local_motion_disarmed" };
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
      robotConnected: false,
      followTargetCenterX: DEFAULT_FOLLOW_CENTER_X,
      followCenterDeadband: DEFAULT_FOLLOW_CENTER_DEADBAND,
      followSteerGain: DEFAULT_FOLLOW_STEER_GAIN,
      maxObjectFollowSpeed: DEFAULT_MAX_FOLLOW_ANGULAR,
      followCommandDurationMs: DEFAULT_FOLLOW_COMMAND_DURATION_MS,
      followCommandRefreshMs: DEFAULT_FOLLOW_COMMAND_REFRESH_MS,
      followMaxDetectionAgeMs: DEFAULT_FOLLOW_MAX_DETECTION_AGE_MS,
      ...(typeof this.getPolicy === "function" ? this.getPolicy() : {})
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`${message}`, level);
    }
  }
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "unknown";
}

function formatPixel(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.round(numeric)) : "unknown";
}

function formatTuningForLog(tuning = {}) {
  return `speed=${formatNumber(tuning.maxAngular)} duration=${Math.round(Number(tuning.commandDurationMs ?? 0))}ms interval=${Math.round(Number(tuning.commandRefreshMs ?? 0))}ms tolerance=${formatNumber(tuning.centerDeadband)} maxAge=${Math.round(Number(tuning.maxDetectionAgeMs ?? 0))}ms`;
}

function isFreshTrack(track) {
  return Boolean(track && track.visible && !track.lostAt);
}
