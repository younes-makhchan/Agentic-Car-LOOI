const DEFAULT_WAKE_PHRASES = Object.freeze([
  "hey looi",
  "hello looi",
  "hi looi",
  "looi wake up",
  "wake up looi",
  "hey louie",
  "hello louie",
  "hi louie",
  "louie wake up",
  "wake up louie",
  "hey looey",
  "hello looey",
  "hi looey",
  "hey loey",
  "hello loey",
  "hi loey",
  "loey wake up",
  "wake up loey"
]);

const RESTART_DELAY_MS = 650;
const DETECTION_COOLDOWN_MS = 1800;

export class WakePhraseDetector {
  constructor({
    phrases = DEFAULT_WAKE_PHRASES,
    lang = "en-US",
    onWakePhrase,
    onStatus,
    logger
  } = {}) {
    this.phrases = phrases.map(normalizeSpeechText).filter(Boolean);
    this.lang = lang;
    this.onWakePhrase = onWakePhrase;
    this.onStatus = onStatus;
    this.logger = logger;
    this.recognition = null;
    this.wanted = false;
    this.listening = false;
    this.restartTimer = 0;
    this.lastDetectionAt = 0;
    this.lastTranscript = "";
    this.lastError = "";
  }

  isSupported() {
    return Boolean(getSpeechRecognitionCtor());
  }

  getStatus() {
    return {
      supported: this.isSupported(),
      wanted: this.wanted,
      listening: this.listening,
      lastTranscript: this.lastTranscript,
      lastError: this.lastError
    };
  }

  start(reason = "wake_detector_start") {
    this.wanted = true;
    this.lastError = "";
    this.clearRestartTimer();

    if (!this.isSupported()) {
      this.lastError = "speech_recognition_unavailable";
      this.emitStatus();
      this.log("Wake phrase detector unavailable in this browser.", "warn");
      return false;
    }

    if (this.listening) {
      this.emitStatus();
      return true;
    }

    this.startRecognition(reason);
    return true;
  }

  stop(reason = "wake_detector_stop") {
    this.wanted = false;
    this.clearRestartTimer();
    this.stopRecognition(reason);
    this.emitStatus();
  }

  startRecognition(reason = "wake_detector_start") {
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      return;
    }

    this.stopRecognition("wake_detector_restart");
    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = this.lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.listening = true;
      this.emitStatus();
      this.log(`Wake phrase detector listening (${reason}).`, "info");
    };

    recognition.onresult = (event) => {
      this.handleResult(event);
    };

    recognition.onerror = (event) => {
      this.lastError = event?.error || "wake_detector_error";
      this.emitStatus();
      this.log(`Wake phrase detector error: ${this.lastError}`, "warn");
    };

    recognition.onend = () => {
      this.listening = false;
      this.recognition = null;
      this.emitStatus();
      if (this.wanted) {
        this.scheduleRestart();
      }
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.lastError = error.message;
      this.recognition = null;
      this.listening = false;
      this.emitStatus();
      if (this.wanted) {
        this.scheduleRestart();
      }
    }
  }

  stopRecognition(reason = "wake_detector_stop") {
    const recognition = this.recognition;
    this.recognition = null;
    this.listening = false;

    try {
      recognition?.stop?.();
    } catch (_error) {
      try {
        recognition?.abort?.();
      } catch (_abortError) {
        // Best-effort cleanup only.
      }
    }

    if (reason !== "wake_detector_restart") {
      this.log(`Wake phrase detector stopped (${reason}).`, "debug");
    }
  }

  scheduleRestart() {
    this.clearRestartTimer();
    this.restartTimer = globalThis.setTimeout(() => {
      this.restartTimer = 0;
      if (this.wanted) {
        this.startRecognition("wake_detector_auto_restart");
      }
    }, RESTART_DELAY_MS);
  }

  clearRestartTimer() {
    if (this.restartTimer) {
      globalThis.clearTimeout(this.restartTimer);
      this.restartTimer = 0;
    }
  }

  handleResult(event = {}) {
    const transcripts = [];
    for (let index = event.resultIndex || 0; index < (event.results?.length || 0); index += 1) {
      const text = event.results?.[index]?.[0]?.transcript;
      if (text) {
        transcripts.push(text);
      }
    }

    const transcript = transcripts.join(" ").trim();
    if (!transcript) {
      return;
    }

    this.lastTranscript = transcript;
    this.emitStatus();

    const match = findWakePhrase(transcript, this.phrases);
    if (!match) {
      return;
    }

    const now = Date.now();
    if (now - this.lastDetectionAt < DETECTION_COOLDOWN_MS) {
      return;
    }

    this.lastDetectionAt = now;
    this.onWakePhrase?.({
      phrase: match.phrase,
      transcript,
      commandText: extractWakeCommandText(transcript)
    });
  }

  emitStatus() {
    this.onStatus?.(this.getStatus());
  }

  log(message, level = "info") {
    this.logger?.(message, level);
  }
}

export function normalizeSpeechText(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findWakePhrase(transcript = "", phrases = DEFAULT_WAKE_PHRASES) {
  const normalized = normalizeSpeechText(transcript);
  if (!normalized) {
    return null;
  }

  const cleanPhrases = phrases.map(normalizeSpeechText).filter(Boolean);
  const phrase = cleanPhrases.find((candidate) => normalized.includes(candidate));
  return phrase ? { phrase } : null;
}

export function extractWakeCommandText(transcript = "") {
  const normalized = normalizeSpeechText(transcript);
  const patterns = [
    /\b(?:hey|hello|hi)\s+(?:looi|louie|looey|loey)\b\s*(.*)$/u,
    /\b(?:looi|louie|looey|loey)\s+wake\s+up\b\s*(.*)$/u,
    /\bwake\s+up\s+(?:looi|louie|looey|loey)\b\s*(.*)$/u
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const command = match?.[1]?.trim();
    if (command) {
      return command;
    }
  }

  return "";
}

function getSpeechRecognitionCtor() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}
