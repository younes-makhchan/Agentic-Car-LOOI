// Browser safety layer. It validates Life Engine motion before CommandQueue and ESP32.
export const DEFAULT_LIMITS = {
  maxSpeed: 0.4,
  maxDurationMs: 1000,
  minDurationMs: 50,
  lowEnergySpeedScale: 0.6,
  lowEnergyThreshold: 0.25,
  maxRampMs: 500,
  defaultRampMs: 120
};

const ALLOWED_BEHAVIORS = new Set([
  "soft_idle",
  "listen_pose",
  "curious_scan",
  "excited_wiggle",
  "approach_user",
  "retreat",
  "rotate_toward_user",
  "sleepy_idle",
  "scared_stop"
]);

export function validateMotionCommand(command, state = {}, limits = DEFAULT_LIMITS) {
  const calibration = limits?.calibration?.getSettings?.() ?? limits?.calibration ?? {};
  const activeLimits = {
    ...DEFAULT_LIMITS,
    ...limits,
    maxSpeed: calibration.maxSpeed ?? limits.maxSpeed ?? DEFAULT_LIMITS.maxSpeed,
    defaultRampMs: calibration.rampMs ?? limits.defaultRampMs ?? DEFAULT_LIMITS.defaultRampMs
  };
  const warnings = [];

  if (!command || typeof command !== "object") {
    return {
      allowed: false,
      command: null,
      reason: "invalid_motion_command",
      warnings
    };
  }

  const linear = finiteOrZero(command.linear, "linear", warnings);
  const angular = finiteOrZero(command.angular, "angular", warnings);
  const requestedDurationMs = finiteOrDefault(
    command.durationMs,
    Math.min(300, activeLimits.maxDurationMs),
    "durationMs",
    warnings
  );
  const requestedRampMs = finiteOrDefault(
    command.rampMs,
    activeLimits.defaultRampMs,
    "rampMs",
    warnings
  );

  let safeCommand = {
    label: sanitizeLabel(command.label ?? "life_motion"),
    linear: clamp(linear, -activeLimits.maxSpeed, activeLimits.maxSpeed),
    angular: clamp(angular, -activeLimits.maxSpeed, activeLimits.maxSpeed),
    durationMs: Math.round(
      clamp(requestedDurationMs, activeLimits.minDurationMs, activeLimits.maxDurationMs)
    ),
    rampMs: Math.round(clamp(requestedRampMs, 0, activeLimits.maxRampMs))
  };

  safeCommand.rampMs = Math.min(safeCommand.rampMs, Math.floor(safeCommand.durationMs / 2));

  if (safeCommand.linear !== linear || safeCommand.angular !== angular) {
    warnings.push("speed_clamped");
  }

  if (safeCommand.durationMs !== Math.round(requestedDurationMs)) {
    warnings.push("duration_clamped");
  }

  if (safeCommand.rampMs !== Math.round(requestedRampMs)) {
    warnings.push("ramp_clamped");
  }

  if (state?.obstacle && safeCommand.linear > 0) {
    return {
      allowed: false,
      command: safeCommand,
      reason: "obstacle_blocks_forward_motion",
      warnings
    };
  }

  if (Number(state?.energy) < activeLimits.lowEnergyThreshold) {
    safeCommand = {
      ...safeCommand,
      linear: safeCommand.linear * activeLimits.lowEnergySpeedScale,
      angular: safeCommand.angular * activeLimits.lowEnergySpeedScale
    };
    warnings.push("low_energy_speed_reduced");
  }

  if (!["connected", "simulated_connected"].includes(state?.connectionState)) {
    warnings.push("robot_not_connected");
  }

  return {
    allowed: true,
    command: safeCommand,
    reason: warnings.length ? warnings.join(",") : "ok",
    warnings
  };
}

export function validateBehaviorRequest(name, args = {}, _state = {}) {
  if (!ALLOWED_BEHAVIORS.has(name)) {
    return {
      allowed: false,
      name,
      args,
      reason: "unknown_behavior"
    };
  }

  return {
    allowed: true,
    name,
    args: args ?? {},
    reason: "ok"
  };
}

function finiteOrZero(value, fieldName, warnings) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    warnings.push(`${fieldName}_defaulted`);
    return 0;
  }

  return numericValue;
}

function finiteOrDefault(value, fallback, fieldName, warnings) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    warnings.push(`${fieldName}_defaulted`);
    return fallback;
  }

  return numericValue;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeLabel(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "life_motion";
  }

  return value.trim().replace(/[^\w.-]/g, "_").slice(0, 80);
}
