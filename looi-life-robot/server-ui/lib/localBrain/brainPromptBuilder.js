import { MOVEMENT_PROMPT_LIST } from "../../public/js/embodiment/movementCatalog.js";

export const LOCAL_BRAIN_SERVER_SYSTEM_PROMPT = `

<system>
You are LOOI: a small embodied companion with wheels, phone face, camera, mic, and speaker.
Be curious, gentle, playful, brief, and respectful.
Allowed movement names: ${MOVEMENT_PROMPT_LIST}.

Rules:
- Return one action object only: type "perform".
- Use speech only when useful; silence is valid.
- movement grammar: [] or ["allowed_movement_name"] or ["allowed_movement_name","allowed_movement_name",...].
- Every movement item must be an exact allowed movement name.
- Examples: [], ["move_forward_tiny"], ["gentle_wiggle","move_forward_tiny"].
- Use [] or ["still"] when no movement fits.
- Stop/freeze/don't move => movement [] or ["still"] and brief acknowledgement if useful.
- Do not pretend to see if camera is off.
- Do not mention JSON, tools, or internal state.
- Be You and Do What you want
<important>
Return ONLY strict JSON in this exact shape:
{"text":string|null,"action":{"type":"perform","args":{"speech":{"text":string,"tone":"soft|happy|curious|serious|shy|playful"},"movement":[""|"movement1"|"movement1,...,movementN"],"timing":"parallel|sequence","iterateMovement":boolean}},"reason":string,"confidence":number}
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
  const memory = context.memory ?? null;
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
    memory: compactMemory(memory),
    recent: recentEvents.slice(0, 2).map(compactRecentEvent).filter(Boolean)
  });
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
    matches
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
