export class SpeechInput {
  constructor({
    logger,
    language = "en-US",
    continuous = true,
    interimResults = true
  } = {}) {
    this.logger = logger;
    this.language = language;
    this.continuous = continuous;
    this.interimResults = interimResults;
    this.listening = false;
    this.alwaysListening = false;
    this.manualStop = false;
    this.autoRestartDelayMs = 300;
    this.maxAutoRestartDelayMs = 3000;
    this.restartBackoffMs = this.autoRestartDelayMs;
    this.restartTimer = null;
    this.lastStartAt = 0;
    this.lastEndAt = 0;
    this.lastResultAt = 0;
    this.finalResultCount = 0;
    this.interimResultCount = 0;
    this.startAttemptCount = 0;
    this.lastError = null;
    this.lastErrorAt = 0;
    this.permissionBlocked = false;
    this.debugEvents = [];
    this.finalCallbacks = new Set();
    this.interimCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.statusCallbacks = new Set();
    const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    this.supported = typeof Recognition === "function";
    this.recognition = this.supported ? new Recognition() : null;
    this.recordDebug("init", this.supported ? "SpeechRecognition supported." : "SpeechRecognition unsupported.");
    this.configureRecognition();
  }

  isSupported() {
    return this.supported;
  }

  start() {
    this.manualStop = false;
    if (!this.supported) {
      this.recordDebug("unsupported", "Speech recognition is not supported in this browser.");
      this.emitStatus({ error: "unsupported" });
      return this.getStatus();
    }

    if (this.listening) {
      this.recordDebug("start_skip", "Already listening.");
      return this.getStatus();
    }

    this.configureRecognition();

    try {
      this.lastStartAt = Date.now();
      this.startAttemptCount += 1;
      this.recordDebug("start", `Starting recognition attempt ${this.startAttemptCount}.`);
      this.recognition.start();
    } catch (error) {
      this.emitError(error);
    }

    return this.getStatus();
  }

  stop() {
    this.manualStop = true;
    this.alwaysListening = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (!this.supported) {
      return this.getStatus();
    }

    try {
      this.recognition.stop();
    } catch (error) {
      this.emitError(error);
    }

    return this.getStatus();
  }

  abort() {
    this.manualStop = true;
    this.alwaysListening = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (!this.supported) {
      return this.getStatus();
    }

    try {
      this.recognition.abort();
    } catch (error) {
      this.emitError(error);
    }

    this.listening = false;
    this.emitStatus();
    return this.getStatus();
  }

  setLanguage(language) {
    if (typeof language === "string" && language.trim()) {
      this.language = language.trim();
      this.configureRecognition();
    }
  }

  setContinuous(value) {
    this.continuous = Boolean(value);
    this.configureRecognition();
  }

  startAlwaysListening() {
    this.alwaysListening = true;
    this.manualStop = false;
    this.permissionBlocked = false;
    this.restartBackoffMs = this.autoRestartDelayMs;
    this.setContinuous(true);
    return this.start();
  }

  stopAlwaysListening() {
    this.alwaysListening = false;
    return this.stop();
  }

  setAlwaysListening(enabled) {
    return enabled ? this.startAlwaysListening() : this.stopAlwaysListening();
  }

  isAlwaysListening() {
    return this.alwaysListening;
  }

  onFinal(callback) {
    return register(this.finalCallbacks, callback);
  }

  onInterim(callback) {
    return register(this.interimCallbacks, callback);
  }

  onError(callback) {
    return register(this.errorCallbacks, callback);
  }

  onStatus(callback) {
    return register(this.statusCallbacks, callback);
  }

  getStatus() {
    return {
      supported: this.supported,
      listening: this.listening,
      language: this.language,
      continuous: this.continuous,
      interimResults: this.interimResults,
      alwaysListening: this.alwaysListening,
      manualStop: this.manualStop,
      restartBackoffMs: this.restartBackoffMs,
      lastStartAt: this.lastStartAt,
      lastEndAt: this.lastEndAt,
      lastResultAt: this.lastResultAt,
      finalResultCount: this.finalResultCount,
      interimResultCount: this.interimResultCount,
      startAttemptCount: this.startAttemptCount,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      permissionBlocked: this.permissionBlocked,
      debugEvents: this.getDebugEvents({ limit: 8 }),
      secureContext: globalThis.isSecureContext !== false
    };
  }

