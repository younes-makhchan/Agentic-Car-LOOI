export class LifeEventEmitter {
  constructor({
    lifeEngine,
    personalityTuning,
    logger,
    postRobotEvent,
    minIntervalMs = 15000
  } = {}) {
    this.lifeEngine = lifeEngine;
    this.personalityTuning = personalityTuning;
    this.logger = logger;
    this.postRobotEvent = postRobotEvent;
    this.minIntervalMs = minIntervalMs;
    this.running = false;
    this.timer = null;
    this.lastEventAt = 0;
    this.lastEvent = null;
    this.previousUserVisible = null;
    this.emittedKeys = new Map();
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.tick();
    this.timer = globalThis.setInterval(() => this.tick(), 2000);
    this.log("Life events enabled.");
    return this.getStatus();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.log("Life events disabled.");
    return this.getStatus();
  }

  tick() {
    if (!this.running) {
      return;
    }

    this.maybeEmitLifeEvent().catch((error) => {
      this.log(`Life event tick failed: ${error.message}`, "warn");
    });
  }

  async maybeEmitLifeEvent() {
    const state = this.lifeEngine?.getState?.();

    if (!state) {
      return null;
    }

    const now = Date.now();
    const talkativeness =
      this.personalityTuning?.getProfile?.().coreTraits?.talkativeness ?? 0.35;
    const idleMs = now - Number(state.lastInteractionAt || now);
    const stopRespectActive = Number(state.stopRespectUntil || 0) > now;

    if (state.obstacle || Number(state.fear) > 0.7) {
      return this.emitKeyed("obstacle_fear", "I detected an obstacle and felt cautious.", {
        fear: state.fear,
        obstacle: state.obstacle
      }, "high", 10000);
    }

    if (Number(state.energy) < 0.18) {
      return this.emitKeyed("low_energy", "I feel low energy.", {
        energy: state.energy
      }, "high", 30000);
    }

    if (this.previousUserVisible === false && state.userVisible === true) {
      this.previousUserVisible = true;
      return this.emitKeyed("user_returned", "I see the user again.", {
        userDistance: state.userDistance,
        userPosition: state.userPosition
      }, "normal", 12000);
    }

    if (this.previousUserVisible === true && state.userVisible === false) {
      this.previousUserVisible = false;
      return this.emitKeyed("user_absent", "The user disappeared from view.", {}, "low", 30000);
    }

    if (this.previousUserVisible === null) {
      this.previousUserVisible = Boolean(state.userVisible);
    }

    if (stopRespectActive) {
      return null;
    }

    if (Number(state.boredom) > 0.82 && talkativeness > 0.15) {
      return this.emitKeyed("boredom_high", "I am getting bored and curious.", {
        boredom: state.boredom,
        curiosity: state.curiosity
      }, "low", 30000);
    }

    if (idleMs > 45000 && Number(state.loneliness) > 0.55 && talkativeness > 0.25) {
      return this.emitKeyed("ignored_too_long", "The user has not interacted with me for a while.", {
        idleMs,
        loneliness: state.loneliness
      }, "low", 45000);
    }

    return null;
  }

  emitKeyed(type, text, payload = {}, priority = "low", cooldownMs = this.minIntervalMs) {
    const now = Date.now();
    const lastKeyAt = Number(this.emittedKeys.get(type) || 0);

    if (now - this.lastEventAt < this.minIntervalMs || now - lastKeyAt < cooldownMs) {
      return null;
    }

    this.emittedKeys.set(type, now);
    return this.emitLifeEvent(type, text, payload, priority);
  }

  async emitLifeEvent(type, text, payload = {}, priority = "low") {
    const eventPayload = {
      source: "phone-browser",
      type: type === "user_returned" || type === "user_absent" ? "observation" : "runtime_note",
      text,
      payload: {
        lifeEventType: type,
        ...payload
      },
      priority
    };

    this.lastEventAt = Date.now();
    this.lastEvent = {
      type,
      text,
      priority,
      timestamp: new Date().toISOString()
    };

    if (typeof this.postRobotEvent === "function") {
      await this.postRobotEvent(eventPayload);
    } else {
      this.log(`Life event: ${type} (${text})`);
    }

    this.lifeEngine?.patchState?.({ lastProactiveEventAt: this.lastEventAt }, "life_event");
    return this.lastEvent;
  }

  getStatus() {
    return {
      running: this.running,
      lastEventAt: this.lastEventAt,
      lastEvent: this.lastEvent,
      minIntervalMs: this.minIntervalMs
    };
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const logMethod = typeof this.logger[level] === "function" ? level : "log";
    this.logger[logMethod](message);
  }
}
