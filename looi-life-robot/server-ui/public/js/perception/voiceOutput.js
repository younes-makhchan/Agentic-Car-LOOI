export class VoiceOutput {
  constructor({ logger, face, lifeEngine } = {}) {
    this.logger = logger;
    this.face = face;
    this.lifeEngine = lifeEngine;
    this.supported =
      Boolean(globalThis.speechSynthesis) &&
      typeof globalThis.SpeechSynthesisUtterance === "function";
    this.muted = false;
    this.speaking = false;
    this.selectedVoiceName = "";
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.statusCallbacks = new Set();
  }

  isSupported() {
    return this.supported;
  }

  getVoices() {
    if (!this.supported || typeof globalThis.speechSynthesis.getVoices !== "function") {
      return [];
    }

    return globalThis.speechSynthesis.getVoices();
  }

  setVoiceByName(name) {
    this.selectedVoiceName = typeof name === "string" ? name : "";
    this.emitStatus();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.muted) {
      this.cancel("muted");
    }
    this.emitStatus();
  }

  setRate(rate) {
    this.rate = clampNumber(rate, 0.6, 1.4, 1);
    this.emitStatus();
  }

  setPitch(pitch) {
    this.pitch = clampNumber(pitch, 0.6, 1.4, 1);
    this.emitStatus();
  }

  setVolume(volume) {
    this.volume = clampNumber(volume, 0, 1, 1);
    this.emitStatus();
  }

  async speak({ text, tone = "soft", interrupt = false } = {}) {
    const safeText = typeof text === "string" ? text.trim().slice(0, 500) : "";

    if (!safeText) {
      return { executed: false, reason: "empty_text", muted: this.muted };
    }

    if (this.muted) {
      return { executed: false, reason: "muted", muted: true, textLength: safeText.length };
    }

    if (!this.supported) {
      return { executed: false, reason: "unsupported", muted: false, textLength: safeText.length };
    }

    if (interrupt) {
      this.cancel("interrupt");
    }

    this.setSpeaking(true);

    try {
      await new Promise((resolve) => {
        const utterance = new globalThis.SpeechSynthesisUtterance(safeText);
        const voice = this.getVoices().find((item) => item.name === this.selectedVoiceName);
        const toneShape = toneToShape(tone);
        const timeout = globalThis.setTimeout(resolve, Math.min(9000, 1200 + safeText.length * 55));

        if (voice) {
          utterance.voice = voice;
        }

        utterance.rate = clampNumber(this.rate * toneShape.rate, 0.5, 1.6, 1);
        utterance.pitch = clampNumber(this.pitch * toneShape.pitch, 0.5, 1.8, 1);
        utterance.volume = clampNumber(this.volume * toneShape.volume, 0, 1, 1);
        utterance.onend = () => {
          clearTimeout(timeout);
          resolve();
        };
        utterance.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };

        globalThis.speechSynthesis.speak(utterance);
      });

      return {
        executed: true,
        reason: "spoken",
        muted: false,
        textLength: safeText.length,
        tone
      };
    } finally {
      this.setSpeaking(false);
    }
  }

  cancel(reason = "cancel") {
    if (this.supported) {
      globalThis.speechSynthesis.cancel();
    }

    this.setSpeaking(false);
    this.log(`Voice output canceled: ${reason}`);
  }

  isSpeaking() {
    return this.speaking;
  }

  onStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  getStatus() {
    return {
      supported: this.supported,
      muted: this.muted,
      speaking: this.speaking,
      selectedVoiceName: this.selectedVoiceName,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume
    };
  }

  setSpeaking(value) {
    this.speaking = Boolean(value);
    this.lifeEngine?.setSpeaking?.(this.speaking);
    this.face?.setSpeaking?.(this.speaking);
    this.emitStatus();
  }

  emitStatus() {
    const status = this.getStatus();
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

function toneToShape(tone) {
  return {
    happy: { rate: 1.05, pitch: 1.08, volume: 1 },
    playful: { rate: 1.1, pitch: 1.12, volume: 1 },
    curious: { rate: 1.02, pitch: 1.05, volume: 1 },
    shy: { rate: 0.9, pitch: 0.95, volume: 0.86 },
    soft: { rate: 0.92, pitch: 1, volume: 0.9 },
    serious: { rate: 0.9, pitch: 0.92, volume: 1 }
  }[tone] ?? { rate: 1, pitch: 1, volume: 1 };
}

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}
