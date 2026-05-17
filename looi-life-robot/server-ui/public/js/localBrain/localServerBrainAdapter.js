export class LocalServerBrainAdapter {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.latestStatus = null;
    this.latestLatencyMs = null;
    this.lastError = null;
  }

  async isAvailable() {
    const status = await this.status().catch(() => null);
    return Boolean(status?.brain?.enabled && status?.brain?.available);
  }

  async status() {
    const response = await fetch("/api/local-brain/status", {
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? `Local brain status HTTP ${response.status}`);
    }

    this.latestStatus = payload;
    this.lastError = null;
    return payload;
  }

  async think(context = {}) {
    const response = await fetch("/api/local-brain/think", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: context.reason ?? "manual",
        triggerEvent: context.triggerEvent ?? null,
        context
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      const message = payload.error ?? `Local brain think HTTP ${response.status}`;
      this.lastError = message;
      throw new Error(message);
    }

    this.latestLatencyMs = Number(payload.latencyMs ?? 0);
    this.lastError = null;

    return {
      ...payload,
      source: "local-server",
      reason: payload.reason ?? "local_server_response"
    };
  }

  getStatus() {
    return {
      provider: this.latestStatus?.brain?.provider ?? "local-server",
      model: this.latestStatus?.brain?.model ?? "",
      available: Boolean(this.latestStatus?.brain?.available),
      enabled: this.latestStatus?.brain?.enabled !== false,
      latestLatencyMs: this.latestLatencyMs,
      lastError: this.lastError
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}
