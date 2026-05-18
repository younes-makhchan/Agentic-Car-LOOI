import { PRIORITY_LEVELS } from "./priorityScheduler.js";
import { normalizeBodyLanguage } from "./bodyLanguageNormalizer.js";

const ROUTED_ACTIONS = new Set([
  "perform",
  "express",
  "speak",
  "drive",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember"
]);

export class EmbodiedActionRouter {
  constructor({
    macroSequencer,
    priorityScheduler,
    lifeEngine,
    logger
  } = {}) {
    this.macroSequencer = macroSequencer;
    this.priorityScheduler = priorityScheduler;
    this.lifeEngine = lifeEngine;
    this.logger = logger;
    this.history = [];
    this.maxHistory = 50;
  }

  async routeAction(action, context = {}) {
    return this.execute(action, context);
  }

  mapActionToMacro(action = {}, context = {}) {
    const type = action.type;
    const args = action.args ?? {};

    if (!ROUTED_ACTIONS.has(type)) {
      return { ok: false, reason: "unsupported_embodied_action" };
    }

    switch (type) {
      case "perform":
        return {
          ok: true,
          macroObject: buildPerformMacro(args, context, (message, level) => this.log(message, level))
        };
      case "express":
        return {
          ok: true,
          macroObject: {
            name: `express_${args.emotion ?? "neutral"}`,
            description: "Single expressive face frame.",
            priority: context.priority ?? PRIORITY_LEVELS.decorative_face_only,
            interruptible: true,
            requiresMotion: false,
            cooldownMs: 0,
            tags: ["express"],
            frames: [
              {
                type: "face",
                expression: args.emotion ?? "neutral",
                intensity: args.intensity ?? 0.8,
                eyeDirection: args.eyeDirection ?? "center",
                durationMs: args.durationMs ?? 100
              }
            ]
          }
        };
      case "speak":
        return {
          ok: true,
          macroObject: {
            name: "speak_synced",
            description: "Speech with synchronized face state.",
            priority: context.priority ?? PRIORITY_LEVELS.local_brain_action,
            interruptible: true,
            requiresMotion: false,
            cooldownMs: 0,
            tags: ["speech"],
            frames: [
              {
                type: "speech",
                text: args.text,
                tone: args.tone ?? "soft",
                expression: toneToExpression(args.tone),
                durationMs: 100
              }
            ]
          }
        };
      case "approach_user":
        return { ok: true, macroName: args.style === "happy" || context.classification === "greeting" ? "happy_approach" : "gentle_approach" };
      case "retreat":
        return { ok: true, macroName: "shy_retreat" };
      case "curious_scan":
        return { ok: true, macroName: context.allowMotion === false ? "look_around_only" : "curious_scan" };
      case "excited_wiggle":
        return { ok: true, macroName: "excited_wiggle" };
      case "stop":
        return {
          ok: true,
          macroObject: {
            name: "scared_stop",
            description: "Immediate stop with scared expression.",
            priority: 100,
            interruptible: false,
            requiresMotion: false,
            cooldownMs: 0,
            tags: ["stop", "safety"],
            frames: [
              { type: "face", expression: "scared", intensity: 1.08, eyeDirection: "center", durationMs: 40 },
              {
                type: "event",
                eventType: "emergency_stop",
                payload: { reason: args.reason ?? "embodied_stop" },
                durationMs: 30
              },
              { type: "face", expression: "attentive", intensity: 0.9, eyeDirection: "center", durationMs: 120 }
            ]
          }
        };
      case "observe_scene":
        return { ok: true, macroName: "thinking_pose" };
      case "remember":
        return { ok: true, macroName: "tiny_yes" };
      case "drive":
        if (args.style && ["happy", "curious", "shy", "gentle"].includes(args.style)) {
          return {
            ok: true,
            macroObject: buildDriveMacro(action)
          };
        }
        return { ok: false, reason: "direct_drive_prefers_tool_executor" };
      default:
        return { ok: false, reason: "unknown_action" };
    }
  }

