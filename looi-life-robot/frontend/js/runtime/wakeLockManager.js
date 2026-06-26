export class WakeLockManager {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.sentinel = null;
    this.requested = false;
    this.callbacks = new Set();
    this.onVisibilityChange = () => {
      if (this.requested && !this.sentinel && globalThis.document?.visibilityState === "visible") {
        this.request().catch((error) => this.log(`Wake lock restore failed: ${error.message}`, "warn"));
      }
    };
    globalThis.document?.addEventListener?.("visibilitychange", this.onVisibilityChange);
  }

  isSupported() {
    return Boolean(globalThis.navigator?.wakeLock?.request);
  }

  async request() {
    this.requested = true;

    if (!this.isSupported()) {
      this.emitStatus("unsupported");
      return this.getStatus();
    }

    try {
      this.sentinel = await globalThis.navigator.wakeLock.request("screen");
      this.sentinel.addEventListener?.("release", () => {
        this.sentinel = null;
        this.emitStatus("released");
      });
      this.emitStatus("active");
    } catch (error) {
      this.sentinel = null;
      this.emitStatus(error.message);
      throw error;
    }

    return this.getStatus();
  }

  async release() {
    this.requested = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    await sentinel?.release?.();
    this.emitStatus("released");
    return this.getStatus();
  }

  isActive() {
    return Boolean(this.sentinel);
  }

  getStatus() {
    return {
      supported: this.isSupported(),
      active: this.isActive(),
      requested: this.requested,
      secureContext: globalThis.isSecureContext !== false
    };
  }

  onStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  emitStatus(reason = "status") {
    const status = { ...this.getStatus(), reason };
    this.callbacks.forEach((callback) => callback(status));
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}
