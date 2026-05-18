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

const RAW_MOTOR_KEYS = new Set([
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

export function parseBrainResponse(raw) {
  let value = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return safeNoneResponse(`Invalid brain JSON: ${error.message}`);
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return safeNoneResponse("Brain response must be an object.");
  }

  const rawActions = Array.isArray(value.actions)
    ? value.actions
    : value.action
      ? [value.action]
      : [];
  const normalized = normalizeBrainActions(rawActions);
  const actions = normalized.actions.length
    ? normalized.actions
    : [{ type: "none", args: {}, reason: "no_actions" }];

  return {
    ok: normalized.errors.length === 0 && value.ok !== false,
    source: normalizeText(value.source, "local_brain"),
    text: typeof value.text === "string" ? value.text : null,
    actions,
    reason: normalizeText(value.reason, normalized.errors[0] ?? "brain_response"),
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    shouldRemember: value.shouldRemember === true,
    errors: normalized.errors,
    raw: value
  };
}

export function normalizeBrainActions(actions) {
  const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
  const normalizedActions = [];
  const errors = [];

  list.forEach((action, index) => {
    const result = validateBrainAction(action);

    if (result.ok) {
      normalizedActions.push(result.action);
    } else {
      errors.push(`action[${index}]: ${result.error}`);
    }
  });

  return {
    actions: normalizedActions,
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

  const type = normalizeText(action.type, "");

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

  const unsafeKey = findUnsafeMotorKey(args);

  if (unsafeKey) {
    return {
      ok: false,
      error: `Unsafe action field is not allowed: ${unsafeKey}`
    };
  }

  return {
    ok: true,
    action: {
      id: typeof action.id === "string" ? action.id.slice(0, 80) : undefined,
      source: normalizeText(action.source, "local_brain"),
      type,
      args: sanitizeArgs(args),
      reason: typeof action.reason === "string" ? action.reason.slice(0, 240) : undefined
    }
  };
}

function safeNoneResponse(error) {
  return {
    ok: false,
    source: "parser",
    text: null,
    actions: [
      {
        type: "none",
        args: {},
        reason: error
      }
    ],
    reason: error,
    confidence: 0,
    shouldRemember: false,
    errors: [error],
    raw: null
  };
}

function sanitizeArgs(args) {
  const result = {};

  Object.entries(args).forEach(([key, value]) => {
    if (typeof key !== "string" || RAW_MOTOR_KEYS.has(key)) {
      return;
    }

    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      result[key] = value;
      return;
    }

    if (Array.isArray(value)) {
      result[key] = value
        .slice(0, 20)
        .filter((item) => item === null || ["string", "number", "boolean"].includes(typeof item));
      return;
    }

    if (typeof value === "object") {
      result[key] = sanitizeArgs(value);
    }
  });

  return result;
}

function findUnsafeMotorKey(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (RAW_MOTOR_KEYS.has(key)) {
      return key;
    }

    const nested = findUnsafeMotorKey(child);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizeText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
