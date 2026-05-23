const MIN_DURATION_MS = 50;
const COMMAND_BUFFER_MS = 80;
const MAX_RAMP_MS = 500;

export class CommandQueue {
  constructor({
    robotClient,
    logger,
    maxSpeed = 0.4,
    minDurationMs = MIN_DURATION_MS,
    maxDurationMs = 1000
  } = {}) {
    this.robotClient = robotClient;
    this.logger = logger;
    this.maxSpeed = maxSpeed;
    this.minDurationMs = clamp(minDurationMs, 0, 1000);
    this.maxDurationMs = clamp(maxDurationMs, this.minDurationMs, 1000);
    this.queue = [];
    this.busy = false;
    this.currentTask = null;
    this.executionToken = 0;
    this.commandCallbacks = new Set();
    this.commandHistory = [];
    this.maxHistory = 40;
  }

  setLimits({ maxSpeed, minDurationMs, maxDurationMs } = {}) {
    if (Number.isFinite(Number(maxSpeed))) {
      this.maxSpeed = clamp(maxSpeed, 0.05, 0.4);
    }

    if (Number.isFinite(Number(minDurationMs))) {
      this.minDurationMs = clamp(minDurationMs, 0, 1000);
      this.maxDurationMs = Math.max(this.maxDurationMs, this.minDurationMs);
    }

    if (Number.isFinite(Number(maxDurationMs))) {
      this.maxDurationMs = clamp(maxDurationMs, this.minDurationMs, 1000);
    }
  }

  enqueueMotion({ linear = 0, angular = 0, durationMs = 300, rampMs, label = "motion" } = {}) {
    const safeCommand = {
      kind: "motion",
      label,
      linear: clamp(linear, -this.maxSpeed, this.maxSpeed),
      angular: clamp(angular, -this.maxSpeed, this.maxSpeed),
      durationMs: clamp(durationMs, this.minDurationMs, this.maxDurationMs),
      rampMs: clamp(rampMs ?? 120, 0, MAX_RAMP_MS)
    };

    this.log(
      `STEP 5 MOTION_REQUEST ${safeCommand.label}: linear=${safeCommand.linear.toFixed(2)} angular=${safeCommand.angular.toFixed(2)} duration=${safeCommand.durationMs}ms ramp=${Math.round(safeCommand.rampMs)}ms`
    );
    return this.enqueueItem(safeCommand);
  }

  sendRealtimeMotion({
    linear = 0,
    angular = 0,
    durationMs = 300,
    rampMs,
    label = "realtime_motion",
    log = true,
    record = true
  } = {}) {
    const safeCommand = {
      kind: "motion",
      label,
      linear: clamp(linear, -this.maxSpeed, this.maxSpeed),
      angular: clamp(angular, -this.maxSpeed, this.maxSpeed),
      durationMs: clamp(durationMs, this.minDurationMs, this.maxDurationMs),
      rampMs: clamp(rampMs ?? 120, 0, MAX_RAMP_MS)
    };

    if (!this.robotClient?.isConnected()) {
      const error = new Error("ESP32 is not connected.");
      if (record) {
        this.recordCommand(safeCommand, "rejected");
      }
      if (log) {
        this.log(`Rejected ${safeCommand.label}: ${error.message}`, "warn");
      }
      return Promise.reject(error);
    }

    try {
      const messageId = this.robotClient.sendMotion({
        linear: safeCommand.linear,
        angular: safeCommand.angular,
        durationMs: safeCommand.durationMs,
        rampMs: safeCommand.rampMs,
        label: safeCommand.label
      });

      if (record) {
        this.recordCommand(safeCommand, "started");
      }
      if (log) {
        this.log(
          `STEP 5 REALTIME_MOTION_SENT ${safeCommand.label}: linear=${safeCommand.linear.toFixed(2)} angular=${safeCommand.angular.toFixed(2)} duration=${safeCommand.durationMs}ms ramp=${Math.round(safeCommand.rampMs)}ms`
        );
      }

      return Promise.resolve({
        label: safeCommand.label,
        kind: safeCommand.kind,
        durationMs: safeCommand.durationMs,
        rampMs: safeCommand.rampMs,
        realtime: true,
        messageId
      });
    } catch (error) {
      if (record) {
        this.recordCommand(safeCommand, "rejected");
      }
      if (log) {
        this.log(`Rejected ${safeCommand.label}: ${error.message}`, "warn");
      }
      return Promise.reject(error);
    }
  }

  sendRealtimeStop(reason = "realtime_stop", { log = true, record = true } = {}) {
    const stopCommand = {
      kind: "stop",
      label: reason,
      reason,
      linear: 0,
      angular: 0,
      durationMs: 0,
      rampMs: 0
    };

    try {
      if (this.robotClient?.isConnected()) {
        this.robotClient.stop(reason);
      }

      if (record) {
        this.recordCommand(stopCommand, "stopped");
      }
      if (log) {
        this.log(`STEP 5 REALTIME_STOP ${reason}`);
      }

      return Promise.resolve({
        label: reason,
        kind: "stop",
        realtime: true
      });
    } catch (error) {
      if (record) {
        this.recordCommand(stopCommand, "rejected");
      }
      if (log) {
        this.log(`Realtime stop failed (${reason}): ${error.message}`, "warn");
      }
      return Promise.reject(error);
    }
  }

