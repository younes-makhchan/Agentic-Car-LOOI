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
    this.finalCallbacks = new Set();
    this.interimCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.statusCallbacks = new Set();
    const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    this.supported = typeof Recognition === "function";
    this.recognition = this.supported ? new Recognition() : null;
    this.configureRecognition();
  }

  isSupported() {
    return this.supported;
  }

  start() {
    if (!this.supported) {
      this.log("Speech recognition is not supported in this browser.", "warn");
      this.emitStatus({ error: "unsupported" });
      return this.getStatus();
    }

    if (this.listening) {
      return this.getStatus();
    }

    this.configureRecognition();

    try {
      this.recognition.start();
    } catch (error) {
      this.emitError(error);
    }

    return this.getStatus();
  }

  stop() {
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
      this.emitStatus();
    };
    this.recognition.onend = () => {
      this.listening = false;
      this.emitStatus();
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
        this.finalCallbacks.forEach((callback) => callback(payload));
      } else {
        this.interimCallbacks.forEach((callback) => callback(payload));
      }
    }
  }

  emitError(error) {
    this.log(`Speech recognition error: ${error.message}`, "warn");
    this.errorCallbacks.forEach((callback) => callback(error));
    this.emitStatus({ error: error.message });
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
