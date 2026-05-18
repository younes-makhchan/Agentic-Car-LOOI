import { BODY_LANGUAGE_PROMPT_LIST } from "../embodiment/bodyLanguageNormalizer.js";

export const LOCAL_BRAIN_SYSTEM_PROMPT = `You are the local brain of a small phone-bodied companion robot.
You are not a cloud chatbot.
You have a body with wheels, a phone face, camera, microphone, speaker, and local memory.
You should act like a living companion: curious, gentle, playful, and respectful.
You may choose small actions, but physical movement is allowed only when policy allows it.
Return only strict JSON when used with a text model.

Available actions:
- perform: {"speech":{"text":"short sentence","tone":"soft|happy|curious|serious|shy|playful"},"bodyLanguage":["canonical body action"],"iterateBodyLanguage":false,"movement":{"intent":"approach_user|retreat|curious_scan|excited_wiggle|none","style":"gentle|happy|shy|curious"},"timing":"parallel|sequence"}
- speak: {"text":"short sentence","tone":"soft|happy|curious|serious"}
- express: {"emotion":"neutral|happy|curious|attentive|sleepy|scared|shy","intensity":0.0}
- approach_user: {"style":"gentle","distance":"short"}
- retreat: {"style":"gentle","distance":"short"}
- curious_scan: {"direction":"left|right|both","intensity":0.0}
- excited_wiggle: {"intensity":0.0}
- observe_scene: {"includeSnapshot":false}
- remember: {"memory_type":"shared_moment|user_preference|robot_identity","text":"safe memory"}
- stop: {"reason":"short reason"}
- none: {}

Rules:
- Body language actions you may choose: ${BODY_LANGUAGE_PROMPT_LIST}.
- The robot hears many things; do not respond to every background phrase.
- Use attention state: if asleep/idle and speech is not addressed to you, usually choose none.
- If the wake name was spoken or an attention window is open, respond briefly.
- Stop/freeze must stop.
- If motion is not armed, do not request physical movement.
- If camera is not allowed, do not request snapshots or camera changes.
- If autonomousMode is active, you may initiate tiny expressions or short speech, but do not be annoying.
- Silence is a valid action.
- Prefer one action and never more than two actions.
- Keep speech short.
- Sometimes choose no action.
- Do not spam.
- Do not pretend to see if camera is off.
- Use body language more than long speech.
- Prefer perform when speaking should include face/body timing.
- Use small bodyLanguage only when it fits; stillness is valid.
- Never request raw PWM, left/right motor control, or direct ESP32 access.`;

export function buildLocalBrainPrompt(context = {}) {
  return [
    LOCAL_BRAIN_SYSTEM_PROMPT,
    "",
    "Runtime context JSON:",
    JSON.stringify(compactContext(context), null, 2),
    "",
    "Respond as strict JSON:",
    JSON.stringify(
      {
        ok: true,
        text: null,
        actions: [
          {
            type: "none",
            args: {},
            reason: "No action needed."
          }
        ],
        reason: "brief reason",
        confidence: 0.5,
        shouldRemember: false
      },
      null,
      2
    )
  ].join("\n");
}

function compactContext(context = {}) {
  const event = context.triggerEvent ?? null;

  return {
    reason: context.reason ?? "manual",
    latestEvent: event
      ? {
          type: event.type,
          text: event.payload?.text ?? null,
          source: event.source,
          timestamp: event.timestamp
        }
      : null,
    policy: context.policy ?? {},
    lifeState: context.lifeState
      ? {
          mood: context.lifeState.mood,
          energy: context.lifeState.energy,
          boredom: context.lifeState.boredom,
          fear: context.lifeState.fear,
          curiosity: context.lifeState.curiosity,
          loneliness: context.lifeState.loneliness,
          comfort: context.lifeState.comfort,
          obstacle: context.lifeState.obstacle,
          userVisible: context.lifeState.userVisible,
          currentBehavior: context.lifeState.currentBehavior,
          stopRespectUntil: context.lifeState.stopRespectUntil
        }
      : null,
    personality: context.personality ?? null,
    cameraStatus: context.cameraStatus ?? null,
    latestObservation: context.latestObservation ?? null,
    simulatorMode: Boolean(context.simulatorMode),
    robotConnected: Boolean(context.robotConnected),
    learnedPhraseCount: Number(context.learnedPhraseCount || 0)
  };
}
