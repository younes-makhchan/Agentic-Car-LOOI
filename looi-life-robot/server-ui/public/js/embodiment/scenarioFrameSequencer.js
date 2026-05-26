import { clampNumber, stopCommandQueueMotion, waitMs } from "../core/runtimeUtils.js";
import { validateMotionCommand } from "../life/safetyGate.js";

const SAFE_LINEAR = 0.22;
const SAFE_ANGULAR = 0.22;
const SAFE_DURATION_MS = 700;
const DEFAULT_RAMP_MS = 160;

export class ScenarioFrameSequencer {
  constructor({
    face,
    commandQueue,
    cameraInput,
    lifeEngine,
    safetyGate,
    calibration,
    eventBus,
    logger
  } = {}) {
    this.face = face;
    this.commandQueue = commandQueue;
    this.cameraInput = cameraInput;
    this.lifeEngine = lifeEngine;
    this.safetyGate = safetyGate;
    this.calibration = calibration;
    this.eventBus = eventBus;
    this.logger = logger;
    this.currentSequence = null;
    this.running = false;
    this.history = [];
    this.activeFrame = null;
    this.interruptedBy = null;
    this.lastSequenceTimes = new Map();
    this.maxHistory = 50;
    this.playToken = 0;
  }

  async playFrameSequence(sequence, options = {}) {
    const validation = validateFrameSequence(sequence);
    if (!validation.ok) {
      return this.recordResult({
        ok: false,
        sequence: sequence?.name ?? "unknown",
        executed: false,
        reason: validation.error
      });
    }

    const priority = Number(options.priority ?? sequence.priority ?? 0);
    if (this.running && priority > Number(this.currentSequence?.priority ?? 0)) {
      this.interrupt(options.reason ?? "higher_priority_sequence", priority);
    } else if (this.running) {
      return this.recordResult({
        ok: false,
        sequence: sequence.name,
        executed: false,
        reason: "sequence_busy"
      });
    }

    const canPlay = this.canPlaySequence(sequence, options);
    if (!canPlay.allowed) {
      return this.recordResult({
        ok: false,
        sequence: sequence.name,
        executed: false,
        reason: canPlay.reason
      });
    }

    const token = ++this.playToken;
    const context = this.buildContext(sequence, options, token);
    const skippedFrames = [];
    const details = [];
    let executedFrames = 0;
    let partial = false;
    let failedReason = "";

    this.running = true;
    this.interruptedBy = null;
    this.currentSequence = {
      name: sequence.name,
      priority,
      source: options.source ?? "scenario_runtime",
      interruptible: sequence.interruptible !== false,
      startedAt: new Date().toISOString()
    };
    this.eventBus?.publish?.("sequence_started", {
      sequence: sequence.name,
      source: context.source,
      priority
    }, { source: "scenario_frame_sequencer", priority: Math.min(10, Math.max(0, Math.round(priority / 10))) });

    try {
      for (const rawFrame of sequence.frames) {
        if (token !== this.playToken) {
          partial = true;
          break;
        }

        const frameResult = normalizeFrame(rawFrame);
        if (!frameResult.ok) {
          skippedFrames.push(`invalid:${frameResult.error}`);
          partial = true;
          continue;
        }

        this.activeFrame = frameResult.frame;
        const result = await this.applyFrame(frameResult.frame, context);

        if (result.detail) {
          details.push({
            type: result.type ?? frameResult.frame.type,
            action: result.action ?? frameResult.frame.action?.name ?? null,
            detail: result.detail
          });
        }

        if (result.ok === false || result.failed) {
          failedReason = result.reason ?? result.type ?? frameResult.frame.type;
          partial = true;
          break;
        }

        if (Array.isArray(result.skippedFrames) && result.skippedFrames.length) {
          skippedFrames.push(...result.skippedFrames);
          partial = true;
        }

        if (result.partial) {
          partial = true;
        }

        if (result.skipped) {
          skippedFrames.push(result.reason ?? result.type ?? frameResult.frame.type);
          partial = true;
        } else {
          executedFrames += Number(result.executedFrames ?? 1);
        }

        if (result.interrupted || token !== this.playToken) {
          partial = true;
          break;
        }
      }

      return this.recordResult({
        ok: !failedReason,
        sequence: sequence.name,
        executed: executedFrames > 0,
        partial,
        skippedFrames,
        details,
        executedFrames,
        interrupted: Boolean(this.interruptedBy),
        reason: failedReason || (this.interruptedBy ? `interrupted:${this.interruptedBy}` : partial ? "partial" : "completed")
      });
    } finally {
      if (token === this.playToken) {
        this.running = false;
        this.currentSequence = null;
        this.activeFrame = null;
      }
    }
  }

