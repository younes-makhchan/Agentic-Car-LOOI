import { getMacro, normalizeMacroFrame, validateMacro } from "./motionMacroLibrary.js";
import { validateMotionCommand } from "../life/safetyGate.js";

export class MotionMacroSequencer {
  constructor({
    face,
    voiceOutput,
    commandQueue,
    lifeEngine,
    safetyGate,
    calibration,
    eventBus,
    logger
  } = {}) {
    this.face = face;
    this.voiceOutput = voiceOutput;
    this.commandQueue = commandQueue;
    this.lifeEngine = lifeEngine;
    this.safetyGate = safetyGate;
    this.calibration = calibration;
    this.eventBus = eventBus;
    this.logger = logger;
    this.currentMacro = null;
    this.running = false;
    this.paused = false;
    this.queue = [];
    this.history = [];
    this.activeFrame = null;
    this.interruptedBy = null;
    this.lastMacroTimes = new Map();
    this.maxHistory = 50;
    this.playToken = 0;
  }

  async playMacro(name, options = {}) {
    const macro = getMacro(name, {
      calibration: this.calibration,
      personality: this.lifeEngine?.getPersonalityProfile?.(),
      allowMotion: options.allowMotion !== false
    });

    if (!macro) {
      return this.recordResult({
        ok: false,
        macro: name,
        executed: false,
        reason: "unknown_macro"
      });
    }

    return this.playMacroObject(macro, options);
  }

  async playMacroObject(macro, options = {}) {
    const validation = validateMacro(macro);
    if (!validation.ok) {
      return this.recordResult({
        ok: false,
        macro: macro?.name ?? "unknown",
        executed: false,
        reason: validation.error
      });
    }

    const priority = Number(options.priority ?? macro.priority ?? 0);
    if (this.running && priority > Number(this.currentMacro?.priority ?? 0)) {
      this.interrupt(options.reason ?? "higher_priority_macro", priority);
    } else if (this.running) {
      return this.recordResult({
        ok: false,
        macro: macro.name,
        executed: false,
        reason: "macro_busy"
      });
    }

    const canPlay = this.canPlayMacro(macro, options);
    if (!canPlay.allowed) {
      return this.recordResult({
        ok: false,
        macro: macro.name,
        executed: false,
        reason: canPlay.reason
      });
    }

    const token = ++this.playToken;
    const context = this.buildContext(macro, options, token);
    const skippedFrames = [];
    let executedFrames = 0;
    let partial = false;
    this.running = true;
    this.interruptedBy = null;
    this.currentMacro = {
      name: macro.name,
      priority,
      source: options.source ?? "life_engine",
      interruptible: macro.interruptible !== false,
      startedAt: new Date().toISOString()
    };
    this.eventBus?.publish?.("macro_started", {
      macro: macro.name,
      source: context.source,
      priority
    }, { source: "macro_sequencer", priority: Math.min(10, Math.max(0, Math.round(priority / 10))) });

    try {
      for (const rawFrame of macro.frames) {
        if (token !== this.playToken) {
          partial = true;
          break;
        }

        const frameResult = normalizeMacroFrame(rawFrame);
        if (!frameResult.ok) {
          skippedFrames.push(`invalid:${frameResult.error}`);
          partial = true;
          continue;
        }

        this.activeFrame = frameResult.frame;
        const result = await this.applyFrame(frameResult.frame, context);

        if (result.skipped) {
          skippedFrames.push(result.reason ?? result.type ?? frameResult.frame.type);
          partial = true;
        } else {
          executedFrames += 1;
        }

        if (result.interrupted || token !== this.playToken) {
          partial = true;
          break;
        }
      }

      return this.recordResult({
        ok: true,
        macro: macro.name,
        executed: executedFrames > 0,
        partial,
        skippedFrames,
        executedFrames,
        interrupted: Boolean(this.interruptedBy),
        reason: this.interruptedBy ? `interrupted:${this.interruptedBy}` : partial ? "partial" : "completed"
      });
    } finally {
      if (token === this.playToken) {
        this.running = false;
        this.currentMacro = null;
        this.activeFrame = null;
      }
    }
  }

  stop(reason = "macro_stop") {
    this.interrupt(reason, 100);
    return this.commandQueue?.emergencyStop?.(reason);
  }

