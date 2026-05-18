const SAFE_LINEAR = 0.22;
const SAFE_ANGULAR = 0.22;
const SAFE_DURATION_MS = 700;
const DEFAULT_RAMP_MS = 160;

const RAW_MACROS = {
  soft_idle: {
    name: "soft_idle",
    description: "Subtle alive face while staying still.",
    priority: 20,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 900,
    tags: ["idle", "face"],
    frames: [
      { type: "face", expression: "neutral", intensity: 0.72, eyeDirection: "center", durationMs: 120 },
      { type: "event", eventType: "blink", durationMs: 80, allowSkip: true },
      { type: "face", expression: "happy", intensity: 0.35, eyeDirection: "center", durationMs: 120 }
    ]
  },
  soft_listen: {
    name: "soft_listen",
    description: "Attentive listening pose without wheel movement.",
    priority: 80,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 450,
    tags: ["listen", "attention"],
    frames: [
      { type: "face", expression: "attentive", intensity: 1, eyeDirection: "center", durationMs: 160 }
    ]
  },
  listen_pose: {
    name: "listen_pose",
    description: "Backward-compatible alias for soft_listen.",
    priority: 80,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 450,
    tags: ["listen", "attention"],
    frames: [
      { type: "face", expression: "attentive", intensity: 1, eyeDirection: "center", durationMs: 160 }
    ]
  },
  thinking_pose: {
    name: "thinking_pose",
    description: "Curious still pose while deeper local thinking runs.",
    priority: 45,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 1000,
    tags: ["thinking", "face"],
    frames: [
      { type: "face", expression: "curious", intensity: 0.85, eyeDirection: "left", durationMs: 160 },
      { type: "face", expression: "attentive", intensity: 0.9, eyeDirection: "right", durationMs: 160 },
      { type: "face", expression: "curious", intensity: 0.75, eyeDirection: "center", durationMs: 140 }
    ]
  },
  curious_scan: {
    name: "curious_scan",
    description: "Look around with optional tiny body turns.",
    priority: 60,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 2500,
    tags: ["scan", "curious"],
    frames: [
      { type: "face", expression: "curious", intensity: 0.9, eyeDirection: "left", durationMs: 120 },
      { type: "motion", linear: 0, angular: -0.14, durationMs: 260, rampMs: 150, label: "macro_curious_scan_left", allowSkip: true },
      { type: "face", expression: "curious", intensity: 0.92, eyeDirection: "right", durationMs: 120 },
      { type: "motion", linear: 0, angular: 0.14, durationMs: 260, rampMs: 150, label: "macro_curious_scan_right", allowSkip: true },
      { type: "face", expression: "attentive", intensity: 0.8, eyeDirection: "center", durationMs: 120 }
    ]
  },
  happy_approach: {
    name: "happy_approach",
    description: "Move closer with a warm playful body style.",
    priority: 70,
    interruptible: true,
    requiresMotion: true,
    cooldownMs: 3000,
    tags: ["approach", "happy", "social"],
    frames: [
      { type: "face", expression: "happy", intensity: 0.88, eyeDirection: "center", durationMs: 120 },
      { type: "motion", linear: 0.04, angular: -0.08, durationMs: 130, rampMs: 90, label: "macro_happy_approach_pre_wiggle", allowSkip: true },
      { type: "motion", linear: 0.16, angular: 0.02, durationMs: 430, rampMs: 170, label: "macro_happy_approach_forward" },
      { type: "pause", durationMs: 120 },
      { type: "face", expression: "attentive", intensity: 0.78, eyeDirection: "center", durationMs: 100 }
    ]
  },
  gentle_approach: {
    name: "gentle_approach",
    description: "Move closer softly with no wiggle.",
    priority: 68,
    interruptible: true,
    requiresMotion: true,
    cooldownMs: 3000,
    tags: ["approach", "gentle", "social"],
    frames: [
      { type: "face", expression: "attentive", intensity: 0.86, eyeDirection: "center", durationMs: 120 },
      { type: "motion", linear: 0.14, angular: 0, durationMs: 430, rampMs: 180, label: "macro_gentle_approach_forward" },
      { type: "pause", durationMs: 100 }
    ]
  },
  shy_retreat: {
    name: "shy_retreat",
    description: "Back away politely with shy body language.",
    priority: 70,
    interruptible: true,
    requiresMotion: true,
    cooldownMs: 2500,
    tags: ["retreat", "shy", "space"],
    frames: [
      { type: "face", expression: "shy", intensity: 0.86, eyeDirection: "down", durationMs: 160 },
      { type: "motion", linear: -0.14, angular: 0.02, durationMs: 420, rampMs: 180, label: "macro_shy_retreat_back" },
      { type: "face", expression: "happy", intensity: 0.42, eyeDirection: "center", durationMs: 180 }
    ]
  },
  scared_stop: {
    name: "scared_stop",
    description: "Immediate stop with scared expression.",
    priority: 100,
    interruptible: false,
    requiresMotion: false,
    cooldownMs: 0,
    tags: ["stop", "safety"],
    frames: [
      { type: "face", expression: "scared", intensity: 1.08, eyeDirection: "center", durationMs: 40 },
      { type: "event", eventType: "emergency_stop", payload: { reason: "macro_scared_stop" }, durationMs: 30 },
      { type: "face", expression: "attentive", intensity: 0.9, eyeDirection: "center", durationMs: 180 }
    ]
  },
  excited_wiggle: {
    name: "excited_wiggle",
    description: "Short happy left/right wiggle.",
    priority: 62,
    interruptible: true,
    requiresMotion: true,
    cooldownMs: 2600,
    tags: ["happy", "wiggle"],
    frames: [
      { type: "face", expression: "happy", intensity: 1, eyeDirection: "center", durationMs: 90 },
      { type: "motion", linear: 0, angular: -0.16, durationMs: 150, rampMs: 100, label: "macro_excited_wiggle_left" },
      { type: "motion", linear: 0, angular: 0.16, durationMs: 150, rampMs: 100, label: "macro_excited_wiggle_right" },
      { type: "motion", linear: 0, angular: -0.08, durationMs: 110, rampMs: 90, label: "macro_excited_wiggle_settle" },
      { type: "face", expression: "happy", intensity: 0.76, eyeDirection: "center", durationMs: 120 }
    ]
  },
  user_returned_greeting: {
    name: "user_returned_greeting",
    description: "Small greeting when the user returns.",
    priority: 55,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 10000,
    tags: ["greeting", "social"],
    frames: [
      { type: "face", expression: "happy", intensity: 0.9, eyeDirection: "center", durationMs: 140 },
      { type: "speech", text: "Oh, you're back.", tone: "happy", expression: "happy", durationMs: 120, allowSkip: true },
      { type: "motion", linear: 0, angular: -0.08, durationMs: 110, rampMs: 90, label: "macro_user_returned_tiny_wiggle", allowSkip: true },
      { type: "motion", linear: 0, angular: 0.08, durationMs: 110, rampMs: 90, label: "macro_user_returned_tiny_wiggle_back", allowSkip: true }
    ]
  },
  sleepy_idle: {
    name: "sleepy_idle",
    description: "Sleepy still pose.",
    priority: 30,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 1600,
    tags: ["idle", "sleepy"],
    frames: [
      { type: "face", expression: "sleepy", intensity: 0.9, eyeDirection: "down", durationMs: 220 },
      { type: "event", eventType: "blink", durationMs: 100, allowSkip: true }
    ]
  },
  surprised_back: {
    name: "surprised_back",
    description: "Tiny backward flinch for sudden changes.",
    priority: 75,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 3000,
    tags: ["surprise", "safety"],
    frames: [
      { type: "face", expression: "scared", intensity: 0.95, eyeDirection: "center", durationMs: 80 },
      { type: "motion", linear: -0.1, angular: 0, durationMs: 180, rampMs: 120, label: "macro_surprised_back_tiny", allowSkip: true },
      { type: "face", expression: "attentive", intensity: 0.8, eyeDirection: "center", durationMs: 160 }
    ]
  },
  soft_recenter: {
    name: "soft_recenter",
    description: "Recenter gaze and optionally tiny body correction.",
    priority: 45,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 1600,
    tags: ["attention", "recenter"],
    frames: [
      { type: "face", expression: "attentive", intensity: 0.72, eyeDirection: "center", durationMs: 120 },
      { type: "motion", linear: 0, angular: 0.08, durationMs: 140, rampMs: 100, label: "macro_soft_recenter_body", allowSkip: true }
    ]
  },
  tiny_yes: {
    name: "tiny_yes",
    description: "Small yes illusion using eyes and tiny body motion.",
    priority: 40,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 2600,
    tags: ["gesture", "yes"],
    frames: [
      { type: "face", expression: "happy", intensity: 0.62, eyeDirection: "down", durationMs: 100 },
      { type: "motion", linear: 0.06, angular: 0, durationMs: 110, rampMs: 90, label: "macro_tiny_yes_forward", allowSkip: true },
      { type: "motion", linear: -0.05, angular: 0, durationMs: 110, rampMs: 90, label: "macro_tiny_yes_back", allowSkip: true },
      { type: "face", expression: "attentive", intensity: 0.65, eyeDirection: "center", durationMs: 100 }
    ]
  },
  tiny_no: {
    name: "tiny_no",
    description: "Small no illusion using eye/body side motion.",
    priority: 40,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 2600,
    tags: ["gesture", "no"],
    frames: [
      { type: "face", expression: "shy", intensity: 0.62, eyeDirection: "left", durationMs: 100 },
      { type: "motion", linear: 0, angular: -0.08, durationMs: 100, rampMs: 80, label: "macro_tiny_no_left", allowSkip: true },
      { type: "face", expression: "shy", intensity: 0.62, eyeDirection: "right", durationMs: 100 },
      { type: "motion", linear: 0, angular: 0.08, durationMs: 100, rampMs: 80, label: "macro_tiny_no_right", allowSkip: true },
      { type: "face", expression: "attentive", intensity: 0.65, eyeDirection: "center", durationMs: 100 }
    ]
  },
  look_around_only: {
    name: "look_around_only",
    description: "Camera/eyes scan without wheel movement.",
    priority: 50,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 1800,
    tags: ["scan", "face-only"],
    frames: [
      { type: "face", expression: "curious", intensity: 0.82, eyeDirection: "left", durationMs: 180 },
      { type: "face", expression: "curious", intensity: 0.84, eyeDirection: "right", durationMs: 180 },
      { type: "face", expression: "attentive", intensity: 0.76, eyeDirection: "center", durationMs: 140 }
    ]
  },
  attentive_turn: {
    name: "attentive_turn",
    description: "Gentle attention turn toward the user.",
    priority: 50,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 3000,
    tags: ["attention", "tracking"],
    frames: [
      { type: "face", expression: "attentive", intensity: 0.86, eyeDirection: "center", durationMs: 80 },
      { type: "motion", linear: 0, angular: 0.12, durationMs: 180, rampMs: 120, label: "macro_attentive_turn", allowSkip: true }
    ]
  }
};

