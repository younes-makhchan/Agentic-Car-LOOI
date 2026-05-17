const DEFAULT_ROBOT_NAMES = ["looi", "louie", "lui", "robot"];
const DIRECT_COMMAND_PATTERNS = [
  {
    action: "drive",
    regex: /\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/,
    args: { linear: 0.12, angular: 0, durationMs: 350 }
  },
  {
    action: "drive",
    regex: /\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/,
    args: { linear: -0.12, angular: 0, durationMs: 350 }
  },
  {
    action: "drive",
    regex: /\b(turn|rotate)\s+left\b/,
    args: { linear: 0, angular: -0.12, durationMs: 320 }
  },
  {
    action: "drive",
    regex: /\b(turn|rotate)\s+right\b/,
    args: { linear: 0, angular: 0.12, durationMs: 320 }
  },
  {
    action: "approach_user",
    regex: /\b(come here|come closer|come to me)\b/,
    args: { style: "gentle", distance: "short" }
  },
  {
    action: "retreat",
    regex: /\b(give me (space|room)|go back|back up|not too close)\b/,
    args: { style: "gentle", distance: "short" }
  },
  {
    action: "curious_scan",
    regex: /\b(look around|check the room|scan)\b/,
    args: { direction: "both", intensity: 0.55 }
  }
];

export class SpeechGate {
  constructor({
    robotNames = DEFAULT_ROBOT_NAMES,
    logger,
    getContext
  } = {}) {
    this.robotNames = normalizeNames(robotNames);
    this.logger = logger;
    this.getContext = getContext;
    this.lastWakeAt = 0;
    this.attentionWindowMs = 20000;
    this.conversationWindowMs = 30000;
    this.lastRelevantSpeechAt = 0;
    this.recentTranscripts = [];
    this.ignoredCount = 0;
    this.relevantCount = 0;
    this.lastResult = null;
  }

  processTranscript(transcript = {}) {
    const now = transcript.timestamp ? Date.parse(transcript.timestamp) || Date.now() : Date.now();
    const context = typeof this.getContext === "function" ? this.getContext() : {};
    const result = classifySpeech(transcript.text, {
      ...context,
      source: transcript.source,
      confidence: transcript.confidence,
      robotNames: this.robotNames,
      attentionWindowOpen: this.isAttentionWindowOpen(now),
      lastRelevantSpeechAt: this.lastRelevantSpeechAt
    });

    const entry = {
      text: transcript.text ?? "",
      confidence: transcript.confidence ?? null,
      language: transcript.language ?? null,
      source: transcript.source ?? "speech",
      timestamp: transcript.timestamp ?? new Date(now).toISOString(),
      classification: result.classification,
      accepted: result.accepted,
      shouldTriggerBrain: result.shouldTriggerBrain
    };
    this.recentTranscripts.unshift(entry);
    this.recentTranscripts.length = Math.min(50, this.recentTranscripts.length);

    if (result.shouldOpenAttention) {
      this.openAttentionWindow(result.classification, now);
    }

    if (result.accepted) {
      this.relevantCount += 1;
      this.lastRelevantSpeechAt = now;
    } else {
      this.ignoredCount += 1;
    }

    this.lastResult = result;
    return result;
  }

  setRobotNames(names) {
    this.robotNames = normalizeNames(names);
  }

  isAttentionWindowOpen(now = Date.now()) {
    return now - Number(this.lastWakeAt || 0) <= this.attentionWindowMs;
  }

  openAttentionWindow(reason = "manual", now = Date.now()) {
    this.lastWakeAt = now;
    this.log(`Speech attention opened: ${reason}`);
  }

  closeAttentionWindow(reason = "manual") {
    this.lastWakeAt = 0;
    this.log(`Speech attention closed: ${reason}`);
  }

  getStatus() {
    const now = Date.now();
    const remaining = Math.max(0, this.attentionWindowMs - (now - Number(this.lastWakeAt || 0)));
    return {
      robotNames: [...this.robotNames],
      attentionOpen: this.isAttentionWindowOpen(now),
      attentionRemainingMs: this.isAttentionWindowOpen(now) ? remaining : 0,
      lastWakeAt: this.lastWakeAt,
      lastRelevantSpeechAt: this.lastRelevantSpeechAt,
      ignoredCount: this.ignoredCount,
      relevantCount: this.relevantCount,
      lastResult: this.lastResult
    };
  }