  async execute(action, context = {}) {
    if (!this.macroSequencer) {
      return { ok: false, reason: "macro_sequencer_unavailable" };
    }

    const mapped = this.mapActionToMacro(action, context);
    if (!mapped.ok) {
      return this.record(action, {
        ok: false,
        status: "rejected",
        reason: mapped.reason
      });
    }

    const priority = priorityForAction(action, context);
    const options = {
      source: action.source ?? context.source ?? "local_brain",
      priority,
      allowMotion: context.allowMotion !== false,
      allowSpeech: context.allowSpeech !== false,
      allowCamera: context.allowCamera === true,
      reason: action.reason ?? context.reason ?? action.type,
      context
    };
    const run = () => mapped.macroObject
      ? this.macroSequencer.playMacroObject(mapped.macroObject, options)
      : this.macroSequencer.playMacro(mapped.macroName, options);

    const task = {
      type: `macro:${mapped.macroName ?? mapped.macroObject?.name ?? action.type}`,
      priority,
      source: options.source,
      interruptible: action.type !== "stop",
      physical: context.allowMotion !== false && isPhysicalAction(action.type),
      reason: options.reason ?? action.reason ?? action.type,
      interrupt: (reason) => this.macroSequencer.interrupt(reason, priority),
      run
    };
    const scheduled = this.priorityScheduler
      ? await this.priorityScheduler.submit(task)
      : { ok: true, result: await run() };
    const result = scheduled.result ?? scheduled;

    return this.record(action, {
      ok: result?.ok !== false,
      status: result?.ok === false ? "rejected" : "completed",
      macro: result?.macro ?? mapped.macroName ?? mapped.macroObject?.name,
      result,
      reason: result?.reason ?? "completed"
    });
  }

  getHistory({ limit = 20 } = {}) {
    return this.history.slice(0, Math.max(1, Number(limit) || 20)).map((entry) => ({ ...entry }));
  }

  record(action, result) {
    const entry = {
      actionType: action?.type,
      actionId: action?.id ?? null,
      timestamp: new Date().toISOString(),
      ...result
    };
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, this.maxHistory);
    return entry;
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const method = typeof this.logger[level] === "function" ? level : "log";
    this.logger[method](message);
  }
}

function priorityForAction(action, context) {
  if (action.type === "stop") {
    return PRIORITY_LEVELS.emergency_stop;
  }

  if (context.autonomous) {
    return PRIORITY_LEVELS.autonomous_life_event;
  }

  return context.priority ?? PRIORITY_LEVELS.local_brain_action;
}

function isPhysicalAction(type) {
  return ["perform", "drive", "approach_user", "retreat", "curious_scan", "excited_wiggle"].includes(type);
}

function buildPerformMacro(args = {}, context = {}, log = () => {}) {
  const speech = normalizeSpeech({
    ...args,
    ...(args.speech && typeof args.speech === "object" && !Array.isArray(args.speech) ? args.speech : {})
  });
  const tone = normalizeTone(speech.tone);
  const expression = normalizeExpression(
    args.expression?.emotion ?? args.emotion ?? toneToExpression(tone)
  );
  const bodyLanguage = normalizeBodyLanguage(args.bodyLanguage ?? [], {
    iterate: args.iterateBodyLanguage === true
  });
  const movementFrames = movementToFrames(args.movement ?? {}, context);
  const bodyFrames = [...bodyLanguage.frames, ...movementFrames].slice(0, 16);
  const timing = args.timing === "sequence" ? "sequence" : "parallel";
  const frames = [
    {
      type: "face",
      expression,
      intensity: clampNumber(args.expression?.intensity ?? args.intensity, 0, 1.5, 0.82),
      eyeDirection: "center",
      durationMs: 60
    }
  ];

  if (bodyLanguage.ignored.length) {
    log(`Perform ignored unknown bodyLanguage: ${bodyLanguage.ignored.join(", ")}`, "warn");
  }

  if (speech.text && timing === "parallel") {
    frames.push({
      type: "composite",
      mode: "parallel",
      durationMs: 0,
      frames: [
        {
          type: "speech",
          text: speech.text,
          tone,
          expression,
          durationMs: fallbackSpeechDurationMs(speech.text)
        },
        ...(bodyFrames.length
          ? [{
              type: "composite",
              mode: "sequence",
              durationMs: 0,
              frames: bodyFrames
            }]
          : [])
      ]
    });
  } else {
    if (bodyFrames.length) {
      frames.push({
        type: "composite",
        mode: "sequence",
        durationMs: 0,
        frames: bodyFrames
      });
    }

    if (speech.text) {
      frames.push({
        type: "speech",
        text: speech.text,
        tone,
        expression,
        durationMs: fallbackSpeechDurationMs(speech.text)
      });
    }
  }

  frames.push({
    type: "face",
    expression: "attentive",
    intensity: 0.68,
    eyeDirection: "center",
    durationMs: 90,
    allowSkip: true
  });

  return {
    name: "perform_embodied",
    description: "LLM-selected speech, expression, and safe body-language choreography.",
    priority: context.priority ?? PRIORITY_LEVELS.local_brain_action,
    interruptible: true,
    requiresMotion: false,
    cooldownMs: 0,
    tags: ["perform", "speech", "body-language"],
    frames,
    metadata: {
      ignoredBodyLanguage: bodyLanguage.ignored,
      normalizedBodyLanguage: bodyLanguage.entries.map((entry) => entry.name)
    }
  };
}

