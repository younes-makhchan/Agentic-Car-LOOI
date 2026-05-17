const DEFAULT_MAX_EVENTS = 200;

export class LocalEventBus {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS, logger } = {}) {
    this.maxEvents = clampInteger(maxEvents, 1, 1000, DEFAULT_MAX_EVENTS);
    this.logger = logger;
    this.events = [];
    this.subscribers = new Map();
    this.allSubscribers = new Set();
  }

  subscribe(type, callback) {
    if (typeof type !== "string" || !type.trim()) {
      throw new Error("LocalEventBus.subscribe requires an event type.");
    }

    if (typeof callback !== "function") {
      throw new Error("LocalEventBus.subscribe requires a callback.");
    }

    const key = type.trim();
    const callbacks = this.subscribers.get(key) ?? new Set();
    callbacks.add(callback);
    this.subscribers.set(key, callbacks);

    return () => this.unsubscribe(key, callback);
  }

  subscribeAll(callback) {
    if (typeof callback !== "function") {
      throw new Error("LocalEventBus.subscribeAll requires a callback.");
    }

    this.allSubscribers.add(callback);
    return () => {
      this.allSubscribers.delete(callback);
    };
  }

  unsubscribe(type, callback) {
    const callbacks = this.subscribers.get(type);

    if (!callbacks) {
      return false;
    }

    const removed = callbacks.delete(callback);

    if (callbacks.size === 0) {
      this.subscribers.delete(type);
    }

    return removed;
  }

  publish(type, payload = {}, options = {}) {
    if (typeof type !== "string" || !type.trim()) {
      throw new Error("LocalEventBus.publish requires an event type.");
    }

    const event = {
      id: options.id ?? createEventId(),
      type: type.trim(),
      payload: isPlainObject(payload) ? { ...payload } : { value: payload },
      priority: clampInteger(options.priority ?? payload?.priority, 0, 10, 0),
      timestamp: options.timestamp ?? new Date().toISOString(),
      source: options.source ?? payload?.source ?? "browser",
      handled: Boolean(options.handled)
    };

    this.events.push(event);

    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this.notifySubscribers(event);
    return event;
  }

  getRecentEvents({ limit = 50, types = null } = {}) {
    const max = clampInteger(limit, 1, this.maxEvents, 50);
    const typeSet = Array.isArray(types) && types.length > 0
      ? new Set(types.map(String))
      : null;
    const source = typeSet
      ? this.events.filter((event) => typeSet.has(event.type))
      : this.events;

    return source.slice(-max).reverse().map((event) => ({
      ...event,
      payload: { ...event.payload }
    }));
  }

  clear() {
    const count = this.events.length;
    this.events = [];
    return count;
  }

  notifySubscribers(event) {
    const callbacks = [
      ...(this.subscribers.get(event.type) ?? []),
      ...this.allSubscribers
    ];

    callbacks.forEach((callback) => {
      try {
        const result = callback(event);

        if (result && typeof result.catch === "function") {
          result.catch((error) => this.logSubscriberError(error, event));
        }
      } catch (error) {
        this.logSubscriberError(error, event);
      }
    });
  }

  logSubscriberError(error, event) {
    const message = `LocalEventBus subscriber failed for ${event.type}: ${error.message}`;

    if (typeof this.logger === "function") {
      this.logger(message, "warn");
      return;
    }

    if (this.logger?.warn) {
      this.logger.warn(message);
      return;
    }

    console.warn(message);
  }
}

function createEventId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `evt_${Date.now().toString(36)}_${random}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}
