export class AutonomousScheduler {
  constructor({
    eventBus,
    lifeEngine,
    getPolicy,
    getContext,
    logger,
    tickMs = 1000
  } = {}) {
    this.eventBus = eventBus;
    this.lifeEngine = lifeEngine;
    this.getPolicy = getPolicy;
    this.getContext = getContext;
    this.logger = logger;
    this.tickMs = Number(tickMs) || 1000;
    this.running = false;
    this.timer = null;
    this.lastThoughtRequestAt = 0;
    this.lastReason = null;
    this.recentRequests = [];
    this.lastUserVisible = false;
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.timer = globalThis.setInterval(() => this.tick(), this.tickMs);
    this.tick();
    return this.getStatus();
  }

  stop() {
    this.running = false;
    globalThis.clearInterval(this.timer);
    this.timer = null;
    return this.getStatus();
  }

  isRunning() {
    return this.running;
  }

  tick() {
    if (!this.running) {
      return null;
    }

    const policy = typeof this.getPolicy === "function" ? this.getPolicy() : {};
    const context = typeof this.getContext === "function"
      ? this.getContext()
      : { lifeState: this.lifeEngine?.getState?.() ?? {} };
    const decision = this.shouldRequestAutonomousThought(context, policy);

    if (!decision.allowed) {
      return decision;
    }

    this.lastThoughtRequestAt = Date.now();
    this.lastReason = decision.reason;
    this.recentRequests.unshift({
      reason: decision.reason,
      timestamp: new Date().toISOString()
    });
    this.recentRequests.length = Math.min(20, this.recentRequests.length);
    this.eventBus?.publish?.("autonomous_tick", {
      reason: decision.reason,
      contextSummary: decision.contextSummary
    }, {
      source: "autonomous_scheduler",
      priority: decision.priority ?? 0
    });
    this.log(`Autonomous thought requested: ${decision.reason}`);
    return decision;
  }

  shouldRequestAutonomousThought(context = {}, policy = {}) {
    const now = Date.now();
    const lifeState = context.lifeState ?? {};
    const minInterval = Number(policy.minAutonomousThoughtIntervalMs || 3000);
    const recentWindow = this.recentRequests.filter((request) => {
      const timestamp = Date.parse(request.timestamp);
      return Number.isFinite(timestamp) && now - timestamp < 60000;
    });
    const maxThoughtsPerMinute = Number(policy.maxThoughtsPerMinute || 12);

    if (!policy.autonomousMode) {
      return denied("autonomous_mode_off");
    }

    if (!policy.localBrainEnabled) {
      return denied("local_brain_disabled");
    }

    if (Number(lifeState.stopRespectUntil || 0) > now) {
      return denied("stop_cooldown");
    }

    if (Number(context.attention?.stopCooldownRemainingMs || 0) > 0) {
      return denied("attention_stop_cooldown");
    }

    if (lifeState.isSpeaking) {
      return denied("robot_speaking");
    }

    if (recentWindow.length >= maxThoughtsPerMinute) {
      return denied("thought_rate_limit");
    }

    if (now - this.lastThoughtRequestAt < minInterval) {
      return denied("cooldown");
    }

    const userVisible = Boolean(lifeState.userVisible);
    const userReturned = userVisible && !this.lastUserVisible;
    this.lastUserVisible = userVisible;

    if (userReturned) {
      return allowed("user_returned", lifeState, 1);
    }

    if (Number(lifeState.boredom) > 0.82) {
      return allowed("boredom_high", lifeState);
    }

    if (Number(lifeState.loneliness) > 0.72) {
      return allowed("loneliness_high", lifeState);
    }

    if (Number(lifeState.energy) < 0.18) {
      return allowed("low_energy", lifeState);
    }

    if (Number(lifeState.curiosity) > 0.86) {
      return allowed("curiosity_high", lifeState);
    }

    if (
      !userVisible &&
      Number(lifeState.lastUserSeenAt || 0) > 0 &&
      now - Number(lifeState.lastUserSeenAt) > 60000 &&
      Number(lifeState.loneliness) > 0.45
    ) {
      return allowed("user_absent_long", lifeState);
    }

    if (
      ["soft_idle", "sleepy_idle"].includes(lifeState.currentBehavior) &&
      Number(lifeState.boredom) > 0.58 &&
      Number(lifeState.curiosity) > 0.55
    ) {
      return allowed("quiet_room", lifeState);
    }

    return denied("no_autonomous_need");
  }

  getStatus() {
    return {
      running: this.running,
      tickMs: this.tickMs,
      lastThoughtRequestAt: this.lastThoughtRequestAt,
      lastReason: this.lastReason,
      recentRequests: [...this.recentRequests]
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

function allowed(reason, lifeState, priority = 0) {
  return {
    allowed: true,
    reason,
    priority: reason === "low_energy" ? 2 : priority,
    contextSummary: {
      mood: lifeState.mood,
      energy: lifeState.energy,
      boredom: lifeState.boredom,
      loneliness: lifeState.loneliness,
      curiosity: lifeState.curiosity
    }
  };
}

function denied(reason) {
  return {
    allowed: false,
    reason
  };
}
