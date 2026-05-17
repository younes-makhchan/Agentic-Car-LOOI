export class AttentionMotorController {
  constructor({
    lifeEngine,
    macroSequencer,
    eventBus,
    getPolicy,
    logger
  } = {}) {
    this.lifeEngine = lifeEngine;
    this.macroSequencer = macroSequencer;
    this.eventBus = eventBus;
    this.getPolicy = getPolicy;
    this.logger = logger;
    this.running = false;
    this.bodyTrackingEnabled = false;
    this.lastBodyCorrectionAt = 0;
    this.minBodyCorrectionMs = 4200;
    this.lastObservation = null;
    this.lastEyeDirection = "center";
  }

  start() {
    this.running = true;
    return this.getStatus();
  }

  stop() {
    this.running = false;
    return this.getStatus();
  }

  setBodyTrackingEnabled(enabled) {
    this.bodyTrackingEnabled = Boolean(enabled);
    return this.getStatus();
  }

  onObservation(observation) {
    this.lastObservation = observation ?? null;
    if (!this.running || !observation) {
      return null;
    }
    return this.maybeTrackUser(observation);
  }

  maybeTrackUser(observation) {
    if (!observation?.userVisible) {
      return { tracked: false, reason: "user_not_visible" };
    }

    const position = normalizePosition(observation.userPosition);
    this.lastEyeDirection = position;
    this.lifeEngine?.face?.setEyeDirection?.(position);

    const policy = this.getPolicy?.() ?? {};
    const lifeState = this.lifeEngine?.getState?.() ?? {};
    const now = Date.now();

    if (!this.bodyTrackingEnabled) {
      return { tracked: true, moved: false, reason: "eyes_only" };
    }

    if (!policy.localMotionArmed || !policy.allowAutonomousMovement) {
      return { tracked: true, moved: false, reason: "motion_not_allowed" };
    }

    if (lifeState.isSpeaking || Number(lifeState.stopRespectUntil || 0) > now) {
      return { tracked: true, moved: false, reason: "busy_or_stop_cooldown" };
    }

    if (position === "center" || now - this.lastBodyCorrectionAt < this.minBodyCorrectionMs) {
      return { tracked: true, moved: false, reason: "body_cooldown_or_center" };
    }

    this.lastBodyCorrectionAt = now;
    const angular = position === "left" ? -0.12 : 0.12;
    this.macroSequencer?.playMacroObject?.({
      name: `attention_turn_${position}`,
      description: "Gentle body correction toward visible user.",
      priority: 50,
      interruptible: true,
      requiresMotion: false,
      cooldownMs: 2500,
      frames: [
        { type: "face", expression: "attentive", intensity: 0.86, eyeDirection: position, durationMs: 70 },
        { type: "motion", linear: 0, angular, durationMs: 170, rampMs: 120, label: `attention_track_${position}`, allowSkip: true },
        { type: "face", expression: "attentive", intensity: 0.76, eyeDirection: "center", durationMs: 80 }
      ]
    }, {
      source: "attention_motor_controller",
      priority: 50,
      allowMotion: true,
      allowSpeech: false,
      reason: "camera_user_tracking"
    }).catch?.((error) => this.log(`Attention body tracking failed: ${error.message}`, "warn"));

    return { tracked: true, moved: true, reason: "body_tracking_requested" };
  }

  getStatus() {
    return {
      running: this.running,
      bodyTrackingEnabled: this.bodyTrackingEnabled,
      lastBodyCorrectionAt: this.lastBodyCorrectionAt,
      lastEyeDirection: this.lastEyeDirection,
      userVisible: Boolean(this.lastObservation?.userVisible)
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

function normalizePosition(position) {
  return ["left", "right", "center"].includes(position) ? position : "center";
}