  enqueueSequence(commands, label = "sequence") {
    if (!Array.isArray(commands) || commands.length === 0) {
      return Promise.resolve([]);
    }

    const tasks = commands.map((command, index) => {
      if (command?.type === "stop" || command?.kind === "stop") {
        return this.enqueueItem({
          kind: "stop",
          label: command.label ?? `${label}_${index + 1}_stop`,
          reason: command.reason ?? `${label}_stop`
        });
      }

      return this.enqueueMotion({
        linear: command?.linear ?? 0,
        angular: command?.angular ?? 0,
        durationMs: command?.durationMs ?? 300,
        rampMs: command?.rampMs,
        label: command?.label ?? `${label}_${index + 1}`
      });
    });

    return Promise.all(tasks);
  }

  clear(reason = "queue_clear") {
    const pending = [...this.queue];

    this.queue = [];

    pending.forEach((item) => {
      this.recordCommand(item, "stopped");
      item.rejectOnce(new Error(`Queue cleared: ${reason}`));
    });

    if (pending.length > 0) {
      this.log(`Queue cleared (${reason}). Removed ${pending.length} pending command(s).`, "warn");
    }

    return pending.length;
  }

  async stopMotion(reason = "motion_stop") {
    this.executionToken += 1;

    const pendingCount = this.clear(reason);

    if (this.currentTask) {
      this.recordCommand(this.currentTask, "stopped");
      this.currentTask.rejectOnce(new Error(`Motion stopped: ${reason}`));
      this.currentTask = null;
    }

    this.busy = false;

    try {
      if (this.robotClient?.isConnected()) {
        this.robotClient.stop(reason);
      }
    } catch (error) {
      this.log(`Motion stop failed to reach ESP32: ${error.message}`, "warn");
    }

    this.log(
      `Motion stopped (${reason}). Cleared ${pendingCount} queued command(s).`,
      "warn"
    );
  }

  async cancelMotion(reason = "motion_cancelled") {
    return this.stopMotion(reason);
  }

  isBusy() {
    return this.busy;
  }

  getQueueLength() {
    return this.queue.length;
  }

  getRecentCommands({ limit = 20 } = {}) {
    return this.commandHistory.slice(0, clamp(Math.floor(Number(limit) || 20), 1, this.maxHistory));
  }

  onCommand(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.commandCallbacks.add(callback);
    return () => this.commandCallbacks.delete(callback);
  }

  enqueueItem(command) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const queueItem = {
        historyId: `cmd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ...command,
        resolveOnce(value) {
          if (settled) {
            return false;
          }

          settled = true;
          resolve(value);
          return true;
        },
        rejectOnce(error) {
          if (settled) {
            return false;
          }

          settled = true;
          reject(error);
          return true;
        },
        isSettled() {
          return settled;
        }
      };

      this.queue.push(queueItem);
      this.recordCommand(queueItem, "queued");
      this.log(
        `Queued ${queueItem.label} (${queueItem.kind}) [pending: ${this.queue.length}]`
      );
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.busy) {
      return;
    }

    const item = this.queue.shift();

    if (!item) {
      return;
    }

    if (!this.robotClient?.isConnected()) {
      const error = new Error("ESP32 is not connected.");
      this.recordCommand(item, "rejected");
      item.rejectOnce(error);
      this.log(`Rejected ${item.label}: ${error.message}`, "warn");
      this.clear("disconnected");
      return;
    }

    this.busy = true;
    this.currentTask = item;
    const token = this.executionToken;

    try {
      if (item.kind === "stop") {
        this.log(`Started ${item.label} (${item.kind})`);
        this.recordCommand(item, "started");
        this.robotClient.stop(item.reason ?? "queue_stop");
        await wait(COMMAND_BUFFER_MS);
      } else {
        this.log(
          `Started ${item.label}: linear=${item.linear.toFixed(2)} angular=${item.angular.toFixed(
            2
          )} duration=${item.durationMs}ms ramp=${Math.round(item.rampMs)}ms`
        );
        this.recordCommand(item, "started");

        this.robotClient.sendMotion({
          linear: item.linear,
          angular: item.angular,
          durationMs: item.durationMs,
          rampMs: item.rampMs,
          label: item.label
        });
        this.log(`STEP 5 MOTION_SENT ESP32 gateway: ${item.label}`);

        await wait(item.durationMs + COMMAND_BUFFER_MS);
      }

      if (token !== this.executionToken || item.isSettled()) {
        return;
      }

      item.resolveOnce({
        label: item.label,
        kind: item.kind,
        durationMs: item.durationMs ?? 0,
        rampMs: item.rampMs ?? 0
      });
      this.recordCommand(item, "completed");
      this.log(`Completed ${item.label}`);
    } catch (error) {
      this.recordCommand(item, "rejected");
      item.rejectOnce(error);
      this.log(`Rejected ${item.label}: ${error.message}`, "warn");

      if (!this.robotClient?.isConnected()) {
        this.clear("disconnected");
      }
    } finally {
      if (this.currentTask === item) {
        this.currentTask = null;
      }

      if (token === this.executionToken) {
        this.busy = false;
      }

      this.processQueue();
    }
  }

  recordCommand(command, status) {
    const entry = {
      id: command.historyId ?? `cmd_${Date.now()}`,
      timestamp: Date.now(),
      label: command.label ?? command.reason ?? "command",
      kind: command.kind ?? "motion",
      linear: Number.isFinite(Number(command.linear)) ? Number(command.linear) : 0,
      angular: Number.isFinite(Number(command.angular)) ? Number(command.angular) : 0,
      durationMs: Number.isFinite(Number(command.durationMs)) ? Number(command.durationMs) : 0,
      rampMs: Number.isFinite(Number(command.rampMs)) ? Number(command.rampMs) : 0,
      status
    };

    this.commandHistory.unshift(entry);
    this.commandHistory.length = Math.min(this.commandHistory.length, this.maxHistory);
    this.commandCallbacks.forEach((callback) => callback(entry, this.getRecentCommands()));
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

export function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export function clamp(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, numericValue));
}
