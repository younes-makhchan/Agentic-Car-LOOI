export function createDefaultBrainPolicy() {
  return {
    localBrainEnabled: true,
    autonomousMode: false,
    localMotionArmed: false,
    localCameraAllowed: false,
    localSpeechAllowed: true,
    allowAutonomousSpeech: true,
    allowAutonomousMovement: false,
    maxThoughtsPerMinute: 12,
    minAutonomousThoughtIntervalMs: 3000,
    eventThoughtCooldownMs: 800,
    stopRespectCooldownMs: 8000
  };
}

export function clampBrainPolicy(policy = {}) {
  const defaults = createDefaultBrainPolicy();
  const value = isPlainObject(policy) ? policy : {};

  return {
    localBrainEnabled: toBoolean(value.localBrainEnabled, defaults.localBrainEnabled),
    autonomousMode: toBoolean(value.autonomousMode, defaults.autonomousMode),
    localMotionArmed: toBoolean(value.localMotionArmed, defaults.localMotionArmed),
    localCameraAllowed: toBoolean(value.localCameraAllowed, defaults.localCameraAllowed),
    localSpeechAllowed: toBoolean(value.localSpeechAllowed, defaults.localSpeechAllowed),
    allowAutonomousSpeech: toBoolean(
      value.allowAutonomousSpeech,
      defaults.allowAutonomousSpeech
    ),
    allowAutonomousMovement: toBoolean(
      value.allowAutonomousMovement,
      defaults.allowAutonomousMovement
    ),
    maxThoughtsPerMinute: clampInteger(
      value.maxThoughtsPerMinute,
      1,
      60,
      defaults.maxThoughtsPerMinute
    ),
    minAutonomousThoughtIntervalMs: clampInteger(
      value.minAutonomousThoughtIntervalMs,
      1000,
      60000,
      defaults.minAutonomousThoughtIntervalMs
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
