import {
  IDLE_SCENARIO_GLOBAL_DEFAULTS,
  IDLE_SCENARIO_ORDER,
  getIdleScenarioById
} from "./idleScenarioCatalog.js";

const DEFAULT_IDLE_GAP_MS = Object.freeze([1000, 4000]);
const BALANCE_START_CHANCE = 0.2;
const BALANCE_CHANCE_INCREMENT = 0.2;
export const DEFAULT_IDLE_SCHEDULER_SETTINGS = Object.freeze({
  firstIdleGapMs: DEFAULT_IDLE_GAP_MS,
  silentIdleGapMs: DEFAULT_IDLE_GAP_MS,
  speakingIdleGapMs: DEFAULT_IDLE_GAP_MS,
  balanceStartChance: BALANCE_START_CHANCE,
  balanceChanceIncrement: BALANCE_CHANCE_INCREMENT
});
const RECENT_HISTORY_LIMIT = 2;
const IDLE_SOURCE = "idle_scenario_scheduler";
const MAX_RAMP_MS = 500;
const MAX_SPEED = 0.5;
const TRANSIENT_READINESS_RECHECK_MS = 1000;
const STALE_SCENARIO_BLOCK_MS = 1500;
const TRANSIENT_READINESS_REASONS = new Set([
  "scenario_running",
  "follow_running",
  "robot_not_connected",
  "command_queue_unavailable"
]);

export class IdleScenarioScheduler {
  constructor({
    commandQueue,
    robotClient,
    eventBus,
    getPolicy,
    getRuntimeStatus,
    settings,
    logger
  } = {}) {
    this.commandQueue = commandQueue;
    this.robotClient = robotClient;
    this.eventBus = eventBus;
    this.getPolicy = getPolicy;
    this.getRuntimeStatus = getRuntimeStatus;
    this.logger = logger;
    this.settings = normalizeSettings(settings);
    this.enabled = false;
    this.running = false;
    this.timer = null;
    this.playToken = 0;
    this.recentScenarioIds = [];
    this.balanceDebt = null;
    this.blockedByScenario = false;
    this.blockedByScenarioAt = 0;
    this.lastReadinessReason = "";

    this.subscribeToRuntimeEvents();
  }

  setSettings(settings = {}) {
    this.settings = normalizeSettings({
      ...this.settings,
      ...settings
    });

    if (this.balanceDebt) {
      this.balanceDebt = {
        ...this.balanceDebt,
        chance: Math.min(1, this.balanceDebt.chance)
      };
    }

    if (this.enabled && !this.running && !this.blockedByScenario) {
      this.scheduleNext("idle_settings_changed", { first: true });
    }
  }

  start(reason = "idle_start") {
    if (this.enabled) {
      this.scheduleNext("idle_restart", { first: true });
      return;
    }

    this.enabled = true;
    this.log(`Idle scenarios enabled (${reason}).`);
    this.scheduleNext(reason, { first: true });
  }

