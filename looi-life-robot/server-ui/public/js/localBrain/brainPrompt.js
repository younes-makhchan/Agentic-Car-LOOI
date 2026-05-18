import { MOVEMENT_PROMPT_LIST } from "../embodiment/movementCatalog.js";

export const LOCAL_BRAIN_SYSTEM_PROMPT = `
<system>
You are LOOI: a small embodied companion with wheels, phone face, camera, mic, and speaker.
Be curious, gentle, playful, brief, and respectful.
Allowed movement names: ${MOVEMENT_PROMPT_LIST}.

Rules:
- Return one action object only: type "perform".
- Use speech only when useful; silence is valid.
- Use movement only when it fits; "still" is valid.
- Stop/freeze/don't move => movement ["still"] and brief acknowledgement if useful.
- Do not pretend to see if camera is off.
- Runtime safety is enforced after your reply; choose intent only.
- Do not mention JSON, tools, or internal state.
<important>
Return ONLY strict JSON in this exact shape:
{"text":string|null,"action":{"type":"perform","args":{"speech":{"text":string,"tone":"soft|happy|curious|serious|shy|playful"},"movement":["one_or_more_allowed_movement_names"],"timing":"parallel|sequence","iterateMovement":boolean}},"reason":string,"confidence":number}
</important>
</system>
`;

export function buildLocalBrainPrompt(context = {}) {
  return [
    LOCAL_BRAIN_SYSTEM_PROMPT,
    "Context:",
    JSON.stringify(compactContext(context)),
    "JSON:",
    JSON.stringify(
      {
        text: null,
        action: {
          type: "perform",
          args: {
            speech: {
              text: "",
              tone: "soft"
            },
            movement: ["still"],
            timing: "parallel",
            iterateMovement: false
          }
        },
        reason: "brief reason",
        confidence: 0.5
      },
      null,
      2
    )
  ].join("\n");
}

function compactContext(context = {}) {
  const event = context.triggerEvent ?? null;
  const lifeState = context.lifeState ?? {};
  const speech = context.speech ?? context.voice ?? {};
  const attention = context.attention ?? {};

  return {
    reason: context.reason ?? "manual",
    input: event
      ? {
          type: event.type,
          text: event.payload?.text ?? event.text ?? null,
          classification: event.payload?.classification ?? event.classification ?? null,
          suggestedIntent: event.payload?.suggestedIntent?.action ?? event.suggestedIntent?.action ?? null
        }
      : null,
    attention: {
      mode: attention.mode ?? null
    },
    life: {
      mood: lifeState.mood ?? null,
      energy: round01(lifeState.energy),
      userVisible: lifeState.userVisible ?? null,
      userPosition: lifeState.userPosition ?? null,
      userDistance: lifeState.userDistance ?? null,
      speaking: lifeState.isSpeaking ?? null,
      listening: lifeState.isListening ?? null
    },
    speech: {
      listening: speech.listening ?? null,
      speaking: speech.speaking ?? null
    }
  };
}

function round01(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.round(Math.min(1, Math.max(0, numeric)) * 100) / 100
    : null;
}
