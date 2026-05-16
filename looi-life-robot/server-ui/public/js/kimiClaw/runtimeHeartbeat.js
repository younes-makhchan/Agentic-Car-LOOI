export class RuntimeHeartbeat {
  constructor({
    logger,
    getStatusSnapshot,
    intervalMs = 1000,
    requireRuntimeAuth = false
  } = {}) {
    this.logger = logger;
    this.getStatusSnapshot = getStatusSnapshot;
    this.intervalMs = intervalMs;
    this.requireRuntimeAuth = requireRuntimeAuth;
    this.runtimeId = null;
    this.runtimeToken = null;
    this.expiresAt = null;
    this.running = false;
    this.timer = null;
    this.lastHeartbeatAt = null;
    this.lastError = null;
    this.registered = false;
    this.statusCallbacks = new Set();
  }

  async register({ name = "phone-browser", pairingCode = "" } = {}) {
    const response = await fetch("/api/robot-bridge/runtime/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        pairingCode
      })
    });
    const payload = await parseJsonResponse(response);

    this.runtimeId = payload.runtimeId;
    this.runtimeToken = payload.runtimeToken;
    this.expiresAt = payload.expiresAt;
    this.requireRuntimeAuth = Boolean(payload.requireRuntimeAuth);
    this.registered = true;
    this.lastError = null;
    this.emitStatus();
    this.log("Robot runtime registered.");

    return payload;
  }

  start() {
    if (this.running) {
      this.emitStatus();
      return;
    }

    if (!this.registered || !this.runtimeId || !this.runtimeToken) {
      this.lastError = "Runtime is not registered.";
      this.emitStatus();
      this.log("Register runtime before starting heartbeat.", "warn");
      return;
    }

    this.running = true;
    this.emitStatus();
    this.sendHeartbeat();
    this.timer = globalThis.setInterval(() => this.sendHeartbeat(), this.intervalMs);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.emitStatus();
    this.log("Robot runtime heartbeat stopped.");
  }

  isRunning() {
    return this.running;
  }

  async sendHeartbeat() {
    if (!this.runtimeId || !this.runtimeToken) {
      this.lastError = "Runtime is not registered.";
      this.emitStatus();
      return null;
    }

    try {
      const response = await fetch("/api/robot-bridge/runtime/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.getAuthHeaders()
        },
        body: JSON.stringify({
          runtimeId: this.runtimeId,
          status:
            typeof this.getStatusSnapshot === "function" ? this.getStatusSnapshot() : {}
        })
      });
      const payload = await parseJsonResponse(response);

      this.lastHeartbeatAt = Date.now();
      this.lastError = null;
      this.emitStatus();
      return payload;
    } catch (error) {
      this.lastError = error.message;
      this.emitStatus();
      this.log(`Robot runtime heartbeat failed: ${error.message}`, "warn");
      return null;
    }
  }

  getAuthHeaders() {
    if (!this.runtimeToken) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.runtimeToken}`
    };
  }

  getRuntimeInfo() {
    return {
      runtimeId: this.runtimeId,
      expiresAt: this.expiresAt,
      running: this.running,
      registered: this.registered,
      requireRuntimeAuth: this.requireRuntimeAuth,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError
    };
  }

  clearPairing() {
    this.stop();
    this.runtimeId = null;
    this.runtimeToken = null;
    this.expiresAt = null;
    this.registered = false;
    this.lastHeartbeatAt = null;
    this.lastError = null;
    this.emitStatus();
  }

  onStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  emitStatus() {
    const status = this.getRuntimeInfo();
    this.statusCallbacks.forEach((callback) => callback(status));
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

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}