export const MACRO_NAMES = Object.freeze(Object.keys(RAW_MACROS));

export function listMacros() {
  return MACRO_NAMES.map((name) => getMacro(name)).filter(Boolean);
}

export function getMacro(name, options = {}) {
  const macro = RAW_MACROS[name] ?? RAW_MACROS[macroAlias(name)];
  if (!macro) {
    return null;
  }

  return tuneMacro(cloneMacro(macro), options);
}

export function createMacroLibrary({ calibration, personality } = {}) {
  return {
    listMacros: () => listMacros().map((macro) => tuneMacro(macro, { calibration, personality })),
    getMacro: (name, options = {}) => getMacro(name, { calibration, personality, ...options })
  };
}

export function validateMacro(macro) {
  if (!macro || typeof macro !== "object" || Array.isArray(macro)) {
    return { ok: false, error: "macro_must_be_object" };
  }

  if (typeof macro.name !== "string" || !macro.name.trim()) {
    return { ok: false, error: "macro_name_required" };
  }

  if (!Array.isArray(macro.frames) || macro.frames.length === 0) {
    return { ok: false, error: "macro_frames_required" };
  }

  const errors = [];
  macro.frames.forEach((frame, index) => {
    const normalized = normalizeMacroFrame(frame);
    if (!normalized.ok) {
      errors.push(`frame[${index}]: ${normalized.error}`);
    }
  });

  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true };
}

