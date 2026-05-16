const MAX_ACTIONS = 200;
const TERMINAL_STATUSES = new Set(["completed", "failed", "rejected"]);

export const ALLOWED_ACTION_TYPES = new Set([
  "speak",
  "express",
  "drive",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember",
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

export class RobotActionQueue {
  constructor({ maxActions = MAX_ACTIONS } = {}) {
    this.maxActions = maxActions;
    this.actions = [];
    this.counter = 0;
  }

  enqueueAction({ source = "unknown", type, args = {}, requestId, reason } = {}) {
    this.validateActionInput({ source, type, args, requestId, reason });
    this.ensureCapacity(1);

    const now = new Date().toISOString();
    const action = {
      id: this.createActionId(),
      source,
      type,
      args,
      status: "pending",
      createdAt: now,
      claimedAt: null,
      completedAt: null,
      result: null,
      error: null,
      requestId: requestId ?? null,
      reason: reason ?? null
    };

    this.actions.push(action);

    return copyAction(action);
  }

  enqueueBatch({ source = "unknown", actions = [], requestId, reason } = {}) {
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new QueueValidationError("actions must be a non-empty array");
    }

    actions.forEach((action) => {
      this.validateActionInput({
        source: action.source ?? source,
        type: action.type,
        args: action.args ?? {},
        requestId: action.requestId ?? requestId,
        reason: action.reason ?? reason
      });
    });

    this.ensureCapacity(actions.length);

    return actions.map((action) =>
      this.enqueueAction({
        source: action.source ?? source,
        type: action.type,
        args: action.args ?? {},
        requestId: action.requestId ?? requestId,
        reason: action.reason ?? reason
      })
    );
  }

  getPendingActions({ limit = 10 } = {}) {
    return this.actions
      .filter((action) => action.status === "pending")
      .slice(0, normalizeLimit(limit))
      .map(copyAction);
  }

  claimActions({ limit = 10, consumer = "browser" } = {}) {
    const now = new Date().toISOString();
    const claimedActions = [];

    for (const action of this.actions) {
      if (claimedActions.length >= normalizeLimit(limit)) {
        break;
      }

      if (action.status !== "pending") {
        continue;
      }

      action.status = "claimed";
      action.claimedAt = now;
      action.consumer = consumer;
      claimedActions.push(copyAction(action));
    }

    return claimedActions;
  }

  completeAction(id, result = {}) {
    return this.setTerminalStatus(id, "completed", { result });
  }

  failAction(id, error = "Action failed") {
    return this.setTerminalStatus(id, "failed", { error });
  }

  rejectAction(id, error = "Action rejected") {
    return this.setTerminalStatus(id, "rejected", { error });
  }

  getAction(id) {
    const action = this.actions.find((item) => item.id === id);
    return action ? copyAction(action) : null;
  }

  getRecentActions({ limit = 50 } = {}) {
    return [...this.actions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, normalizeLimit(limit, 50))
      .map(copyAction);
  }

  clearCompleted() {
    const before = this.actions.length;
    this.actions = this.actions.filter((action) => !TERMINAL_STATUSES.has(action.status));
    return before - this.actions.length;
  }

  clearAll({ includePending = false } = {}) {
    if (!includePending) {
      return this.clearCompleted();
    }

    const cleared = this.actions.length;
    this.actions = [];
    return cleared;
  }

  getStats() {
    return {
      pending: this.actions.filter((action) => action.status === "pending").length,
      claimed: this.actions.filter((action) => action.status === "claimed").length,
      completed: this.actions.filter((action) => action.status === "completed").length,
      failed: this.actions.filter((action) => action.status === "failed").length,
      rejected: this.actions.filter((action) => action.status === "rejected").length,
      recent: this.actions.length,
      maxActions: this.maxActions
    };
  }

  validateActionInput({ source, type, args, requestId, reason }) {
    if (typeof source !== "string" || !source.trim()) {
      throw new QueueValidationError("source must be a non-empty string");
    }

    if (typeof type !== "string" || !type.trim()) {
      throw new QueueValidationError("type must be a non-empty string");
    }

    if (!ALLOWED_ACTION_TYPES.has(type)) {
      throw new QueueValidationError(`Unknown robot action type: ${type}`);
    }

    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new QueueValidationError("args must be an object");
    }

    if (requestId !== undefined && requestId !== null && typeof requestId !== "string") {
      throw new QueueValidationError("requestId must be a string when provided");
    }

    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      throw new QueueValidationError("reason must be a string when provided");
    }
  }

  setTerminalStatus(id, status, { result = null, error = null } = {}) {
    const action = this.actions.find((item) => item.id === id);

    if (!action) {
      return null;
    }

    action.status = status;
    action.completedAt = new Date().toISOString();
    action.result = result;
    action.error = error;

    return copyAction(action);
  }

  ensureCapacity(incomingCount) {
    while (this.actions.length + incomingCount > this.maxActions) {
      const terminalIndex = this.actions.findIndex((action) =>
        TERMINAL_STATUSES.has(action.status)
      );

      if (terminalIndex !== -1) {
        this.actions.splice(terminalIndex, 1);
      } else {
        throw new QueueCapacityError("Robot bridge action queue is full");
      }
    }
  }

  createActionId() {
    this.counter += 1;
    return `action_${Date.now()}_${this.counter}`;
  }
}

export class QueueValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueValidationError";
    this.statusCode = 400;
  }
}

export class QueueCapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueCapacityError";
    this.statusCode = 429;
  }
}

function copyAction(action) {
  return {
    ...action,
    args: { ...action.args }
  };
}

function normalizeLimit(limit, fallback = 10) {
  const numericLimit = Number(limit);

  if (!Number.isFinite(numericLimit)) {
    return fallback;
  }

  return Math.min(100, Math.max(1, Math.floor(numericLimit)));
}
