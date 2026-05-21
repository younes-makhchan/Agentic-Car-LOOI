import { canonicalObjectLabel } from "./objectLabelUtils.js";

const FOLLOW_MODES = new Set(["cautious", "gentle", "curious"]);
const FOLLOW_POSITION_LOG_INTERVAL_MS = 600;

export class FollowTargetController {
  constructor({
    visionState,
    objectTracker,
    lifeEngine,
    commandQueue,
    safetyGate,
    eventBus,
    voiceOutput,
    scenarioRunner,
    getPolicy,
    logger,
    tickMs = 200,
    lostTimeoutMs = 2000
  } = {}) {
    this.visionState = visionState;
    this.objectTracker = objectTracker;
    this.lifeEngine = lifeEngine;
    this.commandQueue = commandQueue;
    this.safetyGate = safetyGate;
    this.eventBus = eventBus;
    this.voiceOutput = voiceOutput;
    this.scenarioRunner = scenarioRunner;
    this.getPolicy = getPolicy;
    this.logger = logger;
    this.tickMs = clampNumber(tickMs, 100, 1000, 200);
    this.lostTimeoutMs = clampNumber(lostTimeoutMs, 500, 8000, 2000);
    this.running = false;
    this.targetLabel = null;
    this.targetTrackId = null;
    this.mode = "gentle";
    this.timer = null;
    this.lastMoveAt = 0;
    this.lastSeenAt = null;
    this.lastStopAt = 0;
    this.lostAnnounced = false;
    this.paused = false;
    this.lastScenarioName = null;
    this.lastPositionLogAt = 0;
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
    this.lastScenarioName = null;
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
    const targetVisibleNow = Boolean(track && track.visible && !track.lostAt);

    if (!targetVisibleNow) {
      const lostForMs = this.computeLostForMs(track);
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

    const scenarioName = this.computeScenarioForTarget(track);
    this.logTargetPosition(track, scenarioName);
    if (!scenarioName) {
      this.lastScenarioName = null;
      return this.getStatus();
    }

    const permission = this.canMove();
    if (!permission.allowed) {
      this.log(`[roboflow] follow scenario held target=${track.label} scenario=${scenarioName} reason=${permission.reason}`, "debug");
      return {
        ...this.getStatus(),
        scenarioHeldReason: permission.reason
      };
    }

    const now = Date.now();
    if (now - this.lastMoveAt < 420) {
      return this.getStatus();
    }

    this.lastMoveAt = now;
    this.lastScenarioName = scenarioName;
    this.runFollowScenario(scenarioName, track);
    this.eventBus?.publish?.("vision_follow_scenario", {
      target: this.getTarget(),
      scenario: scenarioName,
      centerX: track.centerX,
      position: track.position
    }, { source: "vision" });
    return {
      ...this.getStatus(),
      lastScenario: scenarioName
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
    return {
      running: this.running,
      targetLabel: this.targetLabel,
      targetTrackId: this.targetTrackId,
      mode: this.mode,
      tickMs: this.tickMs,
      lostTimeoutMs: this.lostTimeoutMs,
      lastMoveAt: this.lastMoveAt,
      lastSeenAt: this.lastSeenAt,
      lostAnnounced: this.lostAnnounced,
      paused: this.paused,
      lastScenarioName: this.lastScenarioName,
      motionAllowed: this.canMove().allowed
    };
  }

  isRunning() {
    return Boolean(this.running);
  }

  setRobotInterfaces({ commandQueue, lifeEngine, scenarioRunner } = {}) {
    if (commandQueue) {
      this.commandQueue = commandQueue;
    }

    if (lifeEngine) {
      this.lifeEngine = lifeEngine;
    }

    if (scenarioRunner) {
      this.scenarioRunner = scenarioRunner;
    }
  }

  computeScenarioForTarget(track = {}) {
    const centerX = Number(track.centerX ?? 0.5);

    if (centerX < 0.42) {
      return "look_left";
    }

    if (centerX > 0.58) {
      return "look_right";
    }

    return null;
  }

  logTargetPosition(track = {}, scenarioName = null) {
    const now = Date.now();
    if (now - this.lastPositionLogAt < FOLLOW_POSITION_LOG_INTERVAL_MS) {
      return;
    }

    this.lastPositionLogAt = now;
    const centerX = clampNumber(track.centerX, 0, 1, 0.5);
    const centerY = clampNumber(track.centerY, 0, 1, 0.5);
    const offsetX = centerX - 0.5;
    const bbox = track.bbox && typeof track.bbox === "object" ? track.bbox : {};
    const bboxText = [
      formatPixel(bbox.x),
      formatPixel(bbox.y),
      formatPixel(bbox.width),
      formatPixel(bbox.height)
    ].join(",");
    const steering = scenarioName ?? "centered";

    this.log(
      `[roboflow] follow target position label=${track.label ?? this.targetLabel ?? "unknown"} track=${track.id ?? this.targetTrackId ?? "none"} center=(${formatNumber(centerX)},${formatNumber(centerY)}) offsetX=${formatNumber(offsetX)} position=${track.position ?? "unknown"} vertical=${track.verticalPosition ?? "unknown"} distance=${track.distance ?? "unknown"} area=${formatNumber(track.areaRatio)} bbox=(${bboxText}) steering=${steering}`,
      "debug"
    );
  }

  runFollowScenario(name, track = {}) {
    if (typeof this.scenarioRunner !== "function") {
      this.log(`[roboflow] follow scenario skipped scenario=${name} reason=scenario_runner_unavailable`, "warn");
      return;
    }

    this.log(`[roboflow] follow scenario ${name} target=${track.label ?? this.targetLabel} centerX=${formatNumber(track.centerX)}`);
    const result = this.scenarioRunner(name, {
      source: "vision_follow",
      reason: `roboflow_follow:${name}`,
      targetLabel: track.label ?? this.targetLabel,
      trackId: track.id ?? this.targetTrackId ?? null
    });

    Promise.resolve(result).then((scenarioResult) => {
      if (!scenarioResult || scenarioResult.status === "completed") {
        return;
      }

      this.log(
        `[roboflow] follow scenario not executed scenario=${name} status=${scenarioResult.status} message=${scenarioResult.message ?? ""}`,
        "warn"
      );
    }).catch((error) => {
      this.log(`[roboflow] follow scenario failed scenario=${name} error=${error.message}`, "warn");
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
    if (this.targetTrackId) {
      const byId = this.objectTracker?.getTrackById?.(this.targetTrackId);
      if (byId) {
        return byId;
      }
    }

    if (this.targetLabel) {
      const byLabel = this.objectTracker?.findBestTrackByLabel?.(this.targetLabel);
      if (byLabel) {
        this.targetTrackId = byLabel.id ?? byLabel.trackId ?? this.targetTrackId;
        return byLabel;
      }
    }

    return null;
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

    if (this.commandQueue?.isBusy?.() || Number(this.commandQueue?.getQueueLength?.() ?? 0) > 1) {
      return { allowed: false, reason: "command_queue_busy" };
    }

    return { allowed: true, reason: "ok" };
  }

  stopMotion(reason) {
    const now = Date.now();
    if (now - this.lastStopAt < 500) {
      return;
    }

    this.lastStopAt = now;
    const stop = this.commandQueue?.stopMotion ?? this.commandQueue?.cancelMotion;
    stop?.call?.(this.commandQueue, reason)?.catch?.((error) => {
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
      maxObjectFollowSpeed: 0.18,
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
