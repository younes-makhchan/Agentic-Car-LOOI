const SAFE_LEARNED_ACTIONS = new Set([
  "speak",
  "express",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember"
]);

const DEFAULT_PHRASE_MAPPINGS = [
  {
    phrases: ["come here", "come closer", "come vibe with me", "come to me"],
    meaning: "move closer to the user",
    action: "approach_user",
    args: { style: "happy", distance: "short" }
  },
  {
    phrases: ["go back", "back up", "give me space", "not too close", "move away"],
    meaning: "increase distance from the user",
    action: "retreat",
    args: { style: "gentle", distance: "short" }
  },
  {
    phrases: ["look around", "check the room", "what do you see"],
    meaning: "look around or observe the scene",
    action: "curious_scan",
    args: { direction: "both", intensity: 0.55 }
  },
  {
    phrases: ["stop", "freeze", "don't move", "do not move", "halt"],
    meaning: "stop immediately",
    action: "stop",
    args: { reason: "user_stop_phrase" }
  }
];

export function normalizePhrase(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferKnownIntent(text, learnedPhrases = []) {
  const normalizedText = normalizePhrase(text);

  if (!normalizedText) {
    return null;
  }

  const learnedMatches = learnedPhrases
    .map((entry) => matchLearnedPhrase(normalizedText, entry))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (learnedMatches[0]) {
    return learnedMatches[0];
  }

  for (const mapping of DEFAULT_PHRASE_MAPPINGS) {
    const matchedPhrase = mapping.phrases.find((phrase) =>
      matchesPhrase(normalizedText, normalizePhrase(phrase))
    );

    if (matchedPhrase) {
      return {
        source: "default_mapping",
        phrase: matchedPhrase,
        normalizedPhrase: normalizePhrase(matchedPhrase),
        meaning: mapping.meaning,
        action: mapping.action,
        args: { ...mapping.args },
        confidence: "medium",
        score: normalizedText === normalizePhrase(matchedPhrase) ? 1 : 0.78
      };
    }
  }

  return null;
}

export function createLearnedPhrase({
  phrase,
  meaning = "",
  action,
  args = {},
  confidence = "medium",
  source = "manual"
} = {}) {
  const entry = {
    id: `phrase_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    phrase: sanitizeString(phrase, 160),
    normalizedPhrase: normalizePhrase(phrase),
    meaning: sanitizeString(meaning, 240),
    action,
    args: sanitizeArgs(args),
    confidence: normalizeConfidence(confidence),
    source: sanitizeString(source, 80) || "manual",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    useCount: 0
  };

  const validation = validateLearnedPhrase(entry);

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return entry;
}

export function validateLearnedPhrase(entry = {}) {
  if (!entry || typeof entry !== "object") {
    return { ok: false, error: "learned phrase must be an object" };
  }

  const phrase = sanitizeString(entry.phrase, 160);

  if (!phrase) {
    return { ok: false, error: "phrase is required" };
  }

  if (!SAFE_LEARNED_ACTIONS.has(entry.action)) {
    return { ok: false, error: "learned phrase action must be a safe high-level action" };
  }

  if (!entry.args || typeof entry.args !== "object" || Array.isArray(entry.args)) {
    return { ok: false, error: "learned phrase args must be an object" };
  }

  if (!["low", "medium", "high"].includes(entry.confidence ?? "medium")) {
    return { ok: false, error: "confidence must be low, medium, or high" };
  }

  return { ok: true };
}

function matchLearnedPhrase(normalizedText, entry = {}) {
  const phrase = normalizePhrase(entry.normalizedPhrase || entry.phrase);

  if (!phrase || !SAFE_LEARNED_ACTIONS.has(entry.action)) {
    return null;
  }

  if (!matchesPhrase(normalizedText, phrase)) {
    return null;
  }

  const exact = normalizedText === phrase;

  return {
    source: "learned_phrase",
    id: entry.id ?? null,
    phrase: entry.phrase,
    normalizedPhrase: phrase,
    meaning: entry.meaning ?? "",
    action: entry.action,
    args: sanitizeArgs(entry.args),
    confidence: entry.confidence ?? "medium",
    score: exact ? 1 : 0.86
  };
}

function matchesPhrase(text, phrase) {
  return text === phrase || text.includes(` ${phrase} `) || text.startsWith(`${phrase} `) || text.endsWith(` ${phrase}`);
}

function sanitizeArgs(args) {
  return args && typeof args === "object" && !Array.isArray(args)
    ? JSON.parse(JSON.stringify(args))
    : {};
}

function normalizeConfidence(confidence) {
  return ["low", "medium", "high"].includes(confidence) ? confidence : "medium";
}

function sanitizeString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
