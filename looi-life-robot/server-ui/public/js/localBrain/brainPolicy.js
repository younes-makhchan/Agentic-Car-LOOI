export function createDefaultBrainPolicy() {
  return {
    localBrainEnabled: true,
    localMotionArmed: false,
    localCameraAllowed: false,
    localSpeechAllowed: true,
    localVisionEnabled: true,
    objectDetectionEnabledDefault: false,
    followModeArmed: false,
    allowFollowMovement: false,
    followLostTimeoutMs: 2000,
    followTargetCenterX: 0.5,
    followCenterDeadband: 0.115,
    followSteerGain: 0.9,
    maxObjectFollowSpeed: 0.036,
    followCommandDurationMs: 30,
    followCommandRefreshMs: 70,
    maxThoughtsPerMinute: 12,
    eventThoughtCooldownMs: 800,
    stopRespectCooldownMs: 8000
  };
}

export function clampBrainPolicy(policy = {}) {
  const defaults = createDefaultBrainPolicy();
  const value = isPlainObject(policy) ? policy : {};

  return {
    localBrainEnabled: toBoolean(value.localBrainEnabled, defaults.localBrainEnabled),
    localMotionArmed: toBoolean(value.localMotionArmed, defaults.localMotionArmed),
    localCameraAllowed: toBoolean(value.localCameraAllowed, defaults.localCameraAllowed),
    localSpeechAllowed: toBoolean(value.localSpeechAllowed, defaults.localSpeechAllowed),
    localVisionEnabled: toBoolean(value.localVisionEnabled, defaults.localVisionEnabled),
    objectDetectionEnabledDefault: toBoolean(
      value.objectDetectionEnabledDefault,
      defaults.objectDetectionEnabledDefault
    ),
    followModeArmed: toBoolean(value.followModeArmed, defaults.followModeArmed),
    allowFollowMovement: toBoolean(value.allowFollowMovement, defaults.allowFollowMovement),
    followLostTimeoutMs: clampInteger(
      value.followLostTimeoutMs,
      500,
      8000,
      defaults.followLostTimeoutMs
    ),
    followTargetCenterX: clampNumber(
      value.followTargetCenterX,
      0.25,
      0.75,
      defaults.followTargetCenterX
    ),
    followCenterDeadband: clampNumber(
      value.followCenterDeadband,
      0.005,
      0.2,
      defaults.followCenterDeadband
    ),
    followSteerGain: clampNumber(
      value.followSteerGain,
      0.05,
      2.5,
      defaults.followSteerGain
    ),
    maxObjectFollowSpeed: clampNumber(
      value.maxObjectFollowSpeed,
      0,
      0.12,
      defaults.maxObjectFollowSpeed
    ),
    followCommandDurationMs: clampInteger(
      value.followCommandDurationMs,
      0,
      600,
      defaults.followCommandDurationMs
    ),
    followCommandRefreshMs: clampInteger(
      value.followCommandRefreshMs,
      0,
      300,
      defaults.followCommandRefreshMs
    ),
    maxThoughtsPerMinute: clampInteger(
      value.maxThoughtsPerMinute,
      1,
      60,
      defaults.maxThoughtsPerMinute
    ),
    eventThoughtCooldownMs: clampInteger(
      value.eventThoughtCooldownMs,
      0,
      10000,
      defaults.eventThoughtCooldownMs
    ),
    stopRespectCooldownMs: clampInteger(
      value.stopRespectCooldownMs,
      1000,
      30000,
      defaults.stopRespectCooldownMs
    )
  };
}

function toBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
