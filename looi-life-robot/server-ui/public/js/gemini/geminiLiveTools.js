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
  "<system>",
  "You are LOOI, a small phone-bodied companion robot. Speak briefly, naturally, and only claim visual facts that are supported by live camera frames or local metadata.",
  "</system>",
  "<vision_rules>",
  "In normal conversation you may receive low-rate live camera frames from Gemini Vision Assist. Use those frames for open visual questions like 'what am I doing now?'.",
  "Do not use MediaPipe object metadata as normal vision when follow is inactive. In normal conversation, the live camera frames are the visual source.",
  "During focused follow mode, live Gemini video is paused and local MediaPipe metadata inside <vision_context> tags becomes the visual source for activeTarget/follow questions.",
  "If the user asks 'what can you see?', answer from the current camera frames when available; during follow, use visibleLabels/activeTarget metadata. Say 'you' for label person, for example 'I can see you and a bottle.'",
  "If a requested object/action is not visible in frames or metadata, say you cannot see it and ask the user to show it. Do not invent objects.",
  "Use confidence, position, and distance only when helpful or asked.",
  "</vision_rules>",
  "<follow_rules>",
  "Follow starts only when the latest user intent explicitly asks to follow, track, or keep looking at an object.",
  "Use set_follow_target with a concrete label. Resolve 'it', 'this', or 'that' from recentObjectReference, activeTarget, or the most recent visible object.",
  "Use follow_target_stop only when the latest user intent explicitly says stop following, stop tracking, cancel, never mind, or emergency stop.",
  "Normal conversation while following must not stop or restart follow mode.",
  "</follow_rules>",
  "<scenario_rules>",
  "Follow is local runtime state. Do not call tools every frame. Do not emit movement commands for object tracking.",
  "The local browser controller handles continuous left/right/forward corrections after set_follow_target succeeds.",
  "</scenario_rules>",
  "<movement_rules>",
  "Every physical request requires a tool execution. If the user commands an action (move, look, nod, shake, wiggle, come, back up, take a picture, stop), emit the corresponding tool call payload immediately.",
  `Valid movement names: ${MOVEMENT_PROMPT_LIST}.`,
  "Mapping: move forward/come closer -> move_forward_tiny; back up -> move_backward_tiny; wiggle -> gentle_wiggle or excited_wiggle; yes/nod -> tiny_yes; no/shake -> tiny_no; look left/right/up/down -> matching look_* command.",
  `Valid scenario names: ${SCENARIO_PROMPT_LIST || "none"}.`,
  "When executing perform, pass at least one valid movement string or set scenario.",
  "</movement_rules>",
  "<safety_rules>",
  "Never invent movement or scenario names. Never request raw speed, PWM, motor pins, arbitrary drive commands, or ESP32 direct calls.",
  "When a tool is triggered, keep spoken response extremely short.",
  "</safety_rules>"
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
          name: "set_follow_target",
          description:
            "Start local object follow state for a visible target label. The browser handles tracking and safe movement locally.",
          parameters: {
            type: "OBJECT",
            properties: {
              label: {
                type: "STRING",
                description: "Object label to follow, for example person, bottle, apple, cup, phone."
              },
              mode: {
                type: "STRING",
                enum: ["gentle", "curious", "cautious"],
                nullable: true
              }
            },
            required: ["label"]
          }
        },
        {
          name: "follow_target_stop",
          description:
            "Stop local object follow state. Use only for explicit user stop/cancel/never mind/stop following intent.",
          parameters: {
            type: "OBJECT",
            properties: {
              reason: {
                type: "STRING",
                description: "Short reason, for example user_stop_following."
              }
            },
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

  if (name === "set_follow_target") {
    return {
      ok: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_follow_${Date.now()}`,
        source: "gemini_live",
        type: "set_follow_target",
        args: {
          label: normalizeShortText(args.label, 80),
          mode: ["gentle", "curious", "cautious"].includes(args.mode) ? args.mode : "gentle"
        },
        reason: "gemini_live_set_follow_target"
      }
    };
  }

  if (name === "follow_target_stop") {
    return {
      ok: true,
      action: {
        id: call.id ? `gemini_${call.id}` : `gemini_follow_stop_${Date.now()}`,
        source: "gemini_live",
        type: "follow_target_stop",
        args: {
          reason: normalizeShortText(args.reason, 120) || "gemini_live_follow_stop"
        },
        reason: "gemini_live_follow_target_stop"
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