export function normalizeMacroFrame(frame = {}) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return { ok: false, error: "frame_must_be_object" };
  }

  const type = ["face", "motion", "speech", "pause", "event", "composite"].includes(frame.type)
    ? frame.type
    : inferFrameType(frame);
  const normalized = {
    ...frame,
    type,
    durationMs: clampRound(frame.durationMs, 0, type === "motion" ? SAFE_DURATION_MS : 3000, type === "pause" ? 100 : 0),
    allowSkip: frame.allowSkip === true
  };

  if (type === "motion") {
    normalized.linear = clampNumber(frame.linear, -SAFE_LINEAR, SAFE_LINEAR, 0);
    normalized.angular = clampNumber(frame.angular, -SAFE_ANGULAR, SAFE_ANGULAR, 0);
    normalized.rampMs = clampRound(frame.rampMs, 0, 500, DEFAULT_RAMP_MS);
    normalized.label = sanitizeLabel(frame.label ?? "macro_motion");
    if (Math.abs(normalized.linear) < 0.001 && Math.abs(normalized.angular) < 0.001) {
      return { ok: false, error: "motion_frame_requires_motion" };
    }
  }

  if (type === "face") {
    normalized.expression = normalizeExpression(frame.expression);
    normalized.intensity = clampNumber(frame.intensity, 0, 1.5, 0.8);
    normalized.eyeDirection = normalizeEyeDirection(frame.eyeDirection);
  }

  if (type === "speech") {
    normalized.text = typeof frame.text === "string" ? frame.text.trim().slice(0, 240) : "";
    normalized.tone = normalizeTone(frame.tone);
    normalized.expression = frame.expression ? normalizeExpression(frame.expression) : undefined;
  }

  if (type === "event") {
    normalized.eventType = typeof frame.eventType === "string" ? frame.eventType : "macro_event";
    normalized.payload = frame.payload && typeof frame.payload === "object" ? { ...frame.payload } : {};
  }

  if (type === "composite") {
    normalized.mode = frame.mode === "parallel" ? "parallel" : "sequence";
    normalized.frames = Array.isArray(frame.frames)
      ? frame.frames
          .slice(0, 12)
          .map((child) => normalizeMacroFrame(child))
          .filter((child) => child.ok)
          .map((child) => child.frame)
      : [];

    if (normalized.frames.length === 0) {
      return { ok: false, error: "composite_frame_requires_children" };
    }
  }

  return { ok: true, frame: normalized };
}

