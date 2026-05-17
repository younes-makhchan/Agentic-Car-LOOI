export class IdleMicroBehavior {
  constructor({
    eventBus,
    lifeEngine,
    macroSequencer,
    getPolicy,
    getContext,
    logger,
    minMs = 4000,
    maxMs = 12000
  } = {}) {
    this.eventBus = eventBus;
    this.lifeEngine = lifeEngine;
    this.macroSequencer = macroSequencer;
    this.getPolicy = getPolicy;
    this.getContext = getContext;
    this.logger = logger;
    this.minMs = Number(minMs) || 4000;
    this.maxMs = Number(maxMs) || 12000;
    this.running = false;
    this.timer = null;
    this.lastBehavior = null;
    this.lastAt = 0;
    this.intervalScale = 1;
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }
    this.running = true;
    this.scheduleNext();
    return this.getStatus();
  }

  stop() {
    this.running = false;
    globalThis.clearTimeout(this.timer);
    this.timer = null;
    return this.getStatus();
  }

  tick() {
    if (!this.running) {
      return null;
    }

    const policy = this.getPolicy?.() ?? {};
    const context = this.getContext?.() ?? { lifeState: this.lifeEngine?.getState?.() ?? {} };
    const decision = this.chooseIdleMicroBehavior(context, policy);

    if (decision.macro) {
      this.lastBehavior = decision.macro;
      this.lastAt = Date.now();
      this.macroSequencer?.playMacro?.(decision.macro, {
        source: "idle_micro_behavior",
        priority: 20,
        allowMotion: decision.allowMotion,
        allowSpeech: false,
        reason: decision.reason,
        context
      }).catch?.((error) => this.log(`Idle micro behavior failed: ${error.message}`, "warn"));
      this.eventBus?.publish?.("system", {
        lifeEventType: "idle_micro_behavior",
        macro: decision.macro,
        reason: decision.reason
      }, { source: "idle_micro_behavior", priority: 0 });
    }

    this.scheduleNext();
    return decision;
  }

  chooseIdleMicroBehavior(context = {}, policy = {}) {
    const lifeState = context.lifeState ?? {};
    const now = Date.now();

    if (!this.lifeEngine?.running) {
      return denied("life_engine_not_running");
    }

    if (lifeState.isSpeaking || lifeState.isListening || context.attention?.mode === "conversation") {
      return denied("interaction_active");
    }

    if (Number(lifeState.stopRespectUntil || 0) > now || Number(context.attention?.stopCooldownRemainingMs || 0) > 0) {
      return denied("stop_cooldown");
    }

    if (context.commandQueueBusy || this.macroSequencer?.isRunning?.()) {
      return denied("runtime_busy");
    }

    if (now - this.lastAt < this.minMs) {
      return denied("cooldown");
    }

    const calibration = context.calibration ?? {};
    const motionAllowed = Boolean(
      policy.localMotionArmed &&
      policy.allowAutonomousMovement &&
      calibration.idleMotionEnabled !== false
    );

    if (Number(lifeState.energy) < 0.22) {
      return allowed("sleepy_idle", "low_energy", false);
    }

    if (Number(lifeState.curiosity) > 0.78 && Math.random() < 0.35) {
      return allowed(motionAllowed ? "curious_scan" : "look_around_only", "curiosity", motionAllowed);
    }

    if (Math.random() < 0.55) {
      return allowed(randomChoice(["soft_idle", "soft_recenter", "thinking_pose"]), "subtle_life", false);
    }

    return denied("stillness");
  }

  getStatus() {
    return {
      running: this.running,
      minMs: this.minMs,
      maxMs: this.maxMs,
      intervalScale: this.intervalScale,
      lastBehavior: this.lastBehavior,
      lastAt: this.lastAt,
      nextInMs: this.timer ? null : 0
    };
  }

  setIntervalScale(scale) {
    this.intervalScale = Math.min(4, Math.max(0.5, Number(scale) || 1));
  }

  scheduleNext() {
    globalThis.clearTimeout(this.timer);
    if (!this.running) {
      return;
    }
    const spread = Math.max(0, this.maxMs - this.minMs);
    const delay = Math.round((this.minMs + Math.random() * spread) * this.intervalScale);
    this.timer = globalThis.setTimeout(() => this.tick(), delay);
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

function allowed(macro, reason, allowMotion) {
  return { allowed: true, macro, reason, allowMotion };
}

function denied(reason) {
  return { allowed: false, reason, macro: null, allowMotion: false };
}

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}
