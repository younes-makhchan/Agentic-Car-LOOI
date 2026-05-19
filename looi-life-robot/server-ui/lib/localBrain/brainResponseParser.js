import { normalizeScenarioName } from "../../public/js/embodiment/scenarioCatalog.js";

export const LOCAL_BRAIN_ALLOWED_ACTIONS = new Set(["perform", "set_follow_target", "follow_target_stop"]);

const UNSAFE_ARG_KEYS = new Set([
  "pwm",
  "raw_pwm",
  "left_pwm",
  "right_pwm",
  "left_motor",
  "right_motor",
  "leftMotor",
  "rightMotor",
  "motor_pwm",
  "motorPwm",
  "code",
  "command",
  "shell",
  "exec",
  "network",
  "url",
  "file",
  "path",
  "filesystem"
]);

export function stripMarkdownCodeFence(text) {
  const value = String(text ?? "").trim();
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : value;
}

export function parseBrainResponse(rawTextOrObject) {
  if (rawTextOrObject && typeof rawTextOrObject === "object" && !Array.isArray(rawTextOrObject)) {
    return rawTextOrObject;
  }

  const text = stripMarkdownCodeFence(rawTextOrObject);

  if (!text) {
    return {
      ok: true,
      text: null,
      action: null,
      reason: "empty_model_response",
      confidence: 0,
      raw: rawTextOrObject
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: true,
      text: null,
      action: null,
      reason: "invalid_json_from_model",
      confidence: 0,
      raw: rawTextOrObject
    };
  }
}

export function normalizeBrainResponse(parsed, defaults = {}) {
  const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : {};
  const normalizedAction = normalizeAction(value.action);
  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 240)
      : defaults.reason ?? "brain_response";

  return {
    ok: value.ok !== false && normalizedAction.errors.length === 0,
    provider: defaults.provider ?? value.provider ?? "unknown",
    model: defaults.model ?? value.model ?? "unknown",
    latencyMs: Number.isFinite(Number(defaults.latencyMs ?? value.latencyMs))
      ? Number(defaults.latencyMs ?? value.latencyMs)
      : 0,
    text: normalizeText(value.text, 500),
    action: normalizedAction.action,
    reason: normalizedAction.errors[0] ?? reason,
    confidence: clampNumber(value.confidence, 0, 1, defaults.confidence ?? 0.5),
    raw: defaults.raw ?? value.raw ?? null,
    ...(normalizedAction.errors.length ? { errors: normalizedAction.errors } : {}),
    ...(value.error || defaults.error ? { error: String(value.error ?? defaults.error).slice(0, 500) } : {})
  };
}

export function normalizeAction(action) {
  const errors = [];

  if (!action) {
    return {
      action: null,
      errors
    };
  }

  const result = validateBrainAction(action);

  if (!result.ok) {
    errors.push(result.error);
  }

  return {
    action: result.ok && result.action.type !== "none" ? result.action : null,
    errors
  };
}

export function validateBrainAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return {
      ok: false,
      error: "Action must be an object."
    };
  }

  const type = typeof action.type === "string" ? action.type.trim() : "";

  if (!LOCAL_BRAIN_ALLOWED_ACTIONS.has(type)) {
    return {
      ok: false,
      error: `Unknown action type: ${type || "missing"}`
    };
  }

  const args = action.args ?? {};

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {
      ok: false,
      error: "Action args must be an object."
    };
  }

  const unsafeKey = findUnsafeKey(args);

  if (unsafeKey) {
    return {
      ok: false,
      error: `Unsafe action argument rejected: ${unsafeKey}`
    };
  }

  return {
    ok: true,
    action: {
      type,
      args: sanitizeActionArgs(type, args)
    }
  };
}

function sanitizeActionArgs(type, args = {}) {
  if (type === "set_follow_target") {
    return sanitizeSetFollowTargetArgs(args);
  }

  if (type === "follow_target_stop") {
    return {
      reason: normalizeText(args.reason, 120) ?? "user_request"
    };
  }

  return sanitizePerformArgs(args);
}

function sanitizePerformArgs(args = {}) {
  const speech = args.speech && typeof args.speech === "object" && !Array.isArray(args.speech)
    ? sanitizeArgs(args.speech)
    : {};
  const movement = Array.isArray(args.movement)
    ? args.movement
        .slice(0, 6)
        .filter((item) => typeof item === "string")
        .map((item) => item.slice(0, 80))
    : [];
  const timing = args.timing === "sequence" ? "sequence" : "parallel";
  const scenario = normalizeScenarioName(args.scenario);

  return {
    speech: {
      text: typeof speech.text === "string" ? speech.text.slice(0, 240) : "",
      tone: typeof speech.tone === "string" ? speech.tone.slice(0, 40) : "soft"
    },
    movement,
    scenario,
    timing,
    iterateMovement: args.iterateMovement === true
  };
}

function sanitizeSetFollowTargetArgs(args = {}) {
  const aliases = Array.isArray(args.aliases)
    ? args.aliases
        .slice(0, 8)
        .filter((item) => typeof item === "string")
        .map((item) => item.slice(0, 80))
    : [];

  return {
    label: normalizeText(args.label ?? args.target ?? args.object, 80) ?? "",
    aliases,
    trackId: normalizeText(args.trackId, 80) ?? undefined,
    mode: ["gentle", "curious", "cautious"].includes(args.mode) ? args.mode : "gentle"
  };
}

function sanitizeArgs(args) {
  const result = {};

  Object.entries(args).forEach(([key, value]) => {
    if (UNSAFE_ARG_KEYS.has(key)) {
      return;
    }

    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      result[key] = typeof value === "string" ? value.slice(0, 500) : value;
      return;
    }

    if (Array.isArray(value)) {
      result[key] = value
        .slice(0, 20)
        .filter((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
        .map((item) => (typeof item === "string" ? item.slice(0, 300) : item));
      return;
    }

    if (value && typeof value === "object") {
      result[key] = sanitizeArgs(value);
    }
  });

  return result;
}

function findUnsafeKey(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_ARG_KEYS.has(key)) {
      return key;
    }

    const nested = findUnsafeKey(child);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
