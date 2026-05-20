export class BrainLatencyBudget {
  constructor({
    eventThoughtTimeoutMs = 2500,
    fallbackOnTimeout = true,
    maxConcurrentThoughts = 1
  } = {}) {
    this.eventThoughtTimeoutMs = eventThoughtTimeoutMs;
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

  shouldUseFallback(latencyMs) {
    return Number(latencyMs) > this.eventThoughtTimeoutMs;
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
      fallbackOnTimeout: this.fallbackOnTimeout,
      maxConcurrentThoughts: this.maxConcurrentThoughts,
      count: values.length,
      averageLatencyMs: average,
      latest: this.latencies[0] ?? null
    };
  }
}
