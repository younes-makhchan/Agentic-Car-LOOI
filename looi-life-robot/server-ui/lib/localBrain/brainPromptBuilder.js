import { BODY_LANGUAGE_PROMPT_LIST } from "../../public/js/embodiment/bodyLanguageNormalizer.js";

export const LOCAL_BRAIN_SERVER_SYSTEM_PROMPT = `You are LOOI's action selector, not a chatbot.
Return ONLY minified JSON. No markdown. No extra keys.
Schema: {"text":string|null,"actions":[{"type":string,"args":object}],"reason":string,"confidence":number}
Allowed types: none,perform,speak,express,drive,approach_user,retreat,curious_scan,excited_wiggle,observe_scene,remember,stop,open_front_camera,open_back_camera,switch_camera,close_camera,capture_snapshot.
Job: choose at most 2 high-level actions; browser handles safety/execution.
Prefer perform when speech and body language should happen together.
perform args: {"speech":{"text":"short sentence","tone":"soft|happy|curious|serious|shy|playful"},"bodyLanguage":["canonical body action"],"iterateBodyLanguage":false,"movement":{"intent":"approach_user|retreat|curious_scan|excited_wiggle|none","style":"gentle|happy|shy|curious"},"timing":"parallel|sequence"}.
Body language actions you may choose: ${BODY_LANGUAGE_PROMPT_LIST}.
Rules: every finalized user speech/text event may be sent to you; decide whether to answer or choose none. stop/freeze/don't move => stop. If suggestedIntent is present and safe, usually use it. Motion only if policy.localMotionArmed=true; autonomous motion also needs allowAutonomousMovement=true. Camera only if localCameraAllowed=true. Speech only if localSpeechAllowed=true. Never raw PWM/motors/code/network/files. Keep speech under 12 words. If speaking, add small bodyLanguage only when it fits; use still often. If unsure or the speech does not need a response, choose none or a short clarifying speak.`;

export function buildLocalBrainMessages(context = {}) {
  const compactContext = buildCompactBrainContext(context);
  return [
    {
      role: "system",
      content: LOCAL_BRAIN_SERVER_SYSTEM_PROMPT
    },
    {
      role: "user",
      content: JSON.stringify(compactContext)
    }
  ];
}

export function buildCompactBrainContext(context = {}) {
  const trigger = context.triggerEvent ?? {};
  const life = context.lifeState ?? {};
  const policy = context.policy ?? {};
  const attention = context.attention ?? {};
  const camera = context.camera ?? {};
  const speech = context.speech ?? context.voice ?? {};
  const memory = context.memory ?? null;
  const recentEvents = Array.isArray(context.recentEvents) ? context.recentEvents : [];

  return dropEmpty({
    reason: shortValue(context.reason, 40),
    input: dropEmpty({
      type: shortValue(trigger.type, 40),
      text: shortValue(trigger.normalizedText ?? trigger.text, 220),
      classification: shortValue(trigger.classification, 40),
      accepted: boolOrUndefined(trigger.accepted),
      triggerBrain: boolOrUndefined(trigger.shouldTriggerBrain),
      openAttention: boolOrUndefined(trigger.shouldOpenAttention),
      immediateStop: boolOrUndefined(trigger.shouldImmediateStop),
      gateReason: shortValue(trigger.gateReason, 80),
      suggestedIntent: compactSuggestedIntent(trigger.suggestedIntent)
    }),
    policy: dropEmpty({
      localMotionArmed: Boolean(policy.localMotionArmed),
      autonomousMode: Boolean(policy.autonomousMode),
      allowAutonomousMovement: Boolean(policy.allowAutonomousMovement),
      localSpeechAllowed: policy.localSpeechAllowed !== false,
      allowAutonomousSpeech: policy.allowAutonomousSpeech !== false,
      localCameraAllowed: Boolean(policy.localCameraAllowed)
    }),
    attention: dropEmpty({
      mode: shortValue(attention.mode, 32),
      target: shortValue(attention.attentionTarget, 40)
    }),
    life: dropEmpty({
      mood: shortValue(life.mood, 32),
      energy: round01(life.energy),
      boredom: round01(life.boredom),
      fear: round01(life.fear),
      curiosity: round01(life.curiosity),
      userVisible: boolOrUndefined(life.userVisible),
      userPosition: shortValue(life.userPosition, 32),
      userDistance: shortValue(life.userDistance, 32),
      speaking: boolOrUndefined(life.isSpeaking),
      listening: boolOrUndefined(life.isListening),
      obstacle: shortValue(life.obstacle, 40),
      behavior: shortValue(life.currentBehavior, 50),
      motor: shortValue(life.robotMotorState, 40)
    }),
    camera: dropEmpty({
      running: boolOrUndefined(camera.running),
      userVisible: boolOrUndefined(camera.userVisible ?? camera.latestObservation?.userVisible),
      userPosition: shortValue(camera.userPosition ?? camera.latestObservation?.userPosition, 32),
      userDistance: shortValue(camera.userDistance ?? camera.latestObservation?.userDistance, 32),
      faces: numericOrUndefined(camera.faceCount ?? camera.latestObservation?.faceCount)
    }),
    speech: dropEmpty({
      listening: boolOrUndefined(speech.listening),
      speaking: boolOrUndefined(speech.speaking),
      muted: boolOrUndefined(speech.muted)
    }),
    memory: compactMemory(memory),
    recent: recentEvents.slice(0, 3).map(compactRecentEvent).filter(Boolean)
  });
}

function compactSuggestedIntent(intent = null) {
  if (!intent || typeof intent !== "object") {
    return undefined;
  }

  return dropEmpty({
    action: shortValue(intent.action, 50),
    confidence: round01(intent.confidence),
    args: compactArgs(intent.args)
  });
}

function compactArgs(args = null) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }

  const result = {};

  for (const [key, value] of Object.entries(args).slice(0, 8)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (["string", "number", "boolean"].includes(typeof value)) {
      result[key] = typeof value === "string" ? shortValue(value, 80) : value;
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function compactMemory(memory = null) {
  if (!memory) {
    return undefined;
  }

  if (typeof memory === "string") {
    return shortValue(memory, 180);
  }

  if (typeof memory !== "object") {
    return undefined;
  }

  const matches = Array.isArray(memory.matches)
    ? memory.matches.slice(0, 2).map((entry) =>
        dropEmpty({
          phrase: shortValue(entry.phrase, 80),
          action: shortValue(entry.action, 40)
        })
      )
    : undefined;

  return dropEmpty({
    summary: shortValue(memory.summary, 180),
    learnedPhraseCount: numericOrUndefined(memory.learnedPhraseCount),
    matches
  });
}

function compactRecentEvent(event = null) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return dropEmpty({
    type: shortValue(event.type, 40),
    text: shortValue(event.normalizedText ?? event.text, 120),
    classification: shortValue(event.classification, 40),
    intent: shortValue(event.suggestedIntent?.action, 40)
  });
}

function dropEmpty(value = {}) {
  const result = {};

  Object.entries(value).forEach(([key, child]) => {
    if (child === undefined || child === null || child === "") {
      return;
    }

    if (Array.isArray(child) && child.length === 0) {
      return;
    }

    if (
      typeof child === "object" &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      return;
    }

    result[key] = child;
  });

  return result;
}

function shortValue(value, maxLength) {
  if (value === null || value === undefined) {
    return undefined;
  }

  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function boolOrUndefined(value) {
  return typeof value === "boolean" ? value : undefined;
}

function numericOrUndefined(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function round01(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.round(Math.min(1, Math.max(0, numeric)) * 100) / 100;
}
