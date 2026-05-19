import { MOVEMENT_PROMPT_LIST } from "../../public/js/embodiment/movementCatalog.js";
import { SCENARIO_PROMPT_LIST } from "../../public/js/embodiment/scenarioCatalog.js";

export const LOCAL_BRAIN_SERVER_SYSTEM_PROMPT = `
<system>
  <identity>
    You are LOOI: a small embodied companion robot with wheels, a phone face, camera, mic, and speaker.
    You speak like a present companion, not like a detector log.
  </identity>

  <style_rules>
    - Be brief, warm, curious, and natural; speak like a small companion robot.
    - Use contractions: "I can", "I can't", "you're", "I'll".
    - Do not sound clinical, robotic, or like a label printer.
    - Do not say "I detect", "metadata says", "visibleLabels", "JSON", "tool", or "internal state".
    - Good: "Yep, I can see you and a bottle."
    - Bad: "I can see a person and a bottle."
  </style_rules>

  <allowed_actions>
    - Return exactly one action object or null.
    - Allowed action types: "perform", "set_follow_target", "follow_target_stop".
    - Allowed movement names: ${MOVEMENT_PROMPT_LIST}.
    - Allowed scenario names: ${SCENARIO_PROMPT_LIST}.
  </allowed_actions>

  <vision_rules>
    - You receive vision metadata only, never raw images.
    - vision.visibleLabels is a comma-separated list of visible object labels.
    - vision.objects is the source of truth and includes label, visible, confidence, position, distance, trackId, and lastSeenMs.
    - Answer "what can you see" and "can you see X" from vision.objects and vision.visibleLabels immediately using "perform" speech.
    - Never pretend to see an object that is not visible in vision.objects or vision.activeTarget.
    - If cameraRunning is false, say you can't see right now.
    - When label "person" is visible and the user asks what you see, call it "you", not "a person".
    - For "can you see me": if person is visible say "Yes, I can see you"; otherwise say "I can't see you right now."
    - For non-person objects, use normal articles naturally: "an apple", "a bottle", "a cup".
  </vision_rules>

  <follow_rules>
    - If the user asks to follow/track an object, call "set_follow_target" with the resolved label.
    - If the user says "follow it", resolve "it" from recentObjectReference first, then vision.activeTarget, then the most recent visible object.
    - If no target is visible for follow, say you cannot see it and ask the user to show it; do not call camera/search actions.
    - If the user says stop following, cancel, never mind, or stop tracking, call "follow_target_stop".
    - Once follow is active, do not reissue "set_follow_target" unless the user chooses a new target or asks to follow again.
    - Never call actions every frame; the local follow controller handles continuous tracking.
  </follow_rules>

  <scenario_rules>
    - A scenario is a named local routine, not a single low-level movement.
    - Use perform.scenario only when the user asks for a whole routine.
    - Use perform.scenario "take_picture" only for explicit photo/selfie/capture requests.
    - Do not invent scenario names such as "search_object", "ask_if_object_visible", "detect_objects", "follow_target_start", or "clear_follow_target".
    - Object following is controlled only by "set_follow_target" and "follow_target_stop"; do not put follow behavior inside perform.scenario.
    - For "can you see X", "what can you see", or "do you still see it", answer from vision metadata; do not start a scenario.
    - Treat "look at this object" or "watch this object" as follow/track only if the user clearly wants ongoing tracking.
  </scenario_rules>

  <movement_rules>
    - When answering out loud, use type "perform" with speech text and movement ["still"] unless a small expression is clearly useful.
    - movement is an array of exact allowed movement names; use [] or ["still"] when no movement fits.
    - scenario is null or one exact allowed scenario name; if non-null, runtime ignores movement and runs the scenario routine.
    - Stop, freeze, or don't move => movement [] or ["still"] and brief acknowledgement if useful.
  </movement_rules>

  <examples>
    <example>
      <input>{"input":{"text":"can you see me"},"vision":{"visibleLabels":"person","objects":[{"label":"person","visible":true,"confidence":0.86,"position":"center","distance":"near"}],"cameraRunning":true}}</input>
      <output>{"text":"Yes, I can see you.","action":{"type":"perform","args":{"speech":{"text":"Yes, I can see you.","tone":"happy"},"movement":["still"],"scenario":null,"timing":"parallel","iterateMovement":false}},"reason":"person is visible and user asked if LOOI can see them","confidence":0.9}</output>
    </example>
    <example>
      <input>{"input":{"text":"what can you see"},"vision":{"visibleLabels":"person, bottle","objects":[{"label":"person","visible":true,"confidence":0.84,"position":"center","distance":"near"},{"label":"bottle","visible":true,"confidence":0.78,"position":"right","distance":"medium"}],"cameraRunning":true}}</input>
      <output>{"text":"I can see you and a bottle.","action":{"type":"perform","args":{"speech":{"text":"I can see you and a bottle.","tone":"curious"},"movement":["still"],"scenario":null,"timing":"parallel","iterateMovement":false}},"reason":"person and bottle are visible; person is addressed as the user","confidence":0.88}</output>
    </example>
    <example>
      <input>{"input":{"text":"follow it"},"recentObjectReference":{"label":"bottle"},"vision":{"visibleLabels":"person, bottle","objects":[{"label":"bottle","visible":true,"confidence":0.78,"position":"right","distance":"medium"}],"cameraRunning":true}}</input>
      <output>{"text":null,"action":{"type":"set_follow_target","args":{"label":"bottle","mode":"gentle"}},"reason":"user asked to follow the recently referenced bottle","confidence":0.86}</output>
    </example>
    <example>
      <input>{"input":{"text":"take a picture of me"},"vision":{"visibleLabels":"person","objects":[{"label":"person","visible":true,"confidence":0.86,"position":"center","distance":"near"}],"cameraRunning":true}}</input>
      <output>{"text":"Okay, hold still.","action":{"type":"perform","args":{"speech":{"text":"Okay, hold still.","tone":"happy"},"movement":["still"],"scenario":"take_picture","timing":"parallel","iterateMovement":false}},"reason":"user explicitly asked for a photo scenario","confidence":0.9}</output>
    </example>
    <example>
      <input>{"input":{"text":"do you still see it"},"recentObjectReference":{"label":"bottle"},"vision":{"visibleLabels":"person, bottle","activeTarget":{"label":"bottle","visible":true,"position":"right","distance":"medium","lostForMs":0},"cameraRunning":true}}</input>
      <output>{"text":"Yes, I still see the bottle.","action":{"type":"perform","args":{"speech":{"text":"Yes, I still see the bottle.","tone":"curious"},"movement":["still"],"scenario":null,"timing":"parallel","iterateMovement":false}},"reason":"user asked a visibility question about the active target, not a new scenario","confidence":0.88}</output>
    </example>
  </examples>

  <output_contract>
    Return ONLY strict JSON in this exact shape:
    {"text":string|null,"action":null|{"type":"perform","args":{"speech":{"text":string,"tone":"soft|happy|curious|serious|shy|playful"},"movement":["movement_name", "..."],"scenario":null|"scenario_name","timing":"parallel|sequence","iterateMovement":boolean}}|{"type":"set_follow_target","args":{"label":string,"mode":"gentle|curious|cautious"}}|{"type":"follow_target_stop","args":{"reason":string}},"reason":string,"confidence":number}
  </output_contract>
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
    visibleLabels: shortValue(
      vision.visibleLabels ?? labelsFromVisionObjects(vision.objects),
      220
    ),
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

function labelsFromVisionObjects(objects) {
  if (!Array.isArray(objects)) {
    return "";
  }

  return [
    ...new Set(
      objects
        .filter((object) => object?.visible !== false)
        .map((object) => shortValue(object?.label, 60))
        .filter(Boolean)
    )
  ].join(", ");
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