  stop(reason = "sequence_stop") {
    this.interrupt(reason, 100);
    return stopCommandQueueMotion(this.commandQueue, reason);
  }

  cancel(reason = "sequence_cancelled") {
    this.interrupt(reason, 80);
    return stopCommandQueueMotion(this.commandQueue, reason);
  }

  interrupt(reason, _priority = 100) {
    this.interruptedBy = reason;
    this.playToken += 1;
    this.running = false;
    this.currentSequence = null;
    this.activeFrame = null;
    this.eventBus?.publish?.("sequence_interrupted", { reason }, { source: "scenario_frame_sequencer", priority: 9 });
  }

  isRunning() {
    return this.running;
  }

  getCurrentSequence() {
    return this.currentSequence ? { ...this.currentSequence } : null;
  }

  getHistory({ limit = 20 } = {}) {
    const max = Math.min(this.maxHistory, Math.max(1, Number(limit) || 20));
    return this.history.slice(0, max).map((entry) => ({ ...entry, skippedFrames: [...(entry.skippedFrames ?? [])] }));
  }

  canPlaySequence(sequence, context = {}) {
    const now = Date.now();
    const lastAt = Number(this.lastSequenceTimes.get(sequence.name) || 0);

    if (sequence.cooldownMs && now - lastAt < sequence.cooldownMs) {
      return { allowed: false, reason: "sequence_cooldown_active" };
    }

    if (sequence.requiresMotion && context.allowMotion === false) {
      return { allowed: true, partial: true, reason: "motion_not_allowed" };
    }

    return { allowed: true, reason: "ok" };
  }

  async applyFrame(frame, context) {
    if (context.token !== this.playToken) {
      return { interrupted: true, type: frame.type, reason: "interrupted" };
    }

    switch (frame.type) {
      case "face":
        return this.applyFaceFrame(frame);
      case "motion":
        return this.applyMotionFrame(frame, context);
      case "action":
        return this.applyActionFrame(frame, context);
      case "composite":
        return this.applyCompositeFrame(frame, context);
      case "event":
        return this.applyEventFrame(frame, context);
      case "pause":
      default:
        return this.applyPauseFrame(frame, context);
    }
  }

  async applyFaceFrame(frame) {
    if (frame.expression) {
      this.face?.setExpression?.(frame.expression, frame.intensity ?? 0.8);
      this.lifeEngine?.patchState?.({ mood: frame.expression === "sad" ? "shy" : frame.expression }, "sequence_face");
    }

    if (frame.eyeDirection) {
      this.face?.setEyeDirection?.(frame.eyeDirection);
    }

    if (typeof frame.speaking === "boolean") {
      this.face?.setSpeaking?.(frame.speaking);
      this.lifeEngine?.setSpeaking?.(frame.speaking);
    }

    await wait(frame.durationMs);
    return { ok: true, type: "face" };
  }