  configureRecognition() {
    if (!this.recognition) {
      return;
    }

    this.recognition.lang = this.language;
    this.recognition.continuous = this.continuous;
    this.recognition.interimResults = this.interimResults;
    this.recognition.onstart = () => {
      this.listening = true;
      this.lastError = null;
      this.lastErrorAt = 0;
      this.restartBackoffMs = this.autoRestartDelayMs;
      this.recordDebug("start_ok", "Recognition started.");
      this.emitStatus();
    };
    this.recognition.onend = () => {
      this.listening = false;
      this.lastEndAt = Date.now();
      this.recordDebug("end", this.alwaysListening ? "Recognition ended; restart may follow." : "Recognition ended.");
      this.emitStatus();
      this.scheduleAutoRestart();
    };
    this.recognition.onerror = (event) => {
      this.emitError(event?.error ? new Error(event.error) : new Error("speech_error"));
    };
    this.recognition.onresult = (event) => this.handleResult(event);
  }

  handleResult(event) {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result[0];
      const text = String(alternative?.transcript ?? "").trim();

      if (!text) {
        continue;
      }

      const payload = {
        text,
        confidence: Number(alternative?.confidence ?? 0),
        language: this.language,
        timestamp: new Date().toISOString()
      };

      if (result.isFinal) {
        this.finalResultCount += 1;
        this.lastResultAt = Date.now();
        this.recordDebug("final", text);
        this.finalCallbacks.forEach((callback) => callback(payload));
      } else {
        this.interimResultCount += 1;
        this.lastResultAt = Date.now();
        this.recordDebug("interim", text);
        this.interimCallbacks.forEach((callback) => callback(payload));
      }
    }
  }

  emitError(error) {
    const message = error?.message ?? String(error ?? "speech_error");
    this.lastError = message;
    this.lastErrorAt = Date.now();
    this.recordDebug("error", message);
    if (["not-allowed", "service-not-allowed", "permission denied"].includes(message)) {
      this.permissionBlocked = true;
      this.alwaysListening = false;
    }
    this.errorCallbacks.forEach((callback) => callback(error));
    this.emitStatus({ error: error.message });
  }

  getDebugEvents({ limit = 20 } = {}) {
    const max = Math.max(1, Math.min(50, Number(limit) || 20));
    return this.debugEvents.slice(0, max).map((event) => ({ ...event }));
  }

  recordDebug(type, message) {
    this.debugEvents.unshift({
      type,
      message: String(message ?? "").slice(0, 240),
      timestamp: new Date().toISOString()
    });
    this.debugEvents.length = Math.min(50, this.debugEvents.length);
  }

  scheduleAutoRestart() {
    clearTimeout(this.restartTimer);

    if (
      !this.alwaysListening ||
      this.manualStop ||
      this.permissionBlocked ||
      !this.supported ||
      this.listening
    ) {
      return;
    }

    const delay = Math.min(this.maxAutoRestartDelayMs, this.restartBackoffMs);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;

      if (!this.alwaysListening || this.manualStop || this.permissionBlocked || this.listening) {
        return;
      }

      try {
        this.start();
      } finally {
        this.restartBackoffMs = Math.min(this.maxAutoRestartDelayMs, this.restartBackoffMs * 1.5);
      }
    }, delay);
  }

  emitStatus(extra = {}) {
    const status = {
      ...this.getStatus(),
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
}

function register(callbacks, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  callbacks.add(callback);
  return () => callbacks.delete(callback);
}

// Backward-compatible placeholders from earlier steps.
let legacySpeechInput = null;

export function startSpeechRecognition() {
  legacySpeechInput ??= new SpeechInput();
  return legacySpeechInput.start();
}

export function stopSpeechRecognition() {
  legacySpeechInput ??= new SpeechInput();
  return legacySpeechInput.stop();
}
