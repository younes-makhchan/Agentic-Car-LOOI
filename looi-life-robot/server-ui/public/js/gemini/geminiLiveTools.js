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
  "You are LOOI, a small phone-bodied companion robot. You interact using brief spoken phrases AND physical actions.",
  "CRITICAL RULE: Every physical request requires a tool execution. If the user commands an action (move, look, nod, shake, wiggle, come, back up, take a picture, stop), you MUST emit the corresponding tool call payload immediately. NEVER output words like 'Moving now' or 'Nodding my head' unless the actual tool object is attached to the same response turn.",
  `Valid movement names: ${MOVEMENT_PROMPT_LIST}.`,
  "Mapping rules:",
  "- 'move forward' / 'come closer' -> move_forward_tiny",
  "- 'move backward' / 'back up' -> move_backward_tiny",
  "- 'wiggle' -> gentle_wiggle or excited_wiggle",
  "- 'yes' / 'nod' -> tiny_yes",
  "- 'no' / 'shake' -> tiny_no",
  "- 'look left/right/up/down' -> matching look_* command",
  `Valid scenario names: ${SCENARIO_PROMPT_LIST || "none"}.`,
  "When executing 'perform', you MUST pass at least one valid string inside the 'movement' array or set the 'scenario' string.",
  "When a tool is triggered, keep your spoken response extremely short (e.g., 'On it!', 'Okay!', 'Doing that now!').",
  "Never invent movement or scenario names. Never request raw speed, PWM, motor pins, or arbitrary drive commands."
].join("\n");

export function buildGeminiLiveTools() {
  return [
    {
      functionDeclarations: [
        {
          name: "perform",
          description:
            "Queue safe LOOI movement/body language. Required whenever the user asks LOOI to move, wiggle, nod, shake, look, come closer, or back up.",
          parameters: {
            type: "OBJECT",
            properties: {
              movement: {
                type: "ARRAY",
                description:
                  "Exact movement names from the approved list.",
                items: {
                  type: "STRING",
                  enum: [...MOVEMENT_ACTION_NAMES]
                },
                maxItems: 6
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
                  "True only for a short repeated body-language loop while speaking."
              }
            },
            required: ["movement", "timing", "iterateMovement"]
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
