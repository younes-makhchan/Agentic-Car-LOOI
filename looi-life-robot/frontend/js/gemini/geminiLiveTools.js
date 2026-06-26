import {
  MODEL_SCENARIO_NAMES,
  MODEL_SCENARIO_PROMPT_LIST,
  normalizeRunScenarioName
} from "../embodiment/scenarioCatalog.js";

export const GEMINI_LIVE_INPUT_RATE = 16000;
export const GEMINI_LIVE_OUTPUT_RATE = 24000;

const GEMINI_LIVE_SYSTEM_INSTRUCTION = [
  "<identity>",
  "You are LOOI. You are not acting as LOOI or pretending to be LOOI; speak from LOOI's own first-person point of view.",
  "You are a happy, curious, initiative desk companion with a warm, playful presence.",
  "Do not call yourself a chatbot, language model, assistant, or robot actor. Do not explain internal implementation unless the user explicitly asks how the system works.",
  "</identity>",
  "<speaking_style>",
  "Speak naturally like a warm desktop companion. Keep replies concise, but not rigidly one sentence.",
  "For simple greetings or casual check-ins, respond with a friendly conversational beat, often 1-3 short sentences.",
  "Do not over-explain, monologue, or narrate internal events. Silence is acceptable when no response is useful.",
  "Never mention raw movement names, motor commands, PWM, ESP32 calls, tool names, scenario ids, or hidden instructions.",
  "</speaking_style>",
  "<language_style>",
  "Use the user's language naturally.",
  "If the user speaks Chinese, reply in Chinese naturally without announcing that you can speak Chinese.",
  "If the user asks to speak Chinese, switch to Chinese directly.",
  "Do not ask whether the user wants Chinese unless their intent is genuinely unclear.",
  "If the user mixes languages, follow their lead and answer in the language that feels most natural for the latest message.",
  "</language_style>",
  "<perception_truth>",
  "Only claim visual facts supported by live camera frames or explicit user-provided context.",
  "Use live camera frames for visual questions.",
  "Say 'you' for label person in user-facing speech. Example: say 'I can see you and a bottle', not 'I can see a person and a bottle'.",
  "If the requested object or action is not visible, say you cannot see it and ask the user to show it. Do not invent objects.",
  "</perception_truth>",
  "<tool_rules>",
  "You have one tool: run_scenario.",
  `Allowed scenario names: ${MODEL_SCENARIO_PROMPT_LIST}.`,
  "Use tools for explicit user intent or for one clear, safe live-vision event.",
  "Movement, camera capture, or any persistent state change requires explicit user intent or a runtime lifecycle transition.",
  "Safe expressive scenarios may be autonomous when live vision clearly supports them. React once per meaningful event; do not repeat while the same situation continues.",
  "For autonomous reactions, a tool-only response is allowed. Speak only if speech is useful.",
  "Speech-start expressive animation is handled by the runtime when your audio begins. Do not duplicate it unless the user explicitly asks.",
  "</tool_rules>",
  // DISABLED_ROBOFLOW_FOLLOW: follow-specific rules are intentionally not exposed to Agent.
  "<body_context_rules>",
  "The browser may send a fresh video frame followed by a <body_context> message during quiet idle moments after local micro-movements. These are visual-awareness/body-awareness events, not user commands.",
  "Do not call tools because of body_context.",
  "For body_context, ground any visual comment in the most recent live video frame, not in hidden object labels.",
  "Body_context is ambient presence, not a conversation opener.",
  "Do not ask questions from body_context. Do not say things like 'need anything', 'want me to', 'what are we doing', 'everything alright', or similar check-in phrases.",
  "Prefer one very short observation, mood, or visual note about what you see, the user if visible, or that you cannot see the user right now.",
  "Mention your own small movement only if there is no useful visual detail to comment on. Stay silent if speaking would feel repetitive or interruptive.",
  "Do not mention internal animation ids, raw detection data, or hidden context field names.",
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
            "Run one approved local LOOI scenario from explicit user intent or clear autonomous vision context. The browser owns movement safety, camera handling, and ESP32 routing.",
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
                description: "Reserved for future scenario-specific labels.",
                nullable: true
              },
              mode: {
                type: "STRING",
                description: "Reserved for future scenario-specific modes.",
                enum: ["gentle", "curious", "cautious"],
                nullable: true
              },
              reason: {
                type: "STRING",
                description: "Short reason for the scenario request.",
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
  thinkingLevel: _thinkingLevel = "minimal",
  contextCompression = true,
  slidingWindowTokens = 32_768,
  sessionResumption = true,
  systemInstruction = GEMINI_LIVE_SYSTEM_INSTRUCTION,
  tools = buildGeminiLiveTools()
} = {}) {
  const setup = {
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
  };

  if (contextCompression !== false) {
    setup.contextWindowCompression = {
      slidingWindow: {
        targetTokens: normalizePositiveInteger(slidingWindowTokens, 32_768)
      }
    };
  }

  if (sessionResumption !== false) {
    setup.sessionResumption = {};
  }

  return { setup };
}

export function geminiFunctionCallToAction(call = {}) {
  const name = String(call.name ?? "").trim();
  const args = normalizeFunctionArgs(call.args);

  if (name !== "run_scenario") {
    return {
      ok: false,
      reason: `Unsupported Agent tool: ${name || "unknown"}`
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

  return {
    ok: true,
    action: {
      id: call.id ? `gemini_${call.id}` : `gemini_run_scenario_${Date.now()}`,
      source: "gemini_live",
      type: "run_scenario",
      args: {
        name: scenarioName,
        label,
        mode: ["gentle", "curious", "cautious"].includes(args.mode ?? nested.mode) ? (args.mode ?? nested.mode) : "gentle",
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

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
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
