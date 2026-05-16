import { validateMotionCommand } from "./safetyGate.js";
import { clamp01, updateDriveValue } from "./state.js";

// Expressive body language. These functions never bypass SafetyGate or CommandQueue.
export async function softIdle(context, _args = {}) {
  const { state, face } = context;
  const calibration = getCalibrationSettings(context);
  const now = Date.now();

  if (state.mood === "attentive") {
    face?.setExpression?.("attentive", 0.9);
  } else if (state.mood === "curious") {
    face?.setExpression?.("curious", 0.85);
  } else if (Number(state.energy) < 0.25) {
    face?.setExpression?.("sleepy", 0.8);
  } else if (Number(state.affection) > 0.62 && Number(state.fear) < 0.25) {
    face?.setExpression?.("happy", 0.45);
  } else {
    face?.setExpression?.("neutral", 0.8);
  }

  if (!state.lastIdleFaceAt || now - state.lastIdleFaceAt > 1600) {
    state.lastIdleFaceAt = now;

    if (Math.random() < 0.32) {
      face?.setEyeDirection?.(randomChoice(["center", "left", "right", "down"]));
    }

    if (Math.random() < 0.28) {
      face?.blink?.();
    }
  }

  return {
    ok: true,
    executed: false,
    queuedMotions: 0,
    behavior: "soft_idle",
    style: "still",
    emotionalTone: state.mood ?? "neutral",
    labels: calibration.idleMotionEnabled ? ["soft_idle"] : [],
    moved: false
  };
}

export async function listenPose(context, _args = {}) {
  const { face } = context;

  face?.setExpression?.("attentive", 1);
  face?.setEyeDirection?.("center");

  return {
    ok: true,
    executed: true,
    queuedMotions: 0,
    behavior: "listen_pose",
    style: "attentive",
    emotionalTone: "attentive",
    labels: ["listen_pose"],
    moved: false
  };
}

export async function curiousScan(context, args = {}) {
  const { face } = context;
  const calibration = getCalibrationSettings(context);
  const intensity = clamp01(args.intensity ?? 0.5) * calibration.motionIntensityScale;
  const direction = normalizeDirection(args.direction, "both");
  const angular = Math.min(calibration.turnSpeed + intensity * 0.04, calibration.maxSpeed);
  const durationMs = Math.round(calibration.curiousScanMs * (0.85 + Math.min(1, intensity) * 0.3));
  const labels = [];
  let queuedMotions = 0;

  face?.setExpression?.("curious", 0.85 + intensity * 0.35);
  await hesitate(context, 70);

  if (direction === "left" || direction === "both") {
    face?.setEyeDirection?.("left");
    const result = await safeEnqueueMotion(context, {
      angular: -angular,
      durationMs,
      rampMs: calibration.rampMs,
      label: "curious_scan_left"
    });
    labels.push("curious_scan_left");
    queuedMotions += result.queued ? 1 : 0;
  }

  if (direction === "both") {
    await wait(90);
  }

  if (direction === "right" || direction === "both") {
    face?.setEyeDirection?.("right");
    const result = await safeEnqueueMotion(context, {
      angular,
      durationMs,
      rampMs: calibration.rampMs,
      label: "curious_scan_right"
    });
    labels.push("curious_scan_right");
    queuedMotions += result.queued ? 1 : 0;
  }

  if (direction === "center") {
    face?.setEyeDirection?.("center");
  } else {
    await wait(80);
    face?.setEyeDirection?.("center");
  }

  return {
    ok: true,
    executed: queuedMotions > 0 || direction === "center",
    queuedMotions,
    behavior: "curious_scan",
    style: args.style ?? "curious",
    emotionalTone: "curious",
    labels,
    moved: direction !== "center"
  };
}

export async function excitedWiggle(context, args = {}) {
  const { face } = context;
  const calibration = getCalibrationSettings(context);
  const intensity = clamp01(args.intensity ?? 0.6) * calibration.motionIntensityScale;
  const angular = Math.min(calibration.wiggleSpeed * (0.65 + intensity * 0.35), calibration.maxSpeed);
  const durationMs = Math.round(calibration.wiggleMs * (0.85 + Math.min(1, intensity) * 0.25));
  const labels = [];
  let queuedMotions = 0;

  face?.setExpression?.("happy", 0.9 + intensity * 0.35);
  face?.setEyeDirection?.("center");
  face?.blink?.();
  await hesitate(context, 45);

  let result = await safeEnqueueMotion(context, {
    angular: -angular,
    durationMs,
    rampMs: calibration.rampMs,
    label: "excited_wiggle_left"
  });
  labels.push("excited_wiggle_left");
  queuedMotions += result.queued ? 1 : 0;
  result = await safeEnqueueMotion(context, {
    angular,
    durationMs,
    rampMs: calibration.rampMs,
    label: "excited_wiggle_right"
  });
  labels.push("excited_wiggle_right");
  queuedMotions += result.queued ? 1 : 0;
  result = await safeEnqueueMotion(context, {
    angular: -angular * 0.65,
    durationMs: Math.max(90, durationMs - 40),
    rampMs: calibration.rampMs,
    label: "excited_wiggle_settle"
  });
  labels.push("excited_wiggle_settle");
  queuedMotions += result.queued ? 1 : 0;

  return {
    ok: true,
    executed: queuedMotions > 0,
    queuedMotions,
    behavior: "excited_wiggle",
    style: args.style ?? "happy",
    emotionalTone: "happy",
    labels,
    moved: true
  };
}