function tuneMacro(macro, { calibration, personality } = {}) {
  const settings = calibration?.getSettings?.() ?? calibration ?? {};
  const behaviorStyle = personality?.behaviorStyle ?? personality?.coreTraits ?? {};
  const softness = clampNumber(behaviorStyle.movementSoftness, 0, 1, 0.8);
  const motionScale = clampNumber(settings.motionIntensityScale, 0.2, 1.2, 1) * (0.86 + (1 - softness) * 0.12);
  const maxSpeed = clampNumber(settings.maxSpeed, 0.05, SAFE_LINEAR, SAFE_LINEAR);
  const rampMs = clampRound(settings.rampMs, 80, 220, DEFAULT_RAMP_MS);

  macro.frames = macro.frames.map((frame) => {
    const normalized = normalizeMacroFrame(frame);
    const next = normalized.ok ? normalized.frame : { type: "pause", durationMs: 60, allowSkip: true };

    if (next.type !== "motion") {
      return next;
    }

    return {
      ...next,
      linear: clampNumber(next.linear * motionScale, -maxSpeed, maxSpeed, 0),
      angular: clampNumber(next.angular * motionScale, -maxSpeed, maxSpeed, 0),
      rampMs: Math.min(next.rampMs || rampMs, rampMs),
      durationMs: Math.min(next.durationMs, SAFE_DURATION_MS)
    };
  });

  return macro;
}

function cloneMacro(macro) {
  return {
    ...macro,
    tags: [...(macro.tags ?? [])],
    frames: macro.frames.map((frame) => ({ ...frame, payload: frame.payload ? { ...frame.payload } : undefined }))
  };
}

function macroAlias(name) {
  return {
    approach_user: "gentle_approach",
    retreat: "shy_retreat",
    stop: "scared_stop",
    express: "soft_idle"
  }[name] ?? name;
}

function inferFrameType(frame) {
  if (typeof frame.text === "string") {
    return "speech";
  }

  if (Number.isFinite(Number(frame.linear)) || Number.isFinite(Number(frame.angular))) {
    return "motion";
  }

  if (frame.eventType) {
    return "event";
  }

  if (frame.expression || frame.eyeDirection) {
    return "face";
  }

  return "pause";
}

function normalizeExpression(expression) {
  return ["neutral", "happy", "curious", "attentive", "sleepy", "scared", "shy", "sad"].includes(expression)
    ? expression
    : "neutral";
}

function normalizeEyeDirection(direction) {
  return ["center", "left", "right", "up", "down"].includes(direction) ? direction : "center";
}

function normalizeTone(tone) {
  return ["soft", "happy", "curious", "serious", "shy", "playful"].includes(tone) ? tone : "soft";
}

function sanitizeLabel(value) {
  return String(value || "macro_motion").replace(/[^\w.-]/g, "_").slice(0, 80);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function clampRound(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}
