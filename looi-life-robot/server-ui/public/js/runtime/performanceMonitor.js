export class PerformanceMonitor {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.running = false;
    this.rafId = null;
    this.lastFrameAt = 0;
    this.samples = [];
    this.longFrameCount = 0;
    this.brainLatencies = [];
    this.warnings = [];
    this.callbacks = new Set();
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }
    this.running = true;
    this.lastFrameAt = now();
    this.loop();
    return this.getStatus();
  }

  stop() {
    this.running = false;
    if (this.rafId && globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    return this.getStatus();
  }

  getStatus() {
    const fps = this.samples.length
      ? 1000 / (this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length)
      : 0;
    const averageBrainLatencyMs = this.brainLatencies.length
      ? this.brainLatencies.reduce((sum, value) => sum + value, 0) / this.brainLatencies.length
      : 0;

    return {
      running: this.running,
      fps,
      longFrameCount: this.longFrameCount,
      averageBrainLatencyMs,
      warnings: [...this.warnings]
    };
  }

  onStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  recordBrainLatency(latencyMs) {
    const value = Number(latencyMs);
    if (Number.isFinite(value)) {
      this.brainLatencies.unshift(value);
      this.brainLatencies.length = Math.min(this.brainLatencies.length, 40);
    }
  }

  recordWarning(message) {
    const entry = {
      message: String(message).slice(0, 180),
      timestamp: new Date().toISOString()
    };
    this.warnings.unshift(entry);
    this.warnings.length = Math.min(this.warnings.length, 20);
    this.emit();
  }

  loop() {
    if (!this.running) {
      return;
    }

    const current = now();
    const delta = current - this.lastFrameAt;
    this.lastFrameAt = current;

    if (delta > 0 && delta < 1000) {
      this.samples.unshift(delta);
      this.samples.length = Math.min(this.samples.length, 60);
      if (delta > 80) {
        this.longFrameCount += 1;
      }
    }

    const status = this.getStatus();
    if (status.fps > 0 && status.fps < 24 && this.warnings[0]?.message !== "Low browser FPS") {
      this.recordWarning("Low browser FPS");
    } else {
      this.emit(status);
    }

    this.rafId = globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame(() => this.loop())
      : globalThis.setTimeout(() => this.loop(), 250);
  }

  emit(status = this.getStatus()) {
    this.callbacks.forEach((callback) => callback(status));
  }
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}