export async function approachUser(context, args = {}) {
  const { face, state } = context;
  const calibration = getCalibrationSettings(context);
  const style = normalizeStyle(args.style, ["gentle", "happy", "curious", "shy"], "gentle");
  const durationMs = distanceToDuration(args.distance, {
    tiny: calibration.approachTinyMs,
    short: calibration.approachShortMs,
    medium: calibration.approachMediumMs
  });
  const styleExpression = {
    gentle: "attentive",
    happy: "happy",
    curious: "curious",
    shy: "shy"
  };
  const speed = Math.min(
    calibration.maxSpeed,
    calibration.gentleSpeed * (0.75 + clamp01(state.energy) * 0.4) * calibration.motionIntensityScale
  );

  face?.setExpression?.(styleExpression[style], style === "happy" ? 1 : 0.85);
  face?.setEyeDirection?.("center");
  await hesitate(context, style === "shy" ? 120 : 70);

  const result = await safeEnqueueMotion(context, {
    linear: speed,
    durationMs,
    rampMs: calibration.rampMs,
    label: `approach_user_${style}`
  });

  return summarizeMotionResult(result, {
    behavior: "approach_user",
    style,
    emotionalTone: style === "happy" ? "happy" : style === "shy" ? "shy" : "attentive"
  });
}

export async function retreat(context, args = {}) {
  const { face } = context;
  const calibration = getCalibrationSettings(context);
  const style = normalizeStyle(args.style, ["gentle", "shy", "scared", "playful"], "gentle");
  const durationMs = distanceToDuration(args.distance, {
    tiny: calibration.retreatTinyMs,
    short: calibration.retreatShortMs
  });
  const base = calibration.gentleSpeed * calibration.motionIntensityScale;
  const speedByStyle = {
    gentle: -base * 0.75,
    shy: -base * 0.85,
    scared: -Math.min(calibration.maxSpeed, base * 1.15),
    playful: -base * 0.95
  };

  face?.setExpression?.(style === "scared" ? "scared" : style === "shy" ? "shy" : "attentive");
  face?.setEyeDirection?.("center");
  await hesitate(context, style === "scared" ? 25 : 85);

  const result = await safeEnqueueMotion(context, {
    linear: speedByStyle[style],
    durationMs,
    rampMs: calibration.rampMs,
    label: `retreat_${style}`
  });

  return summarizeMotionResult(result, {
    behavior: "retreat",
    style,
    emotionalTone: style
  });
}

export async function rotateTowardUser(context, args = {}) {
  const { face } = context;
  const calibration = getCalibrationSettings(context);
  const direction = normalizeDirection(args.direction, "center");
  const intensity = clamp01(args.intensity ?? 0.5) * calibration.motionIntensityScale;

  face?.setExpression?.("attentive", 1);
  face?.setEyeDirection?.(direction === "center" ? "center" : direction);

  if (direction === "center") {
    return {
      ok: true,
      behavior: "rotate_toward_user",
      style: "attentive",
      emotionalTone: "attentive",
      queuedMotions: 0,
      moved: false
    };
  }

  await hesitate(context, 40);
  const result = await safeEnqueueMotion(context, {
    angular: direction === "left" ? -(calibration.turnSpeed * (0.75 + intensity * 0.25)) : calibration.turnSpeed * (0.75 + intensity * 0.25),
    durationMs: Math.round(calibration.curiousScanMs * (0.65 + Math.min(1, intensity) * 0.25)),
    rampMs: calibration.rampMs,
    label: `rotate_toward_user_${direction}`
  });

  return summarizeMotionResult(result, {
    behavior: "rotate_toward_user",
    style: direction,
    emotionalTone: "attentive"
  });
}

export async function sleepyIdle(context, _args = {}) {
  const { face } = context;

  face?.setExpression?.("sleepy", 0.9);
  face?.setEyeDirection?.("down");

  return {
    ok: true,
    behavior: "sleepy_idle",
    style: "sleepy",
    emotionalTone: "sleepy",
    queuedMotions: 0,
    moved: false
  };
}

export async function scaredStop(context, args = {}) {
  const { commandQueue, face, state, logger } = context;
  const reason = args.reason ?? "life_scared_stop";

  face?.setExpression?.("scared", 1.1);
  face?.setEyeDirection?.("center");
  state.fear = updateDriveValue(state.fear, 0.12);
  state.currentBehavior = "scared_stop";

  try {
    await commandQueue?.emergencyStop?.(reason);
  } catch (error) {
    log(logger, `Scared stop failed: ${error.message}`, "error");
  }

  return {
    ok: true,
    behavior: "scared_stop",
    style: "scared",
    emotionalTone: "scared",
    queuedMotions: 0,
    moved: false,
    stopped: true
  };
}