  async applyMotionFrame(frame, context) {
    if (!context.allowMotion) {
      return { ok: true, skipped: true, type: "motion", reason: "motion_not_allowed" };
    }

    const state = this.lifeEngine?.getState?.() ?? {};
    const validator = this.safetyGate?.validateMotionCommand ?? validateMotionCommand;
    const validation = validator({
      linear: frame.linear,
      angular: frame.angular,
      durationMs: frame.durationMs,
      rampMs: frame.rampMs,
      label: frame.label
    }, state, {
      calibration: this.calibration,
      maxSpeed: this.calibration?.getSettings?.().maxSpeed
    });

    if (!validation.allowed) {
      return { ok: true, skipped: true, type: "motion", reason: validation.reason, detail: validation };
    }

    if (!this.commandQueue?.enqueueMotion) {
      return { ok: true, skipped: true, type: "motion", reason: "command_queue_unavailable" };
    }

    try {
      await this.commandQueue.enqueueMotion(validation.command);
      return { ok: true, type: "motion", detail: validation };
    } catch (error) {
      return { ok: true, skipped: true, type: "motion", reason: error.message };
    }
  }

  async applyActionFrame(frame, context) {
    if (typeof frame.action !== "function") {
      return { ok: false, type: "action", reason: "action_function_required" };
    }

    const actionName = frame.action.name || "anonymousScenarioAction";
    try {
      const result = await frame.action(this.buildActionContext(context), frame.args ?? {});
      if (result && typeof result === "object") {
        return {
          ok: result.ok !== false,
          failed: result.failed === true,
          skipped: result.skipped === true,
          type: "action",
          action: actionName,
          reason: result.reason,
          executedFrames: Number.isFinite(Number(result.executedFrames)) ? Number(result.executedFrames) : 1,
          detail: result.detail ?? null
        };
      }

      return { ok: true, type: "action", action: actionName };
    } catch (error) {
      return {
        ok: false,
        type: "action",
        action: actionName,
        reason: error.message
      };
    }
  }

  async applyCompositeFrame(frame, context) {
    const children = Array.isArray(frame.frames) ? frame.frames : [];
    if (children.length === 0) {
      return { ok: true, skipped: true, type: "composite", reason: "composite_empty" };
    }

    const runChild = async (child) => {
      const normalized = normalizeFrame(child);
      if (!normalized.ok) {
        return { ok: true, skipped: true, type: "composite_child", reason: normalized.error };
      }
      return this.applyFrame(normalized.frame, context);
    };

    const results = [];

    if (frame.mode === "parallel") {
      results.push(...(await Promise.all(children.map((child) => runChild(child)))));
    } else {
      for (const child of children) {
        const result = await runChild(child);
        results.push(result);
        if (result.interrupted || context.token !== this.playToken) {
          break;
        }
      }
    }

    const skippedFrames = results
      .filter((result) => result.skipped || result.partial || result.skippedFrames?.length)
      .flatMap((result) => result.skippedFrames?.length
        ? result.skippedFrames
        : [result.reason ?? result.type ?? "composite_child_skipped"]);
    const interrupted = results.some((result) => result.interrupted) || context.token !== this.playToken;
    const executedFrames = results.reduce((total, result) => {
      if (result.skipped) {
        return total;
      }
      return total + Number(result.executedFrames ?? 1);
    }, 0);

    return {
      ok: true,
      type: "composite",
      executedFrames,
      skippedFrames,
      partial: skippedFrames.length > 0,
      interrupted,
      reason: interrupted ? "interrupted" : skippedFrames.length ? "partial" : "completed"
    };
  }

