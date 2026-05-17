import { PRIORITY_LEVELS } from "./priorityScheduler.js";

const ROUTED_ACTIONS = new Set([
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
      reason: action.reason ?? action.type,
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
  return ["drive", "approach_user", "retreat", "curious_scan", "excited_wiggle"].includes(type);
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
