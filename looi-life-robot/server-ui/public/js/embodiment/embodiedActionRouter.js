import { PRIORITY_LEVELS } from "./priorityScheduler.js";
import { compileMovementFrames } from "./movementCatalog.js";

const ROUTED_ACTIONS = new Set(["run_sequence", "stop"]);

export class EmbodiedActionRouter {
  constructor({
    frameSequencer,
    priorityScheduler,
    lifeEngine,
    logger
  } = {}) {
    this.frameSequencer = frameSequencer;
    this.priorityScheduler = priorityScheduler;
    this.lifeEngine = lifeEngine;
    this.logger = logger;
    this.history = [];
    this.maxHistory = 50;
  }

  async routeAction(action, context = {}) {
    return this.execute(action, context);
  }

  mapActionToSequence(action = {}, context = {}) {
    const type = action.type;
    const args = action.args ?? {};

    if (!ROUTED_ACTIONS.has(type)) {
      return { ok: false, reason: "unsupported_embodied_action" };
    }

    if (type === "stop") {
      return {
        ok: true,
        sequence: buildStopSequence(args)
      };
    }

    return {
      ok: true,
      sequence: buildRunSequence(args, context, (message, level) => this.log(message, level))
    };
  }

  async execute(action, context = {}) {
    if (!this.frameSequencer) {
      return { ok: false, reason: "frame_sequencer_unavailable" };
    }

    const mapped = this.mapActionToSequence(action, context);
    if (!mapped.ok) {
      return this.record(action, {
        ok: false,
        status: "rejected",
        reason: mapped.reason
      });
    }

    const priority = priorityForAction(action, context);
    const options = {
      source: action.source ?? context.source ?? "scenario_runtime",
      priority,
      allowMotion: context.allowMotion !== false,
      allowSpeech: context.allowSpeech !== false,
      allowCamera: context.allowCamera === true,
      reason: action.reason ?? context.reason ?? action.type,
      context
    };
    const run = () => this.frameSequencer.playFrameSequence(mapped.sequence, options);

    const task = {
      type: `sequence:${mapped.sequence?.name ?? action.type}`,
      priority,
      source: options.source,
      interruptible: action.type !== "stop",
      physical: context.allowMotion !== false && action.type === "run_sequence",
      reason: options.reason ?? action.reason ?? action.type,
      interrupt: (reason) => this.frameSequencer.interrupt(reason, priority),
      run
    };
    const scheduled = this.priorityScheduler
      ? await this.priorityScheduler.submit(task)
      : { ok: true, result: await run() };
    const result = scheduled.result ?? scheduled;

    return this.record(action, {
      ok: result?.ok !== false,
      status: result?.ok === false ? "rejected" : "completed",
      sequence: result?.sequence ?? mapped.sequence?.name,
      result,
      reason: result?.reason ?? "completed"
    });
  }

  getHistory({ limit = 20 } = {}) {
    return this.history.slice(0, Math.max(1, Number(limit) || 20)).map((entry) => ({ ...entry }));
  }

  async cancelActiveSequence(reason = "sequence_cancelled") {
    if (!this.frameSequencer) {
      return { ok: false, reason: "frame_sequencer_unavailable" };
    }

    await this.frameSequencer.cancel?.(reason);
    return { ok: true, reason };
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

  return context.priority ?? PRIORITY_LEVELS.local_brain_action;
}

function buildRunSequence(args = {}, context = {}, log = () => {}) {
  const speech = normalizeSpeech({
    ...args,
    ...(args.speech && typeof args.speech === "object" && !Array.isArray(args.speech) ? args.speech : {})
  });
  const tone = normalizeTone(speech.tone);
  const expression = normalizeExpression(
    args.expression?.emotion ?? args.emotion ?? toneToExpression(tone)
  );
  const movement = compileMovementFrames(args.movement, {
    iterate: args.iterateMovement === true
  });
  const movementFrames = movement.frames.slice(0, 16);
  const timing = args.timing === "parallel" ? "parallel" : "sequence";
  const frames = [
    {
      type: "face",
      expression,
      intensity: clampNumber(args.expression?.intensity ?? args.intensity, 0, 1.5, 0.82),
      eyeDirection: "center",
      durationMs: 60
    }
  ];

  if (movement.ignored.length) {
    log(`Scenario ignored unknown movement frame group: ${movement.ignored.join(", ")}`, "warn");
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
        ...(movementFrames.length
          ? [{
              type: "composite",
              mode: "sequence",
              durationMs: 0,
              frames: movementFrames
            }]
          : [])
      ]
    });
  } else {
    if (movementFrames.length) {
      frames.push({
        type: "composite",
        mode: "sequence",
        durationMs: 0,
        frames: movementFrames
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
    name: args.scenario ? `scenario_${args.scenario}` : "scenario_sequence",
    description: "Private scenario-expanded face/body frame sequence.",
    priority: context.priority ?? PRIORITY_LEVELS.local_brain_action,
    interruptible: true,
    requiresMotion: movement.requestedMotion,
    cooldownMs: 0,
    tags: ["scenario", "private"],
    frames,
    metadata: {
      ignoredMovement: movement.ignored,
      movement: movement.names
    }
  };
}

function buildStopSequence(args = {}) {
  return {
    name: "safety_stop",
    description: "Immediate stop with safe expression.",
    priority: PRIORITY_LEVELS.emergency_stop,
    interruptible: false,
    requiresMotion: false,
    cooldownMs: 0,
    tags: ["stop", "safety"],
    frames: [
      { type: "face", expression: "scared", intensity: 1.08, eyeDirection: "center", durationMs: 40 },
      {
        type: "event",
        eventType: "emergency_stop",
        payload: { reason: args.reason ?? "scenario_stop" },
        durationMs: 30
      },
      { type: "face", expression: "attentive", intensity: 0.9, eyeDirection: "center", durationMs: 120 }
    ]
  };
}

function normalizeSpeech(value = {}) {
  return {
    text: typeof value.text === "string" ? value.text.trim().slice(0, 240) : "",
    tone: typeof value.tone === "string" ? value.tone.trim().slice(0, 40) : "soft"
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
