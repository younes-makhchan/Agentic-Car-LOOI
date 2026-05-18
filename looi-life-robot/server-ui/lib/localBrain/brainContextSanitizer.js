const SECRET_PATTERNS = [
  /\b(api[_ -]?key|token|password|secret|bearer)\b/i,
  /\bsk-[a-z0-9_-]{12,}\b/i
];

export function sanitizeBrainContext(input = {}) {
  const context = isPlainObject(input) ? input : {};

  return removeSecretsAndLargeFields({
    reason: shortText(context.reason, 80),
    triggerEvent: compactEvent(context.triggerEvent),
    lifeState: compactLifeState(context.lifeState),
    policy: compactPolicy(context.policy ?? context.localPolicy),
    telemetry: compactTelemetry(context.telemetry ?? context.latestTelemetry ?? context.robotTelemetry),
    camera: compactCameraState(context.camera ?? context.cameraStatus),
    speech: compactSpeechState(context.speech ?? context.speechStatus ?? context.voice),
    voice: compactSpeechState(context.voice ?? context.voiceStatus),
    personality: compactPersonality(context.personality),
    recentEvents: compactRecentEvents(context.recentEvents, 20),
    simulatorMode: Boolean(context.simulatorMode),
    robotConnected: Boolean(context.robotConnected),
    connectionState: shortText(context.connectionState, 80),
    browserTimestamp: shortText(context.browserTimestamp, 80)
  });
}

export function compactRecentEvents(events, limit = 20) {
  const list = Array.isArray(events) ? events : [];
  return list.slice(0, clampInteger(limit, 1, 50, 20)).map(compactEvent);
}

export function compactLifeState(lifeState) {
  const state = isPlainObject(lifeState) ? lifeState : {};
  return pick(state, [
    "mood",
    "energy",
    "boredom",
    "fear",
    "curiosity",
    "affection",
    "loneliness",
    "comfort",
    "attentionTarget",
    "userVisible",
    "userPosition",
    "userDistance",
    "isSpeaking",
    "isListening",
    "battery",
    "obstacle",
    "currentBehavior",
    "robotMotorState"
  ]);
}

export function compactCameraState(camera) {
  const status = isPlainObject(camera) ? camera : {};
  const observation = isPlainObject(status.latestObservation)
    ? status.latestObservation
    : isPlainObject(status.observation)
      ? status.observation
      : {};

  return removeDataUrls({
    running: Boolean(status.running),
    facingMode: shortText(status.facingMode, 40),
    latestObservation: {
      timestamp: shortText(observation.timestamp, 80),
      userVisible: Boolean(observation.userVisible),
      userPosition: shortText(observation.userPosition, 40),
      userDistance: shortText(observation.userDistance, 40),
      faceCount: finiteOrNull(observation.faceCount),
      detector: shortText(observation.detector, 40),
      note: shortText(observation.note, 180)
    },
    userVisible: Boolean(status.userVisible ?? observation.userVisible),
    userPosition: shortText(status.userPosition ?? observation.userPosition, 40),
    userDistance: shortText(status.userDistance ?? observation.userDistance, 40),
    faceCount: finiteOrNull(status.faceCount ?? observation.faceCount)
  });
}

export function compactSpeechState(speech) {
  const state = isPlainObject(speech) ? speech : {};
  return {
    listening: Boolean(state.listening ?? state.speechListening),
    lastTranscript: shortText(
      state.lastTranscript?.text ?? state.lastTranscript ?? state.finalTranscript,
      300
    ),
    speaking: Boolean(state.speaking ?? state.isSpeaking),
    muted: Boolean(state.muted ?? state.voiceMuted)
  };
}

export function compactTelemetry(telemetry) {
  const data = isPlainObject(telemetry) ? telemetry : {};
  return pick(data, [
    "motor_state",
    "battery",
    "rssi",
    "simulated",
    "left_speed",
    "right_speed",
    "current_left_speed",
    "current_right_speed"
  ]);
}

export function compactPersonality(personality) {
  const profile = isPlainObject(personality) ? personality : {};
  return {
    name: shortText(profile.name, 60),
    identity: shortText(profile.identity, 160),
    coreTraits: numericObject(profile.coreTraits),
    behaviorStyle: numericObject(profile.behaviorStyle),
    speechStyle: isPlainObject(profile.speechStyle)
      ? removeSecretsAndLargeFields(profile.speechStyle)
      : null
  };
}

function compactPolicy(policy) {
  const value = isPlainObject(policy) ? policy : {};
  return {
    localBrainEnabled: Boolean(value.localBrainEnabled),
    autonomousMode: Boolean(value.autonomousMode),
    localMotionArmed: Boolean(value.localMotionArmed),
    localCameraAllowed: Boolean(value.localCameraAllowed),
    localSpeechAllowed: value.localSpeechAllowed !== false,
    allowAutonomousMovement: Boolean(value.allowAutonomousMovement),
    allowAutonomousSpeech: value.allowAutonomousSpeech !== false
  };
}

function compactEvent(event) {
  const value = isPlainObject(event) ? event : {};
  const payload = isPlainObject(value.payload) ? value.payload : {};
  return {
    type: shortText(value.type, 80),
    text: shortText(payload.text ?? value.text ?? payload.lifeEventType ?? payload.originalType, 500),
    shouldImmediateStop: typeof payload.shouldImmediateStop === "boolean" ? payload.shouldImmediateStop : null,
    normalizedText: shortText(payload.normalizedText, 500)
  };
}

function removeSecretsAndLargeFields(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(removeSecretsAndLargeFields);
  }

  if (!isPlainObject(value)) {
    return typeof value === "string" ? scrubText(value, 500) : value;
  }

  const result = {};

  Object.entries(value).forEach(([key, child]) => {
    if (key === "dataUrl" || key === "imageData" || key === "raw" || key === "logs") {
      return;
    }

    if (looksSecretLike(key) || looksSecretLike(child)) {
      return;
    }

    result[key] = removeSecretsAndLargeFields(child);
  });

  return result;
}

function removeDataUrls(value) {
  return removeSecretsAndLargeFields(value);
}

function pick(source, keys) {
  const result = {};

  keys.forEach((key) => {
    const value = source[key];

    if (value !== undefined) {
      result[key] = typeof value === "string" ? shortText(value, 200) : value;
    }
  });

  return result;
}

function numericObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const result = {};

  Object.entries(value).forEach(([key, child]) => {
    const numeric = Number(child);

    if (Number.isFinite(numeric)) {
      result[key] = Math.min(1, Math.max(0, numeric));
    }
  });

  return result;
}

function shortText(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }

  return scrubText(String(value), maxLength);
}

function scrubText(text, maxLength) {
  if (looksSecretLike(text)) {
    return "[redacted]";
  }

  return text.slice(0, maxLength);
}

function looksSecretLike(value) {
  const text = String(value ?? "");
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function safeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
