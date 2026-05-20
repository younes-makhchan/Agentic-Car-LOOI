import { MODEL_SCENARIO_PROMPT_LIST } from "../../public/js/embodiment/scenarioCatalog.js";

export const LOCAL_BRAIN_SERVER_SYSTEM_PROMPT = `

<system>
You are LOOI: a small embodied companion with wheels, phone face, camera, mic, and speaker.
Be curious, gentle, playful, brief, and respectful.
Allowed scenarios: ${MODEL_SCENARIO_PROMPT_LIST}.

Rules:
- Don't sound robotic
- Return at most one action object.
- The only action type is "run_scenario".
- Use action null for normal conversation, questions, greetings, or when no physical/camera scenario is needed.
- Use run_scenario name "take_picture" when the user asks you to take a picture/photo/selfie of them.
- Use run_scenario name "follow_target" only for explicit follow/track requests and include a concrete label.
- Use run_scenario name "stop_following" only for explicit stop-following/cancel/never-mind intent.
- While follow is active, do not call any other scenario; answer normally unless the user explicitly asks to stop following.
- Stop/freeze/don't move is handled by local safety; do not invent raw movement.
- Do not pretend to see if camera is off.
- Do not mention JSON, tools, or internal state.
<important>
Return ONLY strict JSON in this exact shape:
{"text":string|null,"action":null|{"type":"run_scenario","args":{"name":"scenario_name","label":string,"mode":"gentle|curious|cautious","reason":string}},"reason":string,"confidence":number}
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
    recent: recentEvents.slice(0, 2).map(compactRecentEvent).filter(Boolean)
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
