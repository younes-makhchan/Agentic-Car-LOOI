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
    const safeContext = sanitizeBrainRequestValue(context);
    const safeTriggerEvent = sanitizeBrainRequestValue(context.triggerEvent ?? null);
    const response = await fetch("/api/local-brain/think", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: safeContext.reason ?? context.reason ?? "manual",
        triggerEvent: safeTriggerEvent,
        context: safeContext
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

export function sanitizeBrainRequestValue(value, depth = 0) {
  if (depth > 8) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeBrainRequestValue(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return sanitizeBrainRequestScalar(value);
  }

  const result = {};

  Object.entries(value).forEach(([key, child]) => {
    if (isMediaKey(key)) {
      return;
    }

    result[key] = sanitizeBrainRequestValue(child, depth + 1);
  });

  return result;
}

function sanitizeBrainRequestScalar(value) {
  if (typeof value !== "string") {
    return value;
  }

  if (isMediaLikeString(value)) {
    return "[local_media_omitted]";
  }

  return value.length > 800 ? `${value.slice(0, 800)}...` : value;
}

function isMediaKey(key) {
  return /^(dataUrl|data_url|imageData|image_data|base64|blob|raw)$/i.test(String(key));
}

function isMediaLikeString(value) {
  return /^data:(image|audio|video)\//i.test(value) || /^[A-Za-z0-9+/]{12000,}={0,2}$/.test(value);
}
