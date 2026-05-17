export class BrainLatencyBudget {
  constructor({
    eventThoughtTimeoutMs = 2500,
    autonomousThoughtTimeoutMs = 5000,
    fallbackOnTimeout = true,
    maxConcurrentThoughts = 1
  } = {}) {
    this.eventThoughtTimeoutMs = eventThoughtTimeoutMs;
    this.autonomousThoughtTimeoutMs = autonomousThoughtTimeoutMs;
    this.fallbackOnTimeout = fallbackOnTimeout;
    this.maxConcurrentThoughts = maxConcurrentThoughts;
    this.latencies = [];
  }

  async withTimeout(promise, timeoutMs, fallbackFn) {
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = globalThis.setTimeout(async () => {
        if (!this.fallbackOnTimeout || typeof fallbackFn !== "function") {
          reject(new Error("brain_timeout"));
          return;
        }

        try {
          resolve(await fallbackFn());
        } catch (error) {
          reject(error);
        }
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  shouldUseFallback(latencyMs, reason = "event") {
    const budget = reason === "autonomous_tick" || reason === "autonomous"
      ? this.autonomousThoughtTimeoutMs
      : this.eventThoughtTimeoutMs;
    return Number(latencyMs) > budget;
  }

  recordLatency(source, latencyMs) {
    const entry = {
      source: source ?? "unknown",
      latencyMs: Number(latencyMs) || 0,
      timestamp: new Date().toISOString()
    };
    this.latencies.unshift(entry);
    this.latencies.length = Math.min(50, this.latencies.length);
    return entry;
  }

  getStats() {
    const values = this.latencies.map((entry) => entry.latencyMs);
    const average = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    return {
      eventThoughtTimeoutMs: this.eventThoughtTimeoutMs,
      autonomousThoughtTimeoutMs: this.autonomousThoughtTimeoutMs,
      fallbackOnTimeout: this.fallbackOnTimeout,
      maxConcurrentThoughts: this.maxConcurrentThoughts,
      count: values.length,
      averageLatencyMs: average,
      latest: this.latencies[0] ?? null
    };
  }
}
