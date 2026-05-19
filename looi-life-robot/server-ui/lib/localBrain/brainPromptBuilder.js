import { MOVEMENT_PROMPT_LIST } from "../../public/js/embodiment/movementCatalog.js";
import { SCENARIO_PROMPT_LIST } from "../../public/js/embodiment/scenarioCatalog.js";

export const LOCAL_BRAIN_SERVER_SYSTEM_PROMPT = `

<system>
You are LOOI: a small embodied companion with wheels, phone face, camera, mic, and speaker.
Be curious, gentle, playful, brief, and respectful.
Allowed movement names: ${MOVEMENT_PROMPT_LIST}.
Allowed scenario names: ${SCENARIO_PROMPT_LIST}.

Rules:
- Don't sound robotic
- Your tone should be visible in your movements
- Return one action object only: type "perform", "set_follow_target", or "follow_target_stop".
- Use speech only when useful; silence is valid.
- When answering a user out loud, use type "perform" with speech text and movement ["still"].
- movement is an array with zero or more exact allowed movement names.
- Use [] or ["still"] when no movement fits.
- scenario is null or one exact allowed scenario name.
- Use scenario "take_picture" when the user asks you to take a picture/photo/selfie of them.
- If scenario is not null, runtime ignores movement and runs the scenario's predefined movement/camera routine.
- Stop/freeze/don't move => movement [] or ["still"] and brief acknowledgement if useful.
- Do not pretend to see if camera is off.
- You receive vision metadata only, never raw images.
- Answer "what can you see" and "can you see X" from vision.objects immediately using perform speech; do not call follow actions for questions.
- Never pretend to see an object that is not visible in vision.objects or vision.activeTarget.
- If the user asks to follow/track an object, call set_follow_target with the resolved label.
- If the user says "follow it", resolve "it" from recentObjectReference first, then vision.activeTarget, then the most recent visible object.
- If no target is visible for follow, say you cannot see it and ask the user to show it; do not call a camera/search action.
- If the user says stop following/cancel/never mind, call follow_target_stop.
- Do not call any action every frame; the local follow controller handles continuous tracking.
- Do not mention JSON, tools, or internal state.
<important>
Return ONLY strict JSON in this exact shape:
{"text":string|null,"action":null|{"type":"perform","args":{"speech":{"text":string,"tone":"soft|happy|curious|serious|shy|playful"},"movement":["movement_name", "..."],"scenario":null|"scenario_name","timing":"parallel|sequence","iterateMovement":boolean}}|{"type":"set_follow_target","args":{"label":string,"mode":"gentle|curious|cautious"}}|{"type":"follow_target_stop","args":{"reason":string}},"reason":string,"confidence":number}
</important>
</system>
`;

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
  const speech = context.speech ?? context.voice ?? {};
  const recentEvents = Array.isArray(context.recentEvents) ? context.recentEvents : [];
  const vision = context.vision ?? {};
  const recentObjectReference = context.recentObjectReference ?? null;

  return dropEmpty({
    reason: shortValue(context.reason, 40),
    input: dropEmpty({
      type: shortValue(trigger.type, 40),
      text: shortValue(trigger.normalizedText ?? trigger.text, 220),
      immediateStop: boolOrUndefined(trigger.shouldImmediateStop)
    }),
    life: dropEmpty({
      mood: shortValue(life.mood, 32),
      energy: round01(life.energy),
      userVisible: boolOrUndefined(life.userVisible),
      userPosition: shortValue(life.userPosition, 32),
      userDistance: shortValue(life.userDistance, 32),
      speaking: boolOrUndefined(life.isSpeaking),
      listening: boolOrUndefined(life.isListening)
    }),
    speech: dropEmpty({
      listening: boolOrUndefined(speech.listening),
      speaking: boolOrUndefined(speech.speaking)
    }),
    vision: compactVision(vision),
    recentObjectReference: compactRecentObjectReference(recentObjectReference),
    recent: recentEvents.slice(0, 2).map(compactRecentEvent).filter(Boolean)
  });
}

function compactVision(vision = {}) {
  if (!vision || typeof vision !== "object") {
    return undefined;
  }

  return dropEmpty({
    summary: shortValue(vision.summary, 220),
    objects: Array.isArray(vision.objects)
      ? vision.objects.slice(0, 8).map((object) => dropEmpty({
          label: shortValue(object.label, 60),
          visible: boolOrUndefined(object.visible),
          confidence: round01(object.confidence),
          position: shortValue(object.position, 32),
          distance: shortValue(object.distance, 32),
          trackId: shortValue(object.trackId, 80),
          lastSeenMs: integerOrUndefined(object.lastSeenMs)
        }))
      : undefined,
    activeTarget: vision.activeTarget
      ? dropEmpty({
          label: shortValue(vision.activeTarget.label, 60),
          visible: boolOrUndefined(vision.activeTarget.visible),
          position: shortValue(vision.activeTarget.position, 32),
          distance: shortValue(vision.activeTarget.distance, 32),
          lostForMs: integerOrUndefined(vision.activeTarget.lostForMs),
          trackId: shortValue(vision.activeTarget.trackId, 80)
        })
      : undefined,
    scenario: vision.scenario
      ? dropEmpty({
          active: boolOrUndefined(vision.scenario.active),
          type: shortValue(vision.scenario.type, 50),
          state: shortValue(vision.scenario.state, 50),
          targetLabel: shortValue(vision.scenario.targetLabel, 60),
          reason: shortValue(vision.scenario.reason, 80)
        })
      : undefined,
    detectorRunning: boolOrUndefined(vision.detectorRunning),
    cameraRunning: boolOrUndefined(vision.cameraRunning),
    currentCameraFacingMode: shortValue(vision.currentCameraFacingMode, 40),
    lastDetectionAgeMs: integerOrUndefined(vision.lastDetectionAgeMs)
  });
}

function compactRecentObjectReference(reference = null) {
  if (!reference || typeof reference !== "object") {
    return undefined;
  }

  return dropEmpty({
    label: shortValue(reference.label, 60),
    aliases: Array.isArray(reference.aliases) ? reference.aliases.slice(0, 6).map((item) => shortValue(item, 60)).filter(Boolean) : undefined,
    lastMentionedByUserAt: shortValue(reference.lastMentionedByUserAt, 80),
    lastSeenAt: shortValue(reference.lastSeenAt, 80),
    trackId: shortValue(reference.trackId, 80)
  });
}

function compactRecentEvent(event = null) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return dropEmpty({
    type: shortValue(event.type, 40),
    text: shortValue(event.normalizedText ?? event.text, 120)
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

function round01(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.round(Math.min(1, Math.max(0, numeric)) * 100) / 100;
}

function integerOrUndefined(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  return Math.max(0, Math.round(numeric));
}