  stop(reason = "idle_stop") {
    this.enabled = false;
    this.clearTimer();
    this.cancelCurrent(reason);
    this.log(`Idle scenarios stopped (${reason}).`);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      blockedByScenario: this.blockedByScenario,
      blockedByScenarioAt: this.blockedByScenarioAt,
      lastReadinessReason: this.lastReadinessReason,
      settings: {
        ...this.settings,
        firstIdleGapMs: [...this.settings.firstIdleGapMs],
        silentIdleGapMs: [...this.settings.silentIdleGapMs],
        speakingIdleGapMs: [...this.settings.speakingIdleGapMs]
      },
      balanceDebt: this.balanceDebt ? { ...this.balanceDebt } : null,
      recentScenarioIds: [...this.recentScenarioIds]
    };
  }

  async testScenario(id) {
    const scenario = getIdleScenarioById(id);
    if (!scenario) {
      const message = `Unknown idle scenario: ${id}`;
      this.log(message, "warn");
      return { executed: false, message };
    }

    const readiness = this.getReadiness({ requireLive: false });
    if (!readiness.ready) {
      const message = `Idle scenario test skipped: ${readiness.reason}`;
      this.log(message, "warn");
      return { executed: false, message };
    }

    this.clearTimer();
    this.cancelCurrent(`idle_test:${scenario.id}`);

    const token = ++this.playToken;
    this.running = true;
    this.log(`Idle scenario test started: ${scenario.id}.`);
    this.eventBus?.publish?.("idle_scenario_started", {
      scenario: scenario.id,
      reason: "manual_test",
      selectionReason: "manual_test"
    }, { source: IDLE_SOURCE, priority: 2 });

    try {
      await this.playScenario(scenario, token, { requireEnabled: false });
      if (token !== this.playToken) {
        return { executed: false, message: `Idle scenario test interrupted: ${scenario.title}` };
      }
      this.eventBus?.publish?.("idle_scenario_completed", {
        scenario: scenario.id
      }, { source: IDLE_SOURCE, priority: 2 });
      return { executed: true, message: `Idle scenario test completed: ${scenario.title}` };
    } catch (error) {
      const message = `Idle scenario test failed (${scenario.id}): ${error.message}`;
      this.log(message, "warn");
      this.eventBus?.publish?.("idle_scenario_failed", {
        scenario: scenario.id,
        error: error.message
      }, { source: IDLE_SOURCE, priority: 3 });
      return { executed: false, message };
    } finally {
      if (token === this.playToken) {
        this.running = false;
        if (this.enabled) {
          this.scheduleNext("idle_test_completed", { first: true });
        }
      }
    }
  }

  subscribeToRuntimeEvents() {
    if (!this.eventBus?.subscribe) {
      return;
    }

    this.eventBus.subscribe("gemini_scenario_started", (event) => {
      this.handleScenarioStarted(event.payload ?? {}, "gemini_scenario_started");
    });
    this.eventBus.subscribe("gemini_scenario_finished", () => {
      this.handleScenarioFinished("gemini_scenario_finished");
    });
    this.eventBus.subscribe("sequence_started", (event) => {
      const payload = event.payload ?? {};
      if (payload.source === IDLE_SOURCE) {
        return;
      }
      this.handleScenarioStarted(payload, "sequence_started");
    });
    this.eventBus.subscribe("sequence_result", () => {
      this.handleScenarioFinished("sequence_result");
    });
    this.eventBus.subscribe("sequence_interrupted", () => {
      this.handleScenarioFinished("sequence_interrupted");
    });
    this.eventBus.subscribe("vision_follow_stopped", () => {
      this.handleScenarioFinished("vision_follow_stopped");
    });
  }

  handleScenarioStarted(payload = {}, reason = "scenario_started") {
    if (!this.enabled && !this.running) {
      return;
    }

    this.blockedByScenario = true;
    this.blockedByScenarioAt = Date.now();
    this.clearTimer();
    this.cancelCurrent(`${reason}:${payload.scenario ?? payload.sequence ?? "scenario"}`);
    this.noteReadinessReason("scenario_running");
    this.scheduleReadinessRecheck("scenario_running");
  }

  handleScenarioFinished(reason = "scenario_finished") {
    if (!this.enabled && !this.blockedByScenario) {
      return;
    }

    this.blockedByScenario = false;
    this.blockedByScenarioAt = 0;
    if (this.enabled) {
      this.scheduleNext(reason, { first: true });
    }
  }

  scheduleNext(reason = "idle_schedule", { first = false } = {}) {
    this.clearTimer();

    if (!this.enabled) {
      return;
    }

    const readiness = this.getReadiness();
    if (!readiness.ready) {
      this.noteReadinessReason(readiness.reason);
      this.log(`Idle scenarios waiting: ${readiness.reason}`, "debug");
      this.scheduleReadinessRecheck(readiness.reason);
      return;
    }

    this.noteReadinessReason("ready");
    const delayMs = this.pickDelayMs(first);
    this.log(`Idle scenario scheduled in ${Math.round(delayMs)}ms (${reason}).`, "debug");
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.runNextIdleScenario(reason);
    }, delayMs);
  }

  scheduleReadinessRecheck(reason = "not_ready") {
    if (!TRANSIENT_READINESS_REASONS.has(reason)) {
      return;
    }

    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.scheduleNext(`idle_recheck:${reason}`, { first: true });
    }, TRANSIENT_READINESS_RECHECK_MS);
  }

  async runNextIdleScenario(reason = "idle_timer") {
    if (!this.enabled || this.running) {
      return;
    }

    const readiness = this.getReadiness();
    if (!readiness.ready) {
      this.scheduleNext(`not_ready:${readiness.reason}`, { first: true });
      return;
    }

    const selection = this.selectScenario();
    if (!selection.scenario) {
      this.scheduleNext("no_idle_candidate", { first: true });
      return;
    }

    const token = ++this.playToken;
    this.running = true;
    const scenario = selection.scenario;
    this.log(`Idle scenario started: ${scenario.id} (${selection.reason}).`);
    this.eventBus?.publish?.("idle_scenario_started", {
      scenario: scenario.id,
      reason,
      selectionReason: selection.reason,
      balanceDebt: this.balanceDebt ? { ...this.balanceDebt } : null
    }, { source: IDLE_SOURCE, priority: 1 });

    try {
      await this.playScenario(scenario, token);
      if (token !== this.playToken) {
        return;
      }
      this.recordScenarioCompletion(scenario, selection);
      this.eventBus?.publish?.("idle_scenario_completed", {
        scenario: scenario.id
      }, { source: IDLE_SOURCE, priority: 1 });
    } catch (error) {
      this.log(`Idle scenario failed (${scenario.id}): ${error.message}`, "warn");
      this.eventBus?.publish?.("idle_scenario_failed", {
        scenario: scenario.id,
        error: error.message
      }, { source: IDLE_SOURCE, priority: 3 });
    } finally {
      if (token === this.playToken) {
        this.running = false;
        this.scheduleNext("idle_completed");
      }
    }
  }

  async playScenario(scenario, token, { requireEnabled = true } = {}) {
    for (let index = 0; index < scenario.steps.length; index += 1) {
      if (token !== this.playToken || (requireEnabled && !this.enabled)) {
        return;
      }

      const step = scenario.steps[index];
      const command = this.buildCommand(step, scenario, index);

      if (step.kind === "move") {
        await this.commandQueue.sendRealtimeMotion({
          linear: command.linear,
          angular: command.angular,
          durationMs: command.durationMs,
          rampMs: command.rampMs,
          label: `${scenario.id}:${index + 1}`,
          source: IDLE_SOURCE,
          log: true,
          record: true
        });
      } else if (step.kind === "stop") {
        await this.commandQueue.sendRealtimeStop?.(`${scenario.id}:step_${index + 1}`, {
          log: true,
          record: true
        });
      }

      await wait(command.durationMs + command.decayMs + command.pauseMs);
    }
  }

  buildCommand(step, scenario, index) {
    const globals = IDLE_SCENARIO_GLOBAL_DEFAULTS;
    const speedScale = Number(globals.speedScale || 1);
    const durationScale = Number(globals.durationScale || 1);
    const angularSign = Number(globals.angularSign || 1);
    const left = step.kind === "move" ? clamp(Number(step.left) * speedScale, -MAX_SPEED, MAX_SPEED) : 0;
    const right = step.kind === "move" ? clamp(Number(step.right) * speedScale, -MAX_SPEED, MAX_SPEED) : 0;
    const linear = clamp((left + right) / 2, -MAX_SPEED, MAX_SPEED);
    const angular = clamp(((right - left) / 2) * angularSign, -MAX_SPEED, MAX_SPEED);
    const durationMs = Math.round(clamp(Number(step.durationMs) * durationScale, 0, 1200));
    const pauseMs = Math.round(clamp(Number(step.pauseMs), 0, 2000));
    const requestedRampMs = Math.round(clamp(Number(globals.rampMs), 0, MAX_RAMP_MS));
    const rampMs = step.kind === "move" ? Math.min(requestedRampMs, Math.floor(durationMs / 2)) : 0;

    return {
      scenario: scenario.id,
      step: index + 1,
      linear,
      angular,
      durationMs,
      pauseMs,
      rampMs,
      decayMs: rampMs
    };
  }

  selectScenario() {
    const debt = this.balanceDebt;
    const balanceScenario = debt?.targetId ? getIdleScenarioById(debt.targetId) : null;

    if (balanceScenario && Math.random() < debt.chance) {
      return { scenario: balanceScenario, reason: `balance:${Math.round(debt.chance * 100)}%` };
    }

    if (debt) {
      this.balanceDebt = {
        ...debt,
        chance: Math.min(1, Number(debt.chance || 0) + this.settings.balanceChanceIncrement)
      };
    }

    const candidates = IDLE_SCENARIO_ORDER
      .map((id) => getIdleScenarioById(id))
      .filter(Boolean)
      .filter((scenario) => scenario.id !== debt?.sourceId)
      .filter((scenario) => !this.recentScenarioIds.includes(scenario.id));

    const fallbackCandidates = IDLE_SCENARIO_ORDER
      .map((id) => getIdleScenarioById(id))
      .filter(Boolean)
      .filter((scenario) => scenario.id !== debt?.sourceId);
    const pool = candidates.length ? candidates : fallbackCandidates;
    const scenario = pool[Math.floor(Math.random() * pool.length)] ?? null;

    return { scenario, reason: "random" };
  }

  recordScenarioCompletion(scenario, selection = {}) {
    this.recentScenarioIds.unshift(scenario.id);
    this.recentScenarioIds = this.recentScenarioIds.slice(0, RECENT_HISTORY_LIMIT);

    if (this.balanceDebt?.targetId === scenario.id) {
      this.balanceDebt = null;
      return;
    }

    if (scenario.pairWith && selection.reason !== "balance") {
      this.balanceDebt = {
        sourceId: scenario.id,
        targetId: scenario.pairWith,
        chance: this.settings.balanceStartChance
      };
    }
  }

  pickDelayMs(first = false) {
    if (first) {
      return randomBetween(...this.settings.firstIdleGapMs);
    }

    const status = this.getRuntimeStatus?.() ?? {};
    return status.geminiSpeaking
      ? randomBetween(...this.settings.speakingIdleGapMs)
      : randomBetween(...this.settings.silentIdleGapMs);
  }

  getReadiness({ requireLive = true } = {}) {
    const status = this.getRuntimeStatus?.() ?? {};
    const policy = this.getPolicy?.() ?? {};

    if (this.blockedByScenario) {
      if (status.scenarioRunning || Date.now() - this.blockedByScenarioAt <= STALE_SCENARIO_BLOCK_MS) {
        return { ready: false, reason: "scenario_running" };
      }

      this.blockedByScenario = false;
      this.blockedByScenarioAt = 0;
      this.log("Idle scenario block cleared after stale scenario state.", "warn");
    }
    if (status.scenarioRunning) {
      return { ready: false, reason: "scenario_running" };
    }
    if (status.followRunning) {
      return { ready: false, reason: "follow_running" };
    }
    if (requireLive && !status.brainLive) {
      return { ready: false, reason: "looi_not_live" };
    }
    if (status.idleMotionEnabled === false) {
      return { ready: false, reason: "idle_motion_disabled" };
    }
    if (!policy.localMotionArmed) {
      return { ready: false, reason: "motion_disarmed" };
    }
    if (!this.robotClient?.isConnected?.()) {
      return { ready: false, reason: "robot_not_connected" };
    }
    if (!this.commandQueue?.sendRealtimeMotion) {
      return { ready: false, reason: "command_queue_unavailable" };
    }

    return { ready: true, reason: "ready" };
  }

  noteReadinessReason(reason = "") {
    if (!reason || reason === this.lastReadinessReason) {
      return;
    }

    this.lastReadinessReason = reason;
    if (reason !== "ready") {
      console.info?.(`[LOOI] IDLE WAIT ${reason}`);
    } else {
      console.info?.("[LOOI] IDLE READY");
    }
  }

  cancelCurrent(reason = "idle_cancelled") {
    const wasRunning = this.running;
    this.playToken += 1;
    this.running = false;
    if (wasRunning && this.robotClient?.isConnected?.() && this.commandQueue?.sendRealtimeStop) {
      this.commandQueue.sendRealtimeStop(reason, { log: true, record: true }).catch((error) => {
        this.log(`Idle stop failed (${reason}): ${error.message}`, "warn");
      });
    }
  }

  clearTimer() {
    if (this.timer) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`[idle] ${message}`, level);
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function randomBetween(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    firstIdleGapMs: normalizeMsRange(source.firstIdleGapMs, DEFAULT_IDLE_SCHEDULER_SETTINGS.firstIdleGapMs),
    silentIdleGapMs: normalizeMsRange(source.silentIdleGapMs, DEFAULT_IDLE_SCHEDULER_SETTINGS.silentIdleGapMs),
    speakingIdleGapMs: normalizeMsRange(source.speakingIdleGapMs, DEFAULT_IDLE_SCHEDULER_SETTINGS.speakingIdleGapMs),
    balanceStartChance: normalizeNumber(
      source.balanceStartChance,
      0,
      1,
      DEFAULT_IDLE_SCHEDULER_SETTINGS.balanceStartChance
    ),
    balanceChanceIncrement: normalizeNumber(
      source.balanceChanceIncrement,
      0,
      1,
      DEFAULT_IDLE_SCHEDULER_SETTINGS.balanceChanceIncrement
    )
  };
}

function normalizeMsRange(value, fallback) {
  const values = Array.isArray(value) ? value : fallback;
  const min = normalizeNumber(values?.[0], DEFAULT_IDLE_GAP_MS[0], DEFAULT_IDLE_GAP_MS[1], fallback[0]);
  const max = normalizeNumber(values?.[1], DEFAULT_IDLE_GAP_MS[0], DEFAULT_IDLE_GAP_MS[1], fallback[1]);
  return max >= min ? [min, max] : [max, min];
}

function normalizeNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}