  interrupt(reason, _priority = 100) {
    this.interruptedBy = reason;
    this.playToken += 1;
    this.running = false;
    this.currentMacro = null;
    this.activeFrame = null;
    this.voiceOutput?.cancel?.(reason);
    this.eventBus?.publish?.("macro_interrupted", { reason }, { source: "macro_sequencer", priority: 9 });
  }

  isRunning() {
    return this.running;
  }

  getCurrentMacro() {
    return this.currentMacro ? { ...this.currentMacro } : null;
  }

  getHistory({ limit = 20 } = {}) {
    const max = Math.min(this.maxHistory, Math.max(1, Number(limit) || 20));
    return this.history.slice(0, max).map((entry) => ({ ...entry, skippedFrames: [...(entry.skippedFrames ?? [])] }));
  }

  canPlayMacro(macro, context = {}) {
    const now = Date.now();
    const lastAt = Number(this.lastMacroTimes.get(macro.name) || 0);

    if (Number(this.lifeEngine?.getState?.().stopRespectUntil || 0) > now && macro.name !== "scared_stop") {
      return { allowed: false, reason: "stop_cooldown_active" };
    }

    if (macro.cooldownMs && now - lastAt < macro.cooldownMs) {
      return { allowed: false, reason: "macro_cooldown_active" };
    }

    if (macro.requiresMotion && context.allowMotion === false) {
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
      case "speech":
        return this.applySpeechFrame(frame, context);
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
      this.lifeEngine?.patchState?.({ mood: frame.expression === "sad" ? "shy" : frame.expression }, "macro_face");
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

  async applySpeechFrame(frame, context) {
    if (!context.allowSpeech) {
      return { ok: true, skipped: true, type: "speech", reason: "speech_not_allowed" };
    }

    if (frame.expression) {
      this.face?.setExpression?.(frame.expression, frame.intensity ?? 0.8);
    }

    if (!this.voiceOutput?.speak) {
      await wait(frame.durationMs);
      return { ok: true, skipped: true, type: "speech", reason: "voice_output_unavailable" };
    }

    const result = await this.voiceOutput.speak({
      text: frame.text,
      tone: frame.tone,
      interrupt: frame.interrupt === true
    });

    if (!result.executed) {
      await wait(frame.durationMs);
      return { ok: true, skipped: true, type: "speech", reason: result.reason, detail: result };
    }

    return { ok: true, type: "speech", detail: result };
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

    if (frame.eventType === "emergency_stop") {
      const reason = frame.payload?.reason ?? "macro_emergency_stop";
      this.voiceOutput?.cancel?.(reason);
      await this.commandQueue?.emergencyStop?.(reason);
      this.lifeEngine?.receiveEvent?.({ type: "stop", reason });
      await wait(frame.durationMs);
      return { ok: true, type: "event", eventType: "emergency_stop" };
    }

    this.eventBus?.publish?.(frame.eventType, frame.payload ?? {}, {
      source: "macro_sequencer",
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

  setLifeEngine(lifeEngine) {
    this.lifeEngine = lifeEngine;
  }

  setSafetyGate(safetyGate) {
    this.safetyGate = safetyGate;
  }

  buildContext(macro, options, token) {
    return {
      source: options.source ?? "life_engine",
      priority: Number(options.priority ?? macro.priority ?? 0),
      allowMotion: options.allowMotion !== false,
      allowSpeech: options.allowSpeech !== false,
      allowCamera: options.allowCamera === true,
      reason: options.reason ?? macro.name,
      runtimeContext: options.context ?? {},
      token
    };
  }

  recordResult(result) {
    const entry = {
      partial: false,
      skippedFrames: [],
      executedFrames: 0,
      interrupted: false,
      timestamp: new Date().toISOString(),
      ...result
    };
    this.lastMacroTimes.set(entry.macro, Date.now());
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, this.maxHistory);
    this.eventBus?.publish?.("macro_result", entry, {
      source: "macro_sequencer",
      priority: entry.ok ? 1 : 3
    });
    this.log(`Macro ${entry.macro}: ${entry.reason}`, entry.ok ? "info" : "warn");
    return entry;
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

function wait(ms) {
  const delay = Math.max(0, Math.min(5000, Number(ms) || 0));
  return delay > 0 ? new Promise((resolve) => globalThis.setTimeout(resolve, delay)) : Promise.resolve();
}