export async function safeEnqueueMotion(context, command) {
  const { state, commandQueue, logger } = context;

  if (Number(state?.stopRespectUntil || 0) > Date.now()) {
    return {
      allowed: false,
      queued: false,
      executed: false,
      reason: "stop_respect_cooldown_active",
      skippedReason: "stop_respect_cooldown_active",
      command: null,
      warnings: []
    };
  }

  const validator = context.safetyGate?.validateMotionCommand ?? validateMotionCommand;
  const result = validator(command, state, {
    ...(context.limits ?? {}),
    calibration: context.calibration
  });

  if (!result.allowed) {
    log(logger, `Life motion rejected (${result.reason}): ${command?.label ?? "motion"}`, "warn");
    return {
      ...result,
      queued: false
    };
  }

  if (result.warnings?.length) {
    log(logger, `Life motion warning (${result.command.label}): ${result.warnings.join(", ")}`, "warn");
  }

  state.lastMotionAt = Date.now();

  const connected =
    context.robotClient?.isConnected?.() ?? commandQueue?.robotClient?.isConnected?.() ?? false;

  if (!connected) {
    log(
      logger,
      `Life motion simulated while disconnected: ${result.command.label}`,
      "warn"
    );
    return {
      ...result,
      queued: false,
      simulated: true,
      executed: false,
      labels: [result.command?.label ?? command?.label ?? "motion"],
      behavior: result.command?.label ?? command?.label ?? "motion"
    };
  }

  if (!commandQueue?.enqueueMotion) {
    log(logger, `Life motion skipped: command queue unavailable`, "warn");
    return {
      ...result,
      queued: false
    };
  }

  try {
    await commandQueue.enqueueMotion(result.command);
    return {
      ...result,
      queued: true,
      completed: true,
      executed: true,
      queuedMotions: 1,
      labels: [result.command.label]
    };
  } catch (error) {
    log(logger, `Life motion failed (${result.command.label}): ${error.message}`, "warn");
    return {
      ...result,
      queued: false,
      executed: false,
      error
    };
  }
}

function getCalibrationSettings(context = {}) {
  const settings = context.calibration?.getSettings?.() ?? context.calibration ?? {};
  const personality = context.personalityProfile?.behaviorStyle ?? {};
  const softness = clamp01(personality.movementSoftness ?? 0.8);
  const personalityScale = 0.92 + (1 - softness) * 0.12;

  return {
    maxSpeed: numberOr(settings.maxSpeed, 0.4),
    gentleSpeed: numberOr(settings.gentleSpeed, 0.18),
    turnSpeed: numberOr(settings.turnSpeed, 0.18),
    wiggleSpeed: numberOr(settings.wiggleSpeed, 0.2),
    approachTinyMs: numberOr(settings.approachTinyMs, 220),
    approachShortMs: numberOr(settings.approachShortMs, 450),
    approachMediumMs: numberOr(settings.approachMediumMs, 700),
    retreatTinyMs: numberOr(settings.retreatTinyMs, 220),
    retreatShortMs: numberOr(settings.retreatShortMs, 450),
    curiousScanMs: numberOr(settings.curiousScanMs, 260),
    wiggleMs: numberOr(settings.wiggleMs, 180),
    rampMs: Math.round(numberOr(settings.rampMs, 150) * (0.85 + softness * 0.3)),
    motionIntensityScale: numberOr(settings.motionIntensityScale, 1) * personalityScale,
    idleMotionEnabled: settings.idleMotionEnabled !== false
  };
}

function numberOr(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeDirection(direction, fallback) {
  return ["left", "right", "both", "center"].includes(direction) ? direction : fallback;
}

function normalizeStyle(style, allowed, fallback) {
  return allowed.includes(style) ? style : fallback;
}

function distanceToDuration(distance, durationByDistance) {
  return durationByDistance[distance] ?? durationByDistance.short ?? 300;
}

function randomChoice(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function wait(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function hesitate(context, baseMs) {
  const hesitation = clamp01(context?.personalityProfile?.behaviorStyle?.hesitation ?? 0.35);
  const delay = Math.round(Number(baseMs || 0) * hesitation);

  if (delay > 0) {
    await wait(delay);
  }
}

function summarizeMotionResult(result = {}, summary = {}) {
  return {
    ...result,
    ok: result.allowed !== false && result.error === undefined,
    executed: Boolean(result.executed || result.queued || result.completed),
    queuedMotions: result.queued ? 1 : 0,
    labels: result.labels ?? [result.command?.label].filter(Boolean),
    moved: Boolean(result.queued || result.completed || result.executed),
    skippedReason: result.skippedReason ?? (result.allowed === false ? result.reason : undefined),
    ...summary
  };
}

function log(logger, message, level = "info") {
  if (!logger) {
    return;
  }

  if (typeof logger === "function") {
    logger(message, level);
    return;
  }

  const logMethod = typeof logger[level] === "function" ? level : "log";
  logger[logMethod](message);
}
