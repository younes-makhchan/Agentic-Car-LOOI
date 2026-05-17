export class AudioLevelMonitor {
  constructor({
    logger,
    threshold = 0.04,
    smoothing = 0.85
  } = {}) {
    this.logger = logger;
    this.threshold = Number(threshold) || 0.04;
    this.smoothing = Number(smoothing) || 0.85;
    this.running = false;
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.rafId = null;
    this.level = 0;
    this.lastActivityAt = 0;
    this.levelCallbacks = new Set();
    this.voiceActivityCallbacks = new Set();
  }

  isSupported() {
    return Boolean(
      globalThis.navigator?.mediaDevices?.getUserMedia &&
      (globalThis.AudioContext || globalThis.webkitAudioContext)
    );
  }

  async start() {
    if (!this.isSupported()) {
      this.log("Audio level monitor unsupported.", "warn");
      return this.getStatus();
    }

    if (this.running) {
      return this.getStatus();
    }

    try {
      this.stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.running = true;
      this.loop();
    } catch (error) {
      this.log(`Audio level monitor failed: ${error.message}`, "warn");
      this.stop();
    }

    return this.getStatus();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      globalThis.cancelAnimationFrame?.(this.rafId);
      this.rafId = null;
    }
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.audioContext?.close?.().catch?.(() => {});
    this.audioContext = null;
    this.analyser = null;
    return this.getStatus();
  }

  isRunning() {
    return this.running;
  }

  onVoiceActivity(callback) {
    return register(this.voiceActivityCallbacks, callback);
  }

  onLevel(callback) {
    return register(this.levelCallbacks, callback);
  }

  getStatus() {
    return {
      supported: this.isSupported(),
      running: this.running,
      level: this.level,
      threshold: this.threshold,
      lastActivityAt: this.lastActivityAt
    };
  }

  loop() {
    if (!this.running || !this.analyser) {
      return;
    }

    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;

    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / data.length);
    this.level = this.level * this.smoothing + rms * (1 - this.smoothing);
    const timestamp = Date.now();
    const payload = {
      level: this.level,
      timestamp: new Date(timestamp).toISOString(),
      active: this.level >= this.threshold
    };

    this.levelCallbacks.forEach((callback) => callback(payload));

    if (payload.active && timestamp - this.lastActivityAt > 900) {
      this.lastActivityAt = timestamp;
      this.voiceActivityCallbacks.forEach((callback) => callback(payload));
    }

    this.rafId = globalThis.requestAnimationFrame?.(() => this.loop()) ??
      globalThis.setTimeout(() => this.loop(), 100);
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

function register(callbacks, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  callbacks.add(callback);
  return () => callbacks.delete(callback);
}
