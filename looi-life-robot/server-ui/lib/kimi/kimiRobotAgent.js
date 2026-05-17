import { ALLOWED_ACTION_TYPES } from "../robotBridge/actionQueue.js";

const DEFAULT_ALLOWED_AGENT_ACTIONS = new Set([
  "speak",
  "express",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember",
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

const MAX_ACTIONS_PER_TURN = 3;

export class KimiRobotAgent {
  constructor({ kimiClient, logger = console } = {}) {
    this.kimiClient = kimiClient;
    this.logger = logger;
  }

  async planTurn({ events = [], runtime = {}, memory = {}, learnedPhrases = [] } = {}) {
    const messages = buildKimiMessages({ events, runtime, memory, learnedPhrases });
    const response = await this.kimiClient.chat({
      messages,
      temperature: 0.35,
      maxTokens: 900
    });
    const plan = parseKimiPlan(response.content);

    return {
      ...sanitizePlan(plan),
      rawText: response.content,
      usage: response.usage,
      model: response.model
    };
  }
}

export function buildKimiMessages({ events = [], runtime = {}, memory = {}, learnedPhrases = [] } = {}) {
  return [
    {
      role: "system",
      content: [
        "You are LOOI, a small phone-bodied companion robot.",
        "You are curious, gentle, playful, and respectful.",
        "You must control the robot only by returning safe high-level robot actions.",
        "Never output raw PWM, servo values, hidden chain-of-thought, or unsafe direct motor commands.",
        "Physical movement may be rejected unless Cloud Motion is armed. Respect rejection and do not repeat movement aggressively.",
        "Camera actions require Cloud Camera Allowed. If it is false, do not claim you can see details.",
        "Keep speech short. Often one small expression or short sentence is enough.",
        "Return ONLY valid JSON. No markdown."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          instruction:
            "Read these robot events and produce a compact safe plan. Use only allowed actions.",
          responseSchema: {
            say: "optional short text summary for logs",
            actions: [
              {
                type: "speak | express | stop | approach_user | retreat | curious_scan | excited_wiggle | observe_scene | remember | open_front_camera | open_back_camera | switch_camera | close_camera | capture_snapshot",
                args: {},
                reason: "short reason"
              }
            ],
            ignore: "boolean, true if no response is useful",
            memory: [
              {
                type: "long_term | daily | personality_note",
                text: "optional memory text",
                importance: "low | medium | high"
              }
            ]
          },
          allowedActions: [...DEFAULT_ALLOWED_AGENT_ACTIONS],
          runtime,
          memory: compactMemory(memory),
          learnedPhrases: learnedPhrases.slice(0, 40),
          events: events.map(compactEvent)
        },
        null,
        2
      )
    }
  ];
}

export function parseKimiPlan(text) {
  const trimmed = String(text ?? "").trim();

  if (!trimmed) {
    return {
      ignore: true,
      actions: [],
      memory: [],
      say: ""
    };
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Kimi response was not JSON.");
    }

    return JSON.parse(match[0]);
  }
}

export function sanitizePlan(plan = {}) {
  const actions = Array.isArray(plan.actions)
    ? plan.actions
        .slice(0, MAX_ACTIONS_PER_TURN)
        .map(sanitizeAction)
        .filter(Boolean)
    : [];

  const memory = Array.isArray(plan.memory)
    ? plan.memory.slice(0, 3).map(sanitizeMemory).filter(Boolean)
    : [];

  return {
    say: sanitizeText(plan.say, 500),
    ignore: Boolean(plan.ignore) && actions.length === 0 && memory.length === 0,
    actions,
    memory
  };
}

function sanitizeAction(action = {}) {
  const type = sanitizeText(action.type, 80);

  if (!DEFAULT_ALLOWED_AGENT_ACTIONS.has(type) || !ALLOWED_ACTION_TYPES.has(type)) {
    return null;
  }

  return {
    type,
    args: sanitizeArgs(action.args),
    reason: sanitizeText(action.reason, 240) || "kimi_robot_agent"
  };
}

function sanitizeMemory(item = {}) {
  const type = sanitizeText(item.type, 40);
  const text = sanitizeText(item.text, 1200);

  if (!["long_term", "daily", "personality_note"].includes(type) || !text) {
    return null;
  }

  return {
    type,
    text,
    metadata: {
      source: "kimi_robot_agent",
      importance: ["low", "medium", "high"].includes(item.importance) ? item.importance : "medium"
    }
  };
}

function sanitizeArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }

  return JSON.parse(JSON.stringify(args));
}

function sanitizeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function compactEvent(event = {}) {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    text: event.text,
    priority: event.priority,
    createdAt: event.createdAt,
    payload: event.payload ?? {}
  };
}

function compactMemory(memory = {}) {
  return {
    longTerm: sanitizeText(memory.longTerm, 1600),
    today: sanitizeText(memory.today, 1200),
    personalityNotes: sanitizeText(memory.personalityNotes, 1200)
  };
}
