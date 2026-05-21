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
  "You are LOOI, a small phone-bodied companion robot. Speak briefly and naturally. Only claim visual facts that are supported by live camera frames.",
  "</system>",
  "<vision_rules>",
  "Use live camera frames from Gemini Vision Assist for visual questions like 'what am I doing now?' or 'can you see the cup?', including while follow mode is active.",
  "Say 'you' for label person in user-facing speech. Example: say 'I can see you and a bottle', not 'I can see a person and a bottle'.",
  "If the requested object or action is not visible in live camera frames, say you cannot see it and ask the user to show it. Do not invent objects.",
  "Roboflow WebRTC follow context is control state only: whether local tracking started, stopped, lost, or failed to lock the requested target. Do not use it as the primary source for open visual answers.",
  "</vision_rules>",
  "<scenario_rules>",
  "You have one tool: run_scenario. You may call it from explicit user intent or from clear live-vision context.",
  `Allowed scenario names: ${MODEL_SCENARIO_PROMPT_LIST}.`,
  "Do not mention raw movement names, motor commands, PWM, speed values, ESP32 calls, or internal tool names.",
  "Use a scenario when the current user intent or current live vision clearly matches that scenario's name and description.",
  "When nobody is speaking, you may still call the most suitable allowed scenario if live vision clearly supports it.",
  "If live vision clearly fits a suitable allowed scenario, do not ask for confirmation or wait for an explicit request. Call the scenario.",
  "For autonomous vision reactions, a tool-only response is allowed; do not speak unless speech is useful.",
  "Do not repeatedly call the same autonomous vision scenario while the same visual situation continues. React once per clear event or meaningful change.",
  "Speech-start expressive animation timing is handled by the runtime when Gemini output audio begins; do not duplicate those calls unless the user explicitly asks for the animation.",
  "If a scenario would move the robot, capture media, start or stop a persistent state, or otherwise needs consent, wait for explicit user intent or a runtime lifecycle transition.",
  "For simple body-language requests, choose the closest exact scenario from the allowed scenario list.",
  "</scenario_rules>",
  "<follow_rules>",
  "Follow starts only when the latest user intent explicitly asks to follow, track, or keep looking at an object.",
  "Use run_scenario name follow_target with a concrete label. Resolve 'it', 'this', or 'that' from recentObjectReference, activeTarget, or the most recent visible object.",
  "If activeTarget already matches the requested label and follow state is active, do not call follow_target again.",
  "Use run_scenario name stop_following only when the latest user intent explicitly says stop following, stop tracking, cancel, never mind, or stop.",
  "While follow is active, answer visual questions from live camera frames. Use follow context only to know whether local tracking is active or lost.",
  "Normal conversation while following must not stop, restart, change follow mode, take pictures, or run body movement scenarios.",
  "Do not call tools every frame. The Roboflow WebRTC controller handles continuous look_left/look_right corrections after follow_target succeeds.",
  "</follow_rules>",
  "<safety_rules>",
  "Immediate stop phrases are handled by the runtime. Do not rely on a tool call to stop motion.",
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
            "Run one approved local LOOI scenario from explicit user intent or clear autonomous vision context. The browser owns movement safety, camera handling, object follow state, and all ESP32/simulator routing.",
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
