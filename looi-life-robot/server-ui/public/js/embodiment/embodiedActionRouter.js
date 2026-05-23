import { PRIORITY_LEVELS } from "./priorityScheduler.js";

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
    return PRIORITY_LEVELS.immediate_stop;
  }

  return context.priority ?? PRIORITY_LEVELS.local_brain_action;
}

function buildRunSequence(args = {}, context = {}, log = () => {}) {
  const frames = Array.isArray(args.frames)
    ? args.frames
    : Array.isArray(args.sequence)
      ? args.sequence
      : [];

  if (!frames.length) {
    log("Scenario run_sequence received no frames.", "warn");
  }

  return {
    name: args.name ?? (args.scenario ? `scenario_${args.scenario}` : "scenario_sequence"),
    description: "Private scenario frame sequence.",
    priority: context.priority ?? PRIORITY_LEVELS.local_brain_action,
    interruptible: args.interruptible !== false,
    requiresMotion: Boolean(args.requiresMotion),
    cooldownMs: Math.max(0, Number(args.cooldownMs) || 0),
    tags: ["scenario", "private"],
    frames,
    metadata: args.metadata && typeof args.metadata === "object" ? { ...args.metadata } : {}
  };
}

function buildStopSequence(args = {}) {
  return {
    name: "immediate_stop",
    description: "Immediate stop with safe expression.",
    priority: PRIORITY_LEVELS.immediate_stop,
    interruptible: false,
    requiresMotion: false,
    cooldownMs: 0,
    tags: ["stop"],
    frames: [
      { type: "face", expression: "attentive", intensity: 1, eyeDirection: "center", durationMs: 40 },
      {
        type: "event",
        eventType: "motion_stop",
        payload: { reason: args.reason ?? "scenario_stop" },
        durationMs: 30
      },
      { type: "face", expression: "attentive", intensity: 0.9, eyeDirection: "center", durationMs: 120 }
    ]
  };
}
