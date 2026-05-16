const DEFAULT_MAX_EVENTS = 200;
const TERMINAL_STATUSES = new Set(["handled", "ignored"]);

export const ALLOWED_EVENT_TYPES = new Set([
  "user_speech",
  "user_text",
  "local_stop_phrase",
  "runtime_note",
  "observation",
  "system",
  "touch",
  "ui"
]);

export class RobotEventQueue {
  constructor({ maxEvents = DEFAULT_MAX_EVENTS } = {}) {
    this.maxEvents = normalizePositiveInt(maxEvents, DEFAULT_MAX_EVENTS);
    this.events = [];
    this.counter = 0;
  }

  enqueueEvent({
    source = "runtime",
    type,
    text = "",
    payload = {},
    requestId,
    priority = "normal"
  } = {}) {
    this.validateEventInput({ source, type, text, payload, requestId, priority });
    this.ensureCapacity(1);

    const now = new Date().toISOString();
    const event = {
      id: this.createEventId(),
      source,
      type,
      text: normalizeText(text),
      payload: { ...payload },
      status: "new",
      createdAt: now,
      claimedAt: null,
      handledAt: null,
      result: null,
      requestId: requestId ?? null,
      priority: normalizePriority(priority)
    };

    this.events.push(event);
    return copyEvent(event);
  }

  getNewEvents({ limit = 10, types = [] } = {}) {
    const allowedTypes = normalizeTypes(types);

    return this.events
      .filter((event) => event.status === "new")
      .filter((event) => allowedTypes.length === 0 || allowedTypes.includes(event.type))
      .sort(compareEventPriority)
      .slice(0, normalizeLimit(limit))
      .map(copyEvent);
  }

  claimEvents({ limit = 10, consumer = "kimi_claw_cloud" } = {}) {
    const now = new Date().toISOString();
    const claimed = [];
    const candidates = this.events
      .filter((event) => event.status === "new")
      .sort(compareEventPriority)
      .slice(0, normalizeLimit(limit));

    for (const event of candidates) {
      event.status = "claimed";
      event.claimedAt = now;
      event.consumer = consumer;
      claimed.push(copyEvent(event));
    }

    return claimed;
  }

  markHandled(id, result = {}) {
    return this.setTerminalStatus(id, "handled", result);
  }

  markIgnored(id, result = {}) {
    return this.setTerminalStatus(id, "ignored", result);
  }

  getEvent(id) {
    const event = this.events.find((item) => item.id === id);
    return event ? copyEvent(event) : null;
  }

  getRecentEvents({ limit = 50 } = {}) {
    return [...this.events]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, normalizeLimit(limit, 50))
      .map(copyEvent);
  }

  async waitForEvent({ timeoutMs = 30000, pollMs = 500, types = [] } = {}) {
    const started = Date.now();
    const safeTimeoutMs = Math.min(60000, Math.max(0, Number(timeoutMs) || 30000));
    const safePollMs = Math.min(2000, Math.max(100, Number(pollMs) || 500));

    let events = this.getNewEvents({ limit: 10, types });

    while (events.length === 0 && Date.now() - started < safeTimeoutMs) {
      await sleep(safePollMs);
      events = this.getNewEvents({ limit: 10, types });
    }

    return {
      done: events.length > 0,
      events,
      timedOut: events.length === 0
    };
  }

  clearHandled() {
    const before = this.events.length;
    this.events = this.events.filter((event) => !TERMINAL_STATUSES.has(event.status));
    return before - this.events.length;
  }

  clearAll({ includeNew = false } = {}) {
    if (!includeNew) {
      return this.clearHandled();
    }

    const cleared = this.events.length;
    this.events = [];
    return cleared;
  }

  getStats() {
    return {
      new: this.events.filter((event) => event.status === "new").length,
      claimed: this.events.filter((event) => event.status === "claimed").length,
      handled: this.events.filter((event) => event.status === "handled").length,
      ignored: this.events.filter((event) => event.status === "ignored").length,
      recent: this.events.length,
      maxEvents: this.maxEvents
    };
  }

  validateEventInput({ source, type, text, payload, requestId, priority }) {
    if (typeof source !== "string" || !source.trim()) {
      throw new EventValidationError("source must be a non-empty string");
    }

    if (!ALLOWED_EVENT_TYPES.has(type)) {
      throw new EventValidationError(`Unknown robot event type: ${type}`);
    }

    if (text !== undefined && text !== null && typeof text !== "string") {
      throw new EventValidationError("text must be a string when provided");
    }

    if (typeof text === "string" && text.length > 2000) {
      throw new EventValidationError("text must be 2000 characters or fewer");
    }

    if (payload !== undefined && payload !== null && (!payload || typeof payload !== "object" || Array.isArray(payload))) {
      throw new EventValidationError("payload must be an object when provided");
    }

    if (requestId !== undefined && requestId !== null && typeof requestId !== "string") {
      throw new EventValidationError("requestId must be a string when provided");
    }

    if (!["low", "normal", "high"].includes(priority ?? "normal")) {
      throw new EventValidationError("priority must be low, normal, or high");
    }
  }

  setTerminalStatus(id, status, result = {}) {
    const event = this.events.find((item) => item.id === id);

    if (!event) {
      return null;
    }

    event.status = status;
    event.handledAt = new Date().toISOString();
    event.result = result ?? {};

    return copyEvent(event);
  }

  ensureCapacity(incomingCount) {
    while (this.events.length + incomingCount > this.maxEvents) {
      const terminalIndex = this.events.findIndex((event) =>
        TERMINAL_STATUSES.has(event.status)
      );

      if (terminalIndex !== -1) {
        this.events.splice(terminalIndex, 1);
      } else {
        throw new EventCapacityError("Robot event inbox is full");
      }
    }
  }

  createEventId() {
    this.counter += 1;
    return `event_${Date.now()}_${this.counter}`;
  }
}

export class EventValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventValidationError";
    this.statusCode = 400;
  }
}

export class EventCapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventCapacityError";
    this.statusCode = 429;
  }
}

function copyEvent(event) {
  return {
    ...event,
    payload: { ...event.payload },
    result: event.result && typeof event.result === "object" ? { ...event.result } : event.result
  };
}

function normalizeLimit(limit, fallback = 10) {
  const numericLimit = Number(limit);

  if (!Number.isFinite(numericLimit)) {
    return fallback;
  }

  return Math.min(100, Math.max(1, Math.floor(numericLimit)));
}

function normalizePositiveInt(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : fallback;
}

function normalizeText(text) {
  return typeof text === "string" ? text.trim().slice(0, 2000) : "";
}

function normalizePriority(priority) {
  return ["low", "normal", "high"].includes(priority) ? priority : "normal";
}

function normalizeTypes(types) {
  if (typeof types === "string") {
    return types
      .split(",")
      .map((type) => type.trim())
      .filter((type) => ALLOWED_EVENT_TYPES.has(type));
  }

  if (!Array.isArray(types)) {
    return [];
  }

  return types.filter((type) => ALLOWED_EVENT_TYPES.has(type));
}

function compareEventPriority(a, b) {
  const priorityRank = { high: 0, normal: 1, low: 2 };
  const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
  return priorityDelta || a.createdAt.localeCompare(b.createdAt);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
