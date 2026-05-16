export class ClawBridgeClient {
  constructor({ logger, pollMs = 1000, getAuthHeaders = () => ({}) } = {}) {
    this.logger = logger;
    this.pollMs = pollMs;
    this.getAuthHeaders = getAuthHeaders;
    this.running = false;
    this.pollTimer = null;
    this.pollInFlight = false;
    this.processing = false;
    this.actionCallbacks = new Set();
    this.statusCallbacks = new Set();
    this.recentActions = [];
    this.lastPollAt = null;
    this.lastError = null;
    this.receivedCount = 0;
  }

  start() {
    if (this.running) {
      this.emitStatus();
      return;
    }

    this.running = true;
    this.emitStatus();
    this.log("KimiClaw bridge polling started.");
    this.pollOnce();
    this.pollTimer = globalThis.setInterval(() => this.pollOnce(), this.pollMs);
  }

  stop() {
    this.running = false;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.emitStatus();
    this.log("KimiClaw bridge polling stopped.");
  }

  isRunning() {
    return this.running;
  }

  async pollOnce() {
    if (this.pollInFlight) {
      return [];
    }

    this.pollInFlight = true;

    try {
      const actions = await this.claimActions(10);

      this.processing = actions.length > 0;
      this.emitStatus();

      for (const action of actions) {
        this.recentActions.unshift(action);
        this.recentActions.length = Math.min(this.recentActions.length, 50);
        this.receivedCount += 1;
        this.log(`KimiClaw Cloud action claimed: ${action.type} (${action.id})`);
        await Promise.all(
          [...this.actionCallbacks].map((callback) =>
            Promise.resolve(callback(action)).catch((error) => {
              this.log(
                `KimiClaw action callback failed for ${action.id}: ${error.message}`,
                "warn"
              );
            })
          )
        );
      }

      this.lastPollAt = Date.now();
      this.lastError = null;
      this.emitStatus();
      return actions;
    } catch (error) {
      this.lastError = error.message;
      this.log(`KimiClaw bridge poll failed: ${error.message}`, "warn");
      this.emitStatus();
      return [];
    } finally {
      this.processing = false;
      this.pollInFlight = false;
      this.emitStatus();
    }
  }

  async claimActions(limit = 10) {
    const response = await fetch("/api/robot-bridge/actions/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.safeAuthHeaders()
      },
      body: JSON.stringify({
        consumer: "phone-browser",
        limit
      })
    });

    const payload = await parseJsonResponse(response);
    return payload.actions ?? [];
  }

  async completeAction(id, result = {}) {
    return this.postActionResult(id, "complete", { result });
  }

  async failAction(id, error) {
    return this.postActionResult(id, "fail", { error });
  }

  async rejectAction(id, error) {
    return this.postActionResult(id, "reject", { error });
  }

  async injectTestAction(action = {}) {
    const response = await fetch("/api/robot-bridge/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: "test",
        type: "curious_scan",
        args: {
          direction: "both",
          intensity: 0.7
        },
        reason: "local UI test",
        ...action
      })
    });

    return parseJsonResponse(response);
  }

  onAction(callback) {
    return this.registerCallback(this.actionCallbacks, callback);
  }

  onStatus(callback) {
    return this.registerCallback(this.statusCallbacks, callback);
  }

  getRecentActions() {
    return [...this.recentActions];
  }

  async postActionResult(id, endpoint, body) {
    const response = await fetch(`/api/robot-bridge/actions/${encodeURIComponent(id)}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.safeAuthHeaders()
      },
      body: JSON.stringify(body)
    });

    return parseJsonResponse(response);
  }

  registerCallback(store, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    store.add(callback);
    return () => store.delete(callback);
  }

  emitStatus(extra = {}) {
    const status = {
      running: this.running,
      pollMs: this.pollMs,
      recentCount: this.recentActions.length,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      receivedCount: this.receivedCount,
      processing: this.processing,
      ...extra
    };

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

  safeAuthHeaders() {
    try {
      const headers = this.getAuthHeaders();
      return headers && typeof headers === "object" ? headers : {};
    } catch (error) {
      this.log(`Runtime auth headers unavailable: ${error.message}`, "warn");
      return {};
    }
  }
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}