  async applyPauseFrame(frame, context) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < Number(frame.durationMs || 0)) {
      if (context.token !== this.playToken) {
        return { interrupted: true, type: "pause", reason: "interrupted" };
      }
      await wait(Math.min(40, Number(frame.durationMs || 0)));
    }
    return { ok: true, type: "pause" };
  }

  async applyEventFrame(frame, _context) {
    if (frame.eventType === "blink") {
      this.face?.blink?.();
      await wait(frame.durationMs);
      return { ok: true, type: "event", eventType: "blink" };
    }

    if (frame.eventType === "motion_stop") {
      const reason = frame.payload?.reason ?? "sequence_motion_stop";
      await stopCommandQueueMotion(this.commandQueue, reason);
      this.lifeEngine?.receiveEvent?.({ type: "motion_stop", reason });
      await wait(frame.durationMs);
      return { ok: true, type: "event", eventType: "motion_stop" };
    }

    this.eventBus?.publish?.(frame.eventType, frame.payload ?? {}, {
      source: "scenario_frame_sequencer",
      priority: 1
    });
    await wait(frame.durationMs);
    return { ok: true, type: "event", eventType: frame.eventType };
  }

  setCalibration(calibration) {
    this.calibration = calibration;
  }

  setCommandQueue(commandQueue) {
    this.commandQueue = commandQueue;
  }

  setCameraInput(cameraInput) {
    this.cameraInput = cameraInput;
  }

  setLifeEngine(lifeEngine) {
    this.lifeEngine = lifeEngine;
  }

  buildContext(sequence, options, token) {
    return {
      source: options.source ?? "scenario_runtime",
      priority: Number(options.priority ?? sequence.priority ?? 0),
      allowMotion: options.allowMotion !== false,
      allowCamera: options.allowCamera === true,
      reason: options.reason ?? sequence.name,
      runtimeContext: options.context?.runtimeContext ?? options.context ?? {},
      token
    };
  }

  buildActionContext(context) {
    return {
      face: this.face,
      commandQueue: this.commandQueue,
      cameraInput: this.cameraInput,
      lifeEngine: this.lifeEngine,
      safetyGate: this.safetyGate,
      calibration: this.calibration,
      eventBus: this.eventBus,
      source: context.source,
      priority: context.priority,
      allowMotion: context.allowMotion,
      allowCamera: context.allowCamera,
      reason: context.reason,
      runtimeContext: context.runtimeContext,
      isInterrupted: () => context.token !== this.playToken,
      wait,
      log: (message, level = "info") => this.log(message, level),
      playFrames: (frames, overrides = {}) => this.playInlineFrames(frames, {
        ...context,
        ...overrides,
        token: context.token
      })
    };
  }

  async playInlineFrames(frames = [], context) {
    const results = [];
    for (const rawFrame of Array.isArray(frames) ? frames : []) {
      if (context.token !== this.playToken) {
        return { ok: false, interrupted: true, results, reason: "interrupted" };
      }

      const normalized = normalizeFrame(rawFrame);
      if (!normalized.ok) {
        results.push({ ok: false, skipped: true, reason: normalized.error });
        continue;
      }

      const result = await this.applyFrame(normalized.frame, context);
      results.push(result);
      if (result.interrupted || result.ok === false || context.token !== this.playToken) {
        break;
      }
    }

    return {
      ok: results.every((result) => result.ok !== false),
      partial: results.some((result) => result.partial || result.skipped),
      interrupted: results.some((result) => result.interrupted),
      results
    };
  }

  recordResult(result) {
    const entry = {
      partial: false,
      skippedFrames: [],
      details: [],
      executedFrames: 0,
      interrupted: false,
      timestamp: new Date().toISOString(),
      ...result
    };
    this.lastSequenceTimes.set(entry.sequence, Date.now());
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, this.maxHistory);
    this.eventBus?.publish?.("sequence_result", entry, {
      source: "scenario_frame_sequencer",
      priority: entry.ok ? 1 : 3
    });
    this.log(`Sequence ${entry.sequence}: ${entry.reason}`, entry.ok ? "info" : "warn");
    return entry;
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