function normalizeSpeech(value = {}) {
  return {
    text: typeof value.text === "string" ? value.text.trim().slice(0, 240) : "",
    tone: typeof value.tone === "string" ? value.tone.trim().slice(0, 40) : "soft"
  };
}

function movementToFrames(movement = {}, context = {}) {
  const intent = String(movement.intent ?? movement.action ?? "none").trim().toLowerCase();
  const style = String(movement.style ?? "gentle").trim().toLowerCase();

  switch (intent) {
    case "approach_user":
    case "approach":
      return [
        frameFace(style === "happy" ? "happy" : "attentive", 0.82, "center", 60),
        frameMotion(0.12, style === "happy" ? 0.015 : 0, 340, "perform_approach_user")
      ];
    case "retreat":
    case "give_space":
    case "give me space":
      return [
        frameFace("shy", 0.78, "down", 70),
        frameMotion(-0.11, 0.01, 300, "perform_retreat")
      ];
    case "curious_scan":
    case "scan":
    case "look_around":
    case "look around":
      return [
        frameFace("curious", 0.84, "left", 90),
        frameMotion(0, -0.08, 130, "perform_scan_left"),
        frameFace("curious", 0.84, "right", 90),
        frameMotion(0, 0.08, 130, "perform_scan_right")
      ];
    case "excited_wiggle":
    case "wiggle":
      return [
        frameFace("happy", 0.9, "center", 50),
        frameMotion(0, -0.08, 105, "perform_excited_wiggle_left"),
        frameMotion(0, 0.08, 105, "perform_excited_wiggle_right")
      ];
    case "drive":
    case "move":
      return directionToTinyDriveFrames(movement.direction, context);
    case "none":
    case "":
      return [];
    default:
      return [];
  }
}

function directionToTinyDriveFrames(direction) {
  const value = String(direction ?? "").trim().toLowerCase();
  if (["forward", "front", "ahead"].includes(value)) {
    return [frameMotion(0.06, 0, 140, "perform_tiny_drive_forward")];
  }

  if (["back", "backward", "behind"].includes(value)) {
    return [frameMotion(-0.06, 0, 140, "perform_tiny_drive_back")];
  }

  if (value === "left") {
    return [frameMotion(0, -0.07, 130, "perform_tiny_drive_left")];
  }

  if (value === "right") {
    return [frameMotion(0, 0.07, 130, "perform_tiny_drive_right")];
  }

  return [];
}

function frameFace(expression, intensity, eyeDirection, durationMs) {
  return {
    type: "face",
    expression,
    intensity,
    eyeDirection,
    durationMs,
    allowSkip: true
  };
}

function frameMotion(linear, angular, durationMs, label) {
  return {
    type: "motion",
    linear,
    angular,
    durationMs,
    rampMs: 110,
    label,
    allowSkip: true
  };
}

function normalizeExpression(expression) {
  return ["neutral", "happy", "curious", "attentive", "sleepy", "scared", "shy", "sad"].includes(expression)
    ? expression
    : "attentive";
}

function normalizeTone(tone) {
  return ["soft", "happy", "curious", "serious", "shy", "playful"].includes(tone) ? tone : "soft";
}

function fallbackSpeechDurationMs(text) {
  return Math.min(3000, Math.max(400, 450 + String(text ?? "").length * 45));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function toneToExpression(tone) {
  return {
    happy: "happy",
    playful: "happy",
    curious: "curious",
    shy: "shy",
    serious: "attentive",
    soft: "attentive"
  }[tone] ?? "attentive";
}

function buildDriveMacro(action) {
  const args = action.args ?? {};
  return {
    name: `styled_drive_${args.style}`,
    description: "Strictly bounded styled drive frame.",
    priority: PRIORITY_LEVELS.local_brain_action,
    interruptible: true,
    requiresMotion: true,
    cooldownMs: 800,
    tags: ["drive", args.style],
    frames: [
      {
        type: "face",
        expression: args.style === "shy" ? "shy" : args.style === "happy" ? "happy" : "attentive",
        intensity: 0.72,
        eyeDirection: "center",
        durationMs: 80
      },
      {
        type: "motion",
        linear: args.linear,
        angular: args.angular,
        durationMs: args.duration_ms ?? args.durationMs,
        rampMs: args.ramp_ms ?? args.rampMs ?? 160,
        label: `macro_styled_drive_${args.style}`
      }
    ]
  };
}
