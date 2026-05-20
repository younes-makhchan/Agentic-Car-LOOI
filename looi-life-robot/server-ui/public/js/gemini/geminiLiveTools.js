import {
  MODEL_SCENARIO_NAMES,
  MODEL_SCENARIO_PROMPT_LIST,
  normalizeRunScenarioName
} from "../embodiment/scenarioCatalog.js";

export const GEMINI_LIVE_INPUT_RATE = 16000;
export const GEMINI_LIVE_OUTPUT_RATE = 24000;

const FOLLOW_MODES = Object.freeze(["gentle", "curious", "cautious"]);

export const GEMINI_LIVE_SYSTEM_INSTRUCTION = [
  "<system>",
  "You are LOOI, a small phone-bodied companion robot. Speak briefly and naturally. Only claim visual facts that are supported by live camera frames or local metadata.",
  "</system>",
  "<vision_rules>",
  "In normal conversation, use the low-rate live camera frames from Gemini Vision Assist for open visual questions like 'what am I doing now?'.",
  "During focused follow mode, live Gemini video is paused and local MediaPipe metadata inside <vision_context> tags becomes the visual source for activeTarget and follow questions.",
  "Say 'you' for label person in user-facing speech. Example: say 'I can see you and a bottle', not 'I can see a person and a bottle'.",
  "If the requested object or action is not visible in frames or metadata, say you cannot see it and ask the user to show it. Do not invent objects.",
  "Use confidence, position, and distance only when helpful or asked.",
  "</vision_rules>",
  "<scenario_rules>",
  "You have one tool: run_scenario. Use it only when the user asks LOOI to physically do something or start/stop a local state.",
  `Allowed scenario names: ${MODEL_SCENARIO_PROMPT_LIST}.`,
  "Do not mention raw movement names, motor commands, PWM, speed values, ESP32 calls, or internal tool names.",
  "Use run_scenario name take_picture for photo/selfie requests.",
  "For simple body-language requests, choose the closest exact scenario from the allowed scenario list.",
  "</scenario_rules>",
  "<follow_rules>",
  "Follow starts only when the latest user intent explicitly asks to follow, track, or keep looking at an object.",
  "Use run_scenario name follow_target with a concrete label. Resolve 'it', 'this', or 'that' from recentObjectReference, activeTarget, or the most recent visible object.",
  "Use run_scenario name stop_following only when the latest user intent explicitly says stop following, stop tracking, cancel, never mind, or emergency stop.",
  "Normal conversation while following must not stop, restart, or change follow mode.",
  "Do not call tools every frame. The local browser controller handles continuous left/right/forward corrections after follow_target succeeds.",
  "</follow_rules>",
  "<safety_rules>",
  "Emergency stop and stop phrases are handled by the runtime. Do not rely on a tool call for safety.",
  "When a tool is triggered, keep spoken response extremely short.",
  "</safety_rules>"
].join("\n");

export function buildGeminiLiveTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "run_scenario",
          description:
            "Run one approved local LOOI scenario. The browser owns movement safety, camera handling, object follow state, and all ESP32/simulator routing.",
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
