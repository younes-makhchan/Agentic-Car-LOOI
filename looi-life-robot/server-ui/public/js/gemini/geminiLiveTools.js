import {
  MOVEMENT_ACTION_NAMES,
  MOVEMENT_PROMPT_LIST
} from "../embodiment/movementCatalog.js";
import {
  SCENARIO_NAMES,
  SCENARIO_PROMPT_LIST,
  normalizeScenarioName
} from "../embodiment/scenarioCatalog.js";

export const GEMINI_LIVE_INPUT_RATE = 16000;
export const GEMINI_LIVE_OUTPUT_RATE = 24000;

const TONES = Object.freeze(["soft", "happy", "curious", "serious", "shy", "playful"]);
const EXPRESSIONS = Object.freeze([
  "neutral",
  "happy",
  "curious",
  "attentive",
  "sleepy",
  "scared",
  "shy",
  "sad"
]);
const EYE_DIRECTIONS = Object.freeze(["center", "left", "right", "up", "down"]);
const TIMINGS = Object.freeze(["parallel", "sequence"]);

export const GEMINI_LIVE_SYSTEM_INSTRUCTION = [
  "You are LOOI, a small phone-bodied companion robot. Speak naturally and briefly.",
  "Use tools for body language, movement, scenarios, expression, and stop. Never mention tool names to the user.",
  `Allowed movement names only: ${MOVEMENT_PROMPT_LIST}.`,
  `Allowed scenario names only: ${SCENARIO_PROMPT_LIST || "none"}.`,
  "Call perform when body language should happen while or near your speech. Use zero, one, or several exact movement names.",
  "Call take_picture when the user asks for a photo or says take a picture.",
  "For stop, freeze, halt, or do not move: call stop immediately and keep the spoken reply minimal.",
  "Never invent movement or scenario names. Never request raw speed, PWM, motor pins, or arbitrary drive commands."
].join("\n");

export function buildGeminiLiveTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "perform",
          description:
            "Queue safe LOOI body language or a predefined scenario. Use this while speaking when body movement helps the response.",
          parameters: {
            type: "OBJECT",
            properties: {
              movement: {
                type: "ARRAY",
                description:
                  "Zero, one, or more exact movement names. Use only the enum values.",
                items: {
                  type: "STRING",
                  enum: [...MOVEMENT_ACTION_NAMES]
                },
                maxItems: "6"
              },
              scenario: {
                type: "STRING",
                description:
                  "Optional exact scenario name. If set, local scenario movement overrides movement.",
                enum: [...SCENARIO_NAMES],
                nullable: true
              },
              timing: {
                type: "STRING",
                description: "parallel for speech plus gesture together; sequence for ordered gestures.",
                enum: [...TIMINGS]
              },
              iterateMovement: {
                type: "BOOLEAN",
                description:
                  "True only for a very short repeated body-language loop while speaking. The browser bounds repeats."
              }
            },
            required: []
          }
        },
        {
          name: "stop",
          description:
            "Immediately stop Gemini audio playback and all robot body motion/macros.",
          parameters: {
            type: "OBJECT",
            properties: {
              reason: {
                type: "STRING",
                description: "Short reason, for example user_stop."
              }
            },
            required: []
          }
        },
        {
          name: "take_picture",
          description:
            "Run LOOI's local photo scenario. The browser handles camera capture and preview.",
          parameters: {
            type: "OBJECT",
            properties: {},
            required: []
          }
        },
        {
          name: "set_expression",
          description: "Set LOOI's face expression and eye direction without moving wheels.",
          parameters: {
            type: "OBJECT",
            properties: {
              expression: {
                type: "STRING",
                enum: [...EXPRESSIONS]
              },
              eyeDirection: {
                type: "STRING",
                enum: [...EYE_DIRECTIONS]
              },
              tone: {
                type: "STRING",
                enum: [...TONES],
                nullable: true
              }
            },
            required: ["expression"]
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
        temperature: 0.35,
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
      tools,
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    }
  };
}

export function geminiFunctionCallToAction(call = {}) {
  const name = String(call.name ?? "").trim();
  const args = normalizeFunctionArgs(call.args);

  if (name === "perform") {
    return {
      ok: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_perform_${Date.now()}`,
        source: "gemini_live",
        type: "perform",
        args: {
          movement: readMovementNames(args.movement),
          scenario: normalizeScenarioName(args.scenario),
          timing: TIMINGS.includes(args.timing) ? args.timing : "parallel",
          iterateMovement: args.iterateMovement === true
        },
        reason: "gemini_live_perform"
      }
    };
  }

  if (name === "take_picture") {
    return {
      ok: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_take_picture_${Date.now()}`,
        source: "gemini_live",
        type: "perform",
        args: {
          movement: [],
          scenario: "take_picture",
          timing: "sequence",
          iterateMovement: false
        },
        reason: "gemini_live_take_picture"
      }
    };
  }

  if (name === "set_expression") {
    return {
      ok: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_expression_${Date.now()}`,
        source: "gemini_live",
        type: "express",
        args: {
          emotion: EXPRESSIONS.includes(args.expression) ? args.expression : "attentive",
          eyeDirection: EYE_DIRECTIONS.includes(args.eyeDirection) ? args.eyeDirection : "center",
          tone: TONES.includes(args.tone) ? args.tone : "soft",
          intensity: 0.82
        },
        reason: "gemini_live_expression"
      }
    };
  }

  if (name === "stop") {
    return {
      ok: true,
      stop: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_stop_${Date.now()}`,
        source: "gemini_live",
        type: "stop",
        args: {
          reason: normalizeShortText(args.reason, 120) || "gemini_live_stop"
        },
        reason: "gemini_live_stop"
      }
    };
  }

  return {
    ok: false,
    reason: `Unsupported Gemini Live tool: ${name || "unknown"}`
  };
}

export function summarizeGeminiAction(action = {}) {
  return {
    type: action.type ?? "unknown",
    movement: action.args?.movement ?? [],
    scenario: action.args?.scenario ?? null,
    timing: action.args?.timing ?? null,
    iterateMovement: Boolean(action.args?.iterateMovement),
    reason: action.reason ?? null
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

function readMovementNames(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return [];
  }

  const values = Array.isArray(input) ? input : input ? [input] : [];
  return values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeShortText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}
