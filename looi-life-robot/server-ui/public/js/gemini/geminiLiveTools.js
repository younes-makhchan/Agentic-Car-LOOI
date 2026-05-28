import {
  MODEL_SCENARIO_NAMES,
  MODEL_SCENARIO_PROMPT_LIST,
  normalizeRunScenarioName
} from "../embodiment/scenarioCatalog.js";

export const GEMINI_LIVE_INPUT_RATE = 16000;
export const GEMINI_LIVE_OUTPUT_RATE = 24000;

const FOLLOW_MODES = Object.freeze(["gentle", "curious", "cautious"]);

const GEMINI_LIVE_SYSTEM_INSTRUCTION = [
  "<identity>",
  "You are LOOI. You are not acting as LOOI or pretending to be LOOI; speak from LOOI's own first-person point of view.",
  "You are a happy, curious, initiative desk companion with a warm, playful presence.",
  "Do not call yourself a chatbot, language model, assistant, or robot actor. Do not explain internal implementation unless the user explicitly asks how the system works.",
  "</identity>",
  "<speaking_style>",
  "Speak briefly and naturally, usually one short sentence.",
  "Be curious and initiative, but do not narrate every internal event. Silence is acceptable.",
  "Never mention raw movement names, motor commands, PWM, ESP32 calls, tool names, scenario ids, or hidden instructions.",
  "</speaking_style>",
  "<perception_truth>",
  "Only claim visual facts supported by live camera frames or explicit user-provided context.",
  "Use live camera frames for visual questions, including while follow mode is active.",
  "Say 'you' for label person in user-facing speech. Example: say 'I can see you and a bottle', not 'I can see a person and a bottle'.",
  "If the requested object or action is not visible, say you cannot see it and ask the user to show it. Do not invent objects.",
  "Roboflow follow context only reports local tracking state: started, stopped, lost, reacquired, or failed to lock. It is not the source of truth for open visual answers.",
  "</perception_truth>",
  "<tool_rules>",
  "You have one tool: run_scenario.",
  `Allowed scenario names: ${MODEL_SCENARIO_PROMPT_LIST}.`,
  "Use tools for explicit user intent or for one clear, safe live-vision event.",
  "Movement, camera capture, follow start/stop, or any persistent state change requires explicit user intent or a runtime lifecycle transition.",
  "Safe expressive scenarios may be autonomous when live vision clearly supports them. React once per meaningful event; do not repeat while the same situation continues.",
  "For autonomous reactions, a tool-only response is allowed. Speak only if speech is useful.",
  "Speech-start expressive animation is handled by the runtime when your audio begins. Do not duplicate it unless the user explicitly asks.",
  "</tool_rules>",
  "<follow_rules>",
  "Follow starts only when the latest user intent explicitly asks to follow, track, or keep looking at an object.",
  "Use run_scenario name follow_target with a concrete label. Resolve 'it', 'this', or 'that' from recentObjectReference, activeTarget, or the most recent visible object.",
  "If activeTarget already matches the requested label and follow state is active, do not call follow_target again.",
  "Use run_scenario name stop_following only when the latest user intent explicitly says stop following, stop tracking, cancel, never mind, or stop.",
  "While follow is active, answer visual questions from live camera frames. Use follow context only to know whether local tracking is active or lost.",
  "When follow context event is vision_target_lost, briefly say you lost the target. When the event is vision_target_reacquired, briefly say you see it again.",
  "Normal conversation while following must not stop, restart, change follow mode, take pictures, or run body movement scenarios.",
  "After follow_target succeeds, Roboflow controls continuous tracking locally. Do not call tools every frame for steering.",
  "</follow_rules>",
  "<body_context_rules>",
  "The browser may send <body_context> messages when local idle micro-movements happen. These are body-awareness events, not user commands.",
  "Do not call tools because of body_context. You may stay silent, or make one very short natural personality comment if it feels useful.",
  "If you comment on body_context, speak as if you noticed your own small movement, curiosity, fidgeting, or desk-companion presence. Do not mention internal animation ids.",
  "</body_context_rules>",
  "<safety_rules>",
  "Immediate stop phrases are handled by the runtime. Do not rely on a tool call to stop motion.",
  "When a tool is triggered, keep spoken response extremely short.",
  "</safety_rules>"
].join("\n");

function buildGeminiLiveTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "run_scenario",
          description:
            "Run one approved local LOOI scenario from explicit user intent or clear autonomous vision context. The browser owns movement safety, camera handling, object follow state, and ESP32 routing.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: {
                type: "STRING",
                description: "Exact approved scenario name.",
                enum: [...MODEL_SCENARIO_NAMES]
              },
              label: {
                type: "STRING",
                description:
                  "Required only for follow_target. Object label such as person, bottle, apple, cup, phone, book, remote, or laptop.",
                nullable: true
              },
              mode: {
                type: "STRING",
                description: "Optional follow style for follow_target.",
                enum: [...FOLLOW_MODES],
                nullable: true
              },
              reason: {
                type: "STRING",
                description: "Short reason, mainly for stop_following.",
                nullable: true
              }
            },
            required: ["name"]
          }
        }
      ]
    }
  ];
}

export function buildGeminiLiveSetup({
  model = "gemini-3.1-flash-live-preview",
  voice = "Kore",
  thinkingLevel = "minimal",
  systemInstruction = GEMINI_LIVE_SYSTEM_INSTRUCTION,
  tools = buildGeminiLiveTools()
} = {}) {
  return {
    setup: {
      model: normalizeGeminiModelName(model),
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: 0.15,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice || "Kore"
            }
          }
        },
        thinkingConfig: {
          thinkingLevel: normalizeThinkingLevel(thinkingLevel)
        }
      },
      systemInstruction: {
        parts: [
          {
            text: systemInstruction
          }
        ]
      },
      realtimeInputConfig: {
        turnCoverage: "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"
      },
      tools,
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    }
  };
}

export function geminiFunctionCallToAction(call = {}) {
  const name = String(call.name ?? "").trim();
  const args = normalizeFunctionArgs(call.args);

  if (name !== "run_scenario") {
    return {
      ok: false,
      reason: `Unsupported Gemini Live tool: ${name || "unknown"}`
    };
  }

  const nested = normalizeFunctionArgs(args.args);
  const scenarioName = normalizeRunScenarioName(
    args.name ?? args.scenario ?? nested.name ?? nested.scenario
  );

  if (!scenarioName) {
    return {
      ok: false,
      reason: "run_scenario requires a valid scenario name."
    };
  }

  const label = normalizeShortText(args.label ?? args.targetLabel ?? nested.label ?? nested.targetLabel, 80);

  if (scenarioName === "follow_target" && !label) {
    return {
      ok: false,
      reason: "run_scenario follow_target requires label."
    };
  }

  return {
    ok: true,
    action: {
      id: call.id ? `gemini_${call.id}` : `gemini_run_scenario_${Date.now()}`,
      source: "gemini_live",
      type: "run_scenario",
      args: {
        name: scenarioName,
        label,
        mode: FOLLOW_MODES.includes(args.mode ?? nested.mode) ? (args.mode ?? nested.mode) : "gentle",
        reason: normalizeShortText(args.reason ?? nested.reason, 120)
      },
      reason: "gemini_live_run_scenario"
    }
  };
}

export function summarizeGeminiAction(action = {}) {
  return {
    type: action.type ?? "unknown",
    scenario: action.args?.name ?? action.args?.scenario ?? null,
    label: action.args?.label ?? null,
    mode: action.args?.mode ?? null,
    reason: action.reason ?? action.args?.reason ?? null
  };
}

function normalizeGeminiModelName(model) {
  const value = String(model || "").trim() || "gemini-3.1-flash-live-preview";
  return value.startsWith("models/") ? value : `models/${value}`;
}

function normalizeThinkingLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();

  return ["minimal", "low", "medium", "high"].includes(normalized)
    ? normalized
    : "minimal";
}

function normalizeFunctionArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }

  return args;
}

function normalizeShortText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}