export function validateFrameSequence(sequence) {
  if (!sequence || typeof sequence !== "object" || Array.isArray(sequence)) {
    return { ok: false, error: "sequence_must_be_object" };
  }

  if (typeof sequence.name !== "string" || !sequence.name.trim()) {
    return { ok: false, error: "sequence_name_required" };
  }

  if (!Array.isArray(sequence.frames) || sequence.frames.length === 0) {
    return { ok: false, error: "sequence_frames_required" };
  }

  const errors = [];
  sequence.frames.forEach((frame, index) => {
    const normalized = normalizeFrame(frame);
    if (!normalized.ok) {
      errors.push(`frame[${index}]: ${normalized.error}`);
    }
  });

  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true };
}

function wait(ms) {
  return waitMs(ms, { maxMs: 5000 });
}

function normalizeFrame(frame = {}) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return { ok: false, error: "frame_must_be_object" };
  }

  const type = ["face", "motion", "pause", "event", "composite", "action"].includes(frame.type)
    ? frame.type
    : inferFrameType(frame);
  const normalized = {
    ...frame,
    type,
    durationMs: clampRound(frame.durationMs, 0, type === "motion" ? SAFE_DURATION_MS : 3000, type === "pause" ? 100 : 0),
    allowSkip: frame.allowSkip === true
  };

  if (type === "motion") {
    normalized.linear = clampNumber(frame.linear, -SAFE_LINEAR, SAFE_LINEAR, 0);
    normalized.angular = clampNumber(frame.angular, -SAFE_ANGULAR, SAFE_ANGULAR, 0);
    normalized.rampMs = clampRound(frame.rampMs, 0, 500, DEFAULT_RAMP_MS);
    normalized.label = sanitizeLabel(frame.label ?? "sequence_motion");
    if (Math.abs(normalized.linear) < 0.001 && Math.abs(normalized.angular) < 0.001) {
      return { ok: false, error: "motion_frame_requires_motion" };
    }
  }

  if (type === "face") {
    normalized.expression = normalizeExpression(frame.expression);
    normalized.intensity = clampNumber(frame.intensity, 0, 1.5, 0.8);
    normalized.eyeDirection = normalizeEyeDirection(frame.eyeDirection);
  }

  if (type === "action") {
    normalized.action = frame.action;
    normalized.args = frame.args && typeof frame.args === "object" && !Array.isArray(frame.args)
      ? { ...frame.args }
      : {};
    if (typeof normalized.action !== "function") {
      return { ok: false, error: "action_frame_requires_function" };
    }
  }

  if (type === "event") {
    normalized.eventType = typeof frame.eventType === "string" ? frame.eventType : "sequence_event";
    normalized.payload = frame.payload && typeof frame.payload === "object" ? { ...frame.payload } : {};
  }

  if (type === "composite") {
    normalized.mode = frame.mode === "parallel" ? "parallel" : "sequence";
    normalized.frames = Array.isArray(frame.frames)
      ? frame.frames
          .slice(0, 12)
          .map((child) => normalizeFrame(child))
          .filter((child) => child.ok)
          .map((child) => child.frame)
      : [];

    if (normalized.frames.length === 0) {
      return { ok: false, error: "composite_frame_requires_children" };
    }
  }

  return { ok: true, frame: normalized };
}

function inferFrameType(frame) {
  if (Number.isFinite(Number(frame.linear)) || Number.isFinite(Number(frame.angular))) {
    return "motion";
  }

  if (frame.eventType) {
    return "event";
  }

  if (typeof frame.action === "function") {
    return "action";
  }

  if (frame.expression || frame.eyeDirection) {
    return "face";
  }

  return "pause";
}

function normalizeExpression(expression) {
  return ["neutral", "happy", "curious", "attentive", "sleepy", "scared", "shy", "sad"].includes(expression)
    ? expression
    : "neutral";
}

function normalizeEyeDirection(direction) {
  return ["left", "right", "center", "up", "down"].includes(direction) ? direction : "center";
}

function clampRound(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function sanitizeLabel(value) {
  return String(value || "sequence_motion").replace(/[^\w.-]/g, "_").slice(0, 80);
}
