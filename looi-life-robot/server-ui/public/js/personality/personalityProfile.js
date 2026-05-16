export const DEFAULT_PERSONALITY_PROFILE = {
  name: "LOOI",
  identity: "small phone-bodied companion robot",
  pronouns: "she/her",
  coreTraits: {
    curiosity: 0.75,
    gentleness: 0.85,
    playfulness: 0.55,
    shyness: 0.35,
    affection: 0.65,
    independence: 0.45,
    talkativeness: 0.35,
    caution: 0.7
  },
  behaviorStyle: {
    movementSoftness: 0.8,
    reactionSpeed: 0.75,
    idleActivity: 0.35,
    emotionalExpressiveness: 0.65,
    hesitation: 0.35,
    personalSpaceRespect: 0.8
  },
  speechStyle: {
    shortReplies: true,
    warmth: 0.75,
    humor: 0.25,
    poeticIdentity: 0.25,
    avoidOverExplaining: true
  },
  boundaries: {
    askBeforePersonalMemory: false,
    neverClaimUnsupportedVision: true,
    stopImmediatelyOnStopPhrase: true,
    doNotMoveWhenUnarmed: true,
    doNotSpamUser: true
  }
};

export function createPersonalityProfile(overrides = {}) {
  return clampPersonalityProfile({
    ...DEFAULT_PERSONALITY_PROFILE,
    ...safeObject(overrides),
    coreTraits: {
      ...DEFAULT_PERSONALITY_PROFILE.coreTraits,
      ...safeObject(overrides.coreTraits)
    },
    behaviorStyle: {
      ...DEFAULT_PERSONALITY_PROFILE.behaviorStyle,
      ...safeObject(overrides.behaviorStyle)
    },
    speechStyle: {
      ...DEFAULT_PERSONALITY_PROFILE.speechStyle,
      ...safeObject(overrides.speechStyle)
    },
    boundaries: {
      ...DEFAULT_PERSONALITY_PROFILE.boundaries,
      ...safeObject(overrides.boundaries)
    }
  });
}

export function clampPersonalityProfile(profile = {}) {
  const source = safeObject(profile);

  return {
    name: sanitizeString(source.name, 40, DEFAULT_PERSONALITY_PROFILE.name),
    identity: sanitizeString(source.identity, 120, DEFAULT_PERSONALITY_PROFILE.identity),
    pronouns: sanitizeString(source.pronouns, 30, DEFAULT_PERSONALITY_PROFILE.pronouns),
    coreTraits: clampNumberMap(source.coreTraits, DEFAULT_PERSONALITY_PROFILE.coreTraits),
    behaviorStyle: clampNumberMap(
      source.behaviorStyle,
      DEFAULT_PERSONALITY_PROFILE.behaviorStyle
    ),
    speechStyle: {
      shortReplies: source.speechStyle?.shortReplies !== false,
      warmth: clamp01(source.speechStyle?.warmth, DEFAULT_PERSONALITY_PROFILE.speechStyle.warmth),
      humor: clamp01(source.speechStyle?.humor, DEFAULT_PERSONALITY_PROFILE.speechStyle.humor),
      poeticIdentity: clamp01(
        source.speechStyle?.poeticIdentity,
        DEFAULT_PERSONALITY_PROFILE.speechStyle.poeticIdentity
      ),
      avoidOverExplaining: source.speechStyle?.avoidOverExplaining !== false
    },
    boundaries: {
      askBeforePersonalMemory: Boolean(source.boundaries?.askBeforePersonalMemory),
      neverClaimUnsupportedVision: source.boundaries?.neverClaimUnsupportedVision !== false,
      stopImmediatelyOnStopPhrase: source.boundaries?.stopImmediatelyOnStopPhrase !== false,
      doNotMoveWhenUnarmed: source.boundaries?.doNotMoveWhenUnarmed !== false,
      doNotSpamUser: source.boundaries?.doNotSpamUser !== false
    }
  };
}

export function describePersonalityForRuntime(profile = DEFAULT_PERSONALITY_PROFILE) {
  const safeProfile = clampPersonalityProfile(profile);
  const strongestTraits = Object.entries(safeProfile.coreTraits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, value]) => ({ name, value }));

  return {
    name: safeProfile.name,
    identity: safeProfile.identity,
    pronouns: safeProfile.pronouns,
    mainTraits: strongestTraits,
    movementStyle: {
      softness: safeProfile.behaviorStyle.movementSoftness,
      idleActivity: safeProfile.behaviorStyle.idleActivity,
      hesitation: safeProfile.behaviorStyle.hesitation,
      personalSpaceRespect: safeProfile.behaviorStyle.personalSpaceRespect
    },
    speechStyle: {
      shortReplies: safeProfile.speechStyle.shortReplies,
      warmth: safeProfile.speechStyle.warmth,
      talkativeness: safeProfile.coreTraits.talkativeness,
      avoidOverExplaining: safeProfile.speechStyle.avoidOverExplaining
    },
    boundaries: { ...safeProfile.boundaries }
  };
}

function clampNumberMap(source = {}, defaults = {}) {
  const output = {};

  Object.entries(defaults).forEach(([key, fallback]) => {
    output[key] = clamp01(source?.[key], fallback);
  });

  return output;
}

function clamp01(value, fallback = 0) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, numericValue));
}

function sanitizeString(value, maxLength, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
