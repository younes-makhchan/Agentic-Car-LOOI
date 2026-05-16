// Browser-local Life Engine state. Kimi and long-term memory are added later.
export function createDefaultLifeState() {
  const now = Date.now();

  return {
    mood: "neutral",
    energy: 0.75,
    boredom: 0.2,
    fear: 0.0,
    curiosity: 0.6,
    affection: 0.5,
    loneliness: 0.1,
    comfort: 0.6,

    attentionTarget: "none",
    userVisible: false,
    userDistance: "unknown",
    userPosition: "unknown",

    isSpeaking: false,
    isListening: false,
    isMoving: false,

    battery: null,
    obstacle: false,

    lastInteractionAt: now,
    lastMotionAt: 0,
    lastBehaviorAt: 0,
    lastEventAt: now,
    lastUserSeenAt: null,
    lastProactiveEventAt: 0,
    silenceUntil: 0,
    interactionCount: 0,
    stopRespectUntil: 0,

    currentBehavior: "soft_idle",
    requestedBehavior: null,
    requestedBehaviorArgs: null,

    connectionState: "disconnected",
    robotMotorState: "stopped",

    recentEvents: []
  };
}

export function clamp01(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.min(1, Math.max(0, numericValue));
}

export function pushRecentEvent(state, event, maxEvents = 20) {
  if (!state || !event) {
    return [];
  }

  if (!Array.isArray(state.recentEvents)) {
    state.recentEvents = [];
  }

  state.recentEvents.unshift({
    timestamp: Date.now(),
    ...event
  });

  if (state.recentEvents.length > maxEvents) {
    state.recentEvents.length = maxEvents;
  }

  return state.recentEvents;
}

export function setMood(state, mood) {
  if (!state || typeof mood !== "string" || !mood.trim()) {
    return state?.mood;
  }

  state.mood = mood;
  return state.mood;
}

export function updateDriveValue(value, delta) {
  return clamp01(Number(value) + Number(delta || 0));
}
