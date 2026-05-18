export const LOCAL_BRAIN_ALLOWED_ACTIONS = new Set([
  "none",
  "speak",
  "perform",
  "express",
  "drive",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember",
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

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
      actions: [],
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
      actions: [],
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
  const normalizedActions = normalizeActions(value.actions, defaults.maxActions ?? 2);
  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 240)
      : defaults.reason ?? "brain_response";

  return {
    ok: value.ok !== false && normalizedActions.errors.length === 0,
    provider: defaults.provider ?? value.provider ?? "unknown",
    model: defaults.model ?? value.model ?? "unknown",
    latencyMs: Number.isFinite(Number(defaults.latencyMs ?? value.latencyMs))
      ? Number(defaults.latencyMs ?? value.latencyMs)
      : 0,
    text: normalizeText(value.text, 500),
    actions: normalizedActions.actions,
    reason: normalizedActions.errors[0] ?? reason,
    confidence: clampNumber(value.confidence, 0, 1, defaults.confidence ?? 0.5),
    raw: defaults.raw ?? value.raw ?? null,
    ...(normalizedActions.errors.length ? { errors: normalizedActions.errors } : {}),
    ...(value.error || defaults.error ? { error: String(value.error ?? defaults.error).slice(0, 500) } : {})
  };
}

export function normalizeActions(actions, maxActions = 2) {
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  const normalized = [];
  const errors = [];
  const limit = clampInteger(maxActions, 1, 8, 2);

  for (const action of list) {
    if (normalized.length >= limit) {
      break;
    }

    const result = validateBrainAction(action);

    if (result.ok) {
      if (result.action.type !== "none") {
        normalized.push(result.action);
      }
    } else {
      errors.push(result.error);
    }
  }

  return {
    actions: normalized,
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
      args: sanitizeArgs(args)
    }
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

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}
