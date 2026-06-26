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
  "wake up loey",
  "hey louis",
  "hello louis",
  "hi louis",
  "louis wake up",
  "wake up louis",
  "hey luis",
  "hello luis",
  "hi luis",
  "luis wake up",
  "wake up luis",
  "hey louise",
  "hello louise",
  "hi louise",
  "louise wake up",
  "wake up louise",
  "hey hallelui",
  "hello hallelui",
  "hi hallelui",
  "hallelui wake up",
  "wake up hallelui"
]);

const BASE_RESTART_DELAY_MS = 2500;
const MAX_RESTART_DELAY_MS = 8000;
const QUICK_END_BACKOFF_MS = 3000;
const DETECTION_COOLDOWN_MS = 1800;
const NON_RETRYABLE_ERRORS = new Set([
  "audio-capture",
  "not-allowed",
  "service-not-allowed"
]);

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
    this.restartDelayMs = BASE_RESTART_DELAY_MS;
    this.recognitionStartedAt = 0;
    this.lastResultAt = 0;
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
      this.recognitionStartedAt = Date.now();
      this.emitStatus();
      this.log(`Wake phrase detector listening (${reason}).`, "info");
    };

    recognition.onresult = (event) => {
      this.handleResult(event);
    };

    recognition.onerror = (event) => {
      this.lastError = event?.error || "wake_detector_error";
      if (NON_RETRYABLE_ERRORS.has(this.lastError)) {
        this.wanted = false;
      }
      this.emitStatus();
      this.log(`Wake phrase detector error: ${this.lastError}`, "warn");
    };

    recognition.onend = () => {
      this.listening = false;
      this.recognition = null;
      this.emitStatus();
      if (this.wanted) {
        this.scheduleRestart("wake_detector_auto_restart");
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
        this.scheduleRestart("wake_detector_start_retry");
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

  scheduleRestart(reason = "wake_detector_auto_restart") {
    this.clearRestartTimer();
    const delayMs = this.nextRestartDelayMs();
    this.restartTimer = globalThis.setTimeout(() => {
      this.restartTimer = 0;
      if (this.wanted) {
        this.startRecognition(reason);
      }
    }, delayMs);
  }

  nextRestartDelayMs() {
    const now = Date.now();
    const activeForMs = this.recognitionStartedAt ? now - this.recognitionStartedAt : 0;
    const heardRecently = this.lastResultAt > 0 && now - this.lastResultAt < QUICK_END_BACKOFF_MS;
    const endedQuickly = activeForMs > 0 && activeForMs < QUICK_END_BACKOFF_MS && !heardRecently;

    if (endedQuickly) {
      this.restartDelayMs = Math.min(
        MAX_RESTART_DELAY_MS,
        Math.max(BASE_RESTART_DELAY_MS, Math.round(this.restartDelayMs * 1.7))
      );
    } else {
      this.restartDelayMs = BASE_RESTART_DELAY_MS;
    }

    return this.restartDelayMs;
  }

  clearRestartTimer() {
    if (this.restartTimer) {
      globalThis.clearTimeout(this.restartTimer);
      this.restartTimer = 0;
    }
  }

  handleResult(event = {}) {
    this.lastResultAt = Date.now();
    const transcripts = [];
    const finalTranscripts = [];
    for (let index = event.resultIndex || 0; index < (event.results?.length || 0); index += 1) {
      const result = event.results?.[index];
      const text = result?.[0]?.transcript;
      if (text) {
        transcripts.push(text);
        if (result.isFinal) {
          finalTranscripts.push(text);
        }
      }
    }

    const transcript = transcripts.join(" ").trim();
    if (!transcript) {
      return;
    }

    this.lastTranscript = transcript;
    this.emitStatus();

    const finalTranscript = finalTranscripts.join(" ").trim();
    if (!finalTranscript) {
      return;
    }

    const match = findWakePhrase(finalTranscript, this.phrases);
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
      transcript: finalTranscript,
      rawTranscript: transcript,
      commandText: extractWakeCommandText(finalTranscript)
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
    /\b(?:hey|hello|hi)\s+(?:looi|louie|looey|loey|louis|luis|louise|hallelui)\b\s*(.*)$/u,
    /\b(?:looi|louie|looey|loey|louis|luis|louise|hallelui)\s+wake\s+up\b\s*(.*)$/u,
    /\bwake\s+up\s+(?:looi|louie|looey|loey|louis|luis|louise|hallelui)\b\s*(.*)$/u
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
