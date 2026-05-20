export class ReliabilityManager {
  constructor({
    performanceMonitor,
    cameraInput,
    logger
  } = {}) {
    this.performanceMonitor = performanceMonitor;
    this.cameraInput = cameraInput;
    this.logger = logger;
    this.running = false;
    this.mode = "normal";
    this.unsubscribe = null;
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.unsubscribe = this.performanceMonitor?.onStatus?.((status) => {
      if (status.fps > 0 && status.fps < 20) {
        this.setMode("quiet");
      } else if (status.fps > 0 && status.fps < 28) {
        this.setMode("reduced");
      } else if (this.mode !== "normal" && status.fps > 36) {
        this.setMode("normal");
      }
    });
    return this.getStatus();
  }

  stop() {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    return this.getStatus();
  }

  setMode(mode) {
    const next = ["normal", "reduced", "quiet"].includes(mode) ? mode : "normal";
    if (next === this.mode) {
      return this.getStatus();
    }

    this.mode = next;
    this.log(`Reliability mode: ${next}`, next === "normal" ? "info" : "warn");
    return this.getStatus();
  }

  getStatus() {
    return {
      running: this.running,
      mode: this.mode,
      cameraRunning: Boolean(this.cameraInput?.getCameraStatus?.().running)
    };
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}