  getRecentTranscripts({ limit = 20 } = {}) {
    const max = Math.min(50, Math.max(1, Number(limit) || 20));
    return this.recentTranscripts.slice(0, max);
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

export function classifySpeech(text, context = {}) {
  const normalizedText = normalizeSpeechText(text);
  const rawConfidence = Number(context.confidence);
  const confidence = Number.isFinite(rawConfidence) && rawConfidence > 0 ? rawConfidence : 1;
  const source = context.source ?? "speech";
  const robotNames = normalizeNames(context.robotNames ?? DEFAULT_ROBOT_NAMES);
  const hasWakeName = looksLikeWakeName(normalizedText, robotNames);
  const textWithoutName = stripWakeNames(normalizedText, robotNames);
  const attentionWindowOpen = Boolean(context.attentionWindowOpen);
  const directIntent = inferSuggestedIntent(textWithoutName || normalizedText);
  const isTyped = source === "typed";
  const lifeState = context.lifeState ?? {};
  const userVisible = Boolean(lifeState.userVisible);
  const userNear = ["near", "medium", "close"].includes(String(lifeState.userDistance ?? "").toLowerCase());
  const liveMindActive = Boolean(
    context.localPolicy?.localBrainEnabled &&
    (context.speechStatus?.alwaysListening || context.speechStatus?.listening)
  );

  if (!normalizedText || confidence < 0.15) {
    return result("noise", false, "low", false, false, false, normalizedText, "empty_or_low_confidence");
  }

  if (isLocalStopPhrase(normalizedText)) {
    return result("safety_stop", true, "critical", false, false, true, normalizedText, "local_stop_phrase");
  }

  if (hasWakeName && !textWithoutName) {
    return result("wake_name", true, "high", false, true, false, normalizedText, "wake_name_only");
  }

  if (hasWakeName) {
    return result(
      "direct_to_robot",
      true,
      "high",
      true,
      true,
      false,
      normalizedText,
      "wake_name_with_content",
      directIntent
    );
  }

  if (attentionWindowOpen || isTyped) {
    if (directIntent || looksLikeQuestion(normalizedText) || looksSocial(normalizedText)) {
      return result(
        directIntent ? "direct_to_robot" : looksLikeQuestion(normalizedText) ? "question" : "social_comment",
        true,
        "normal",
        true,
        true,
        false,
        normalizedText,
        attentionWindowOpen ? "attention_window_open" : "typed_input",
        directIntent
      );
    }
  }

  if (
    liveMindActive &&
    confidence >= 0.45 &&
    (startsWithGreeting(normalizedText) || looksLikeQuestion(normalizedText) || looksLikeAssistantRequest(normalizedText))
  ) {
    return result(
      directIntent ? "direct_to_robot" : looksLikeQuestion(normalizedText) ? "question" : "social_comment",
      true,
      "normal",
      true,
      true,
      false,
      normalizedText,
      "live_mind_social_or_request",
      directIntent
    );
  }

  if ((userVisible || userNear) && directIntent && confidence >= 0.45) {
    return result(
      "possible_direct_command",
      true,
      "normal",
      true,
      false,
      false,
      normalizedText,
      "visible_user_possible_command",
      directIntent
    );
  }

  if (directIntent && isTyped) {
    return result("direct_to_robot", true, "normal", true, true, false, normalizedText, "typed_direct_command", directIntent);
  }

  if (confidence < 0.45) {
    return result("noise", false, "low", false, false, false, normalizedText, "low_confidence_background");
  }

  return result("background", false, "low", false, false, false, normalizedText, "not_addressed_to_robot");
}

export function normalizeSpeechText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s'?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLocalStopPhrase(text) {
  const normalized = normalizeSpeechText(text);

  if (/\bstop by\b/.test(normalized) || /\bstopping\b/.test(normalized)) {
    return false;
  }

  return (
    /(^|\s)(stop|freeze|halt)(\s|$)/.test(normalized) ||
    /\bdon't move\b/.test(normalized) ||
    /\bdo not move\b/.test(normalized) ||
    /\bemergency stop\b/.test(normalized) ||
    /\bstop moving\b/.test(normalized) ||
    /\bstay still\b/.test(normalized)
  );
}

export function looksLikeWakeName(text, names = DEFAULT_ROBOT_NAMES) {
  const normalized = normalizeSpeechText(text);
  return normalizeNames(names).some((name) => new RegExp(`(^|\\s)${escapeRegex(name)}(\\s|$)`).test(normalized));
}

function result(
  classification,
  accepted,
  priority,
  shouldTriggerBrain,
  shouldOpenAttention,
  shouldImmediateStop,
  normalizedText,
  reason,
  suggestedIntent = null
) {
  return {
    accepted,
    classification,
    priority,
    shouldTriggerBrain,
    shouldOpenAttention,
    shouldImmediateStop,
    normalizedText,
    reason,
    suggestedIntent
  };
}

function inferSuggestedIntent(text) {
  const normalized = normalizeSpeechText(text);
  const match = DIRECT_COMMAND_PATTERNS.find((pattern) => pattern.regex.test(normalized));

  if (match) {
    return {
      action: match.action,
      args: match.args,
      confidence: 0.8
    };
  }

  if (/\b(hello|hi|hey)\b/.test(normalized)) {
    return {
      action: "greeting",
      args: {},
      confidence: 0.65
    };
  }

  return null;
}

function looksLikeQuestion(text) {
  const normalized = normalizeSpeechText(text);
  return normalized.endsWith("?") || /^(why|what|who|how|can you|are you|do you)\b/.test(normalized);
}

function looksSocial(text) {
  return /\b(hello|hi|hey|good morning|good night|thank you|thanks)\b/.test(normalizeSpeechText(text));
}

function startsWithGreeting(text) {
  return /^(hello|hi|hey|good morning|good night)\b/.test(normalizeSpeechText(text));
}

function looksLikeAssistantRequest(text) {
  return /^(please\s+)?(can you|could you|would you|will you|move|come|look|listen|say|tell me|answer)\b/.test(
    normalizeSpeechText(text)
  );
}

function stripWakeNames(text, names) {
  let resultText = normalizeSpeechText(text);
  normalizeNames(names).forEach((name) => {
    resultText = resultText
      .replace(new RegExp(`(^|\\s)${escapeRegex(name)}(\\s|$)`, "g"), " ")
      .replace(/\s+/g, " ")
      .trim();
  });
  return resultText;
}

function normalizeNames(names) {
  const list = Array.isArray(names) ? names : String(names ?? "").split(",");
  const normalized = list.map(normalizeSpeechText).filter(Boolean);
  return normalized.length ? [...new Set(normalized)] : DEFAULT_ROBOT_NAMES;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
