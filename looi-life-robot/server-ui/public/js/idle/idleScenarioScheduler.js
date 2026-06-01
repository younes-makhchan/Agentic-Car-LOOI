import {
  IDLE_SCENARIO_GLOBAL_DEFAULTS,
  IDLE_SCENARIO_ORDER,
  IDLE_SCENARIO_TYPES,
  getIdleScenarioChannels,
  getIdleScenarioById
} from "./idleScenarioCatalog.js";
import {
  HEAD_PITCH_DEFAULT_DURATION_MS,
  HEAD_PITCH_DEFAULT_EASING,
  HEAD_PITCH_DEFAULT_PULSE,
  HEAD_PITCH_EASINGS,
  HEAD_PITCH_MAX_DURATION_MS,
  HEAD_PITCH_MAX_PULSE,
  HEAD_PITCH_MIN_PULSE
} from "../robot/esp32Client.js";

const DEFAULT_IDLE_GAP_MS = Object.freeze([1000, 4000]);
const BALANCE_START_CHANCE = 0.2;
const BALANCE_CHANCE_INCREMENT = 0.2;
const OPPOSITE_MIX_CHANCE = 0.25;
export const DEFAULT_IDLE_SCHEDULER_SETTINGS = Object.freeze({
  firstIdleGapMs: DEFAULT_IDLE_GAP_MS,
  silentIdleGapMs: DEFAULT_IDLE_GAP_MS,
  speakingIdleGapMs: DEFAULT_IDLE_GAP_MS,
  balanceStartChance: BALANCE_START_CHANCE,
  balanceChanceIncrement: BALANCE_CHANCE_INCREMENT,
  oppositeMixChance: OPPOSITE_MIX_CHANCE
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
    this.channelBalanceDebts = {
      [IDLE_SCENARIO_TYPES.BODY]: null,
      [IDLE_SCENARIO_TYPES.HEAD]: null
    };
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

    this.channelBalanceDebts = Object.fromEntries(
      Object.entries(this.channelBalanceDebts).map(([type, debt]) => [
        type,
        debt ? { ...debt, chance: Math.min(1, Number(debt.chance || 0)) } : null
      ])
    );

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
      balanceDebt: this.getPrimaryBalanceDebtSnapshot(),
      balanceDebts: this.getBalanceDebtSnapshots(),
      channelBalanceDebts: this.getChannelBalanceDebtSnapshots(),
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
    const mixSelection = this.selectOppositeMixScenario(scenario);
    const mixedScenario = mixSelection?.scenario ?? null;
    const mixText = mixedScenario ? ` + ${mixedScenario.id}` : "";
    const reasonText = [selection.reason, mixSelection?.reason].filter(Boolean).join(", ");
    this.log(`Idle scenario started: ${scenario.id}${mixText} (${reasonText}).`);
    this.eventBus?.publish?.("idle_scenario_started", {
      scenario: scenario.id,
      mixedScenario: mixedScenario?.id ?? "",
      reason,
      selectionReason: selection.reason,
      mixReason: mixSelection?.reason ?? "",
      balanceDebt: this.getPrimaryBalanceDebtSnapshot(),
      balanceDebts: this.getBalanceDebtSnapshots(),
      channelBalanceDebts: this.getChannelBalanceDebtSnapshots()
    }, { source: IDLE_SOURCE, priority: 1 });

    try {
      await this.playScenario(scenario, token, { mixedScenario });
      if (token !== this.playToken) {
        return;
      }
      this.recordScenarioCompletion(scenario, selection, mixedScenario);
      this.eventBus?.publish?.("idle_scenario_completed", {
        scenario: scenario.id,
        mixedScenario: mixedScenario?.id ?? ""
      }, { source: IDLE_SOURCE, priority: 1 });
    } catch (error) {
      this.log(`Idle scenario failed (${scenario.id}${mixText}): ${error.message}`, "warn");
      this.eventBus?.publish?.("idle_scenario_failed", {
        scenario: scenario.id,
        mixedScenario: mixedScenario?.id ?? "",
        error: error.message
      }, { source: IDLE_SOURCE, priority: 3 });
    } finally {
      if (token === this.playToken) {
        this.running = false;
        this.scheduleNext("idle_completed");
      }
    }
  }

  async playScenario(scenario, token, { requireEnabled = true, mixedScenario = null } = {}) {
    const units = mixedScenario
      ? this.buildMixedPlaybackUnits(scenario, mixedScenario)
      : this.buildPlaybackUnits(scenario);

    for (const unit of units) {
      if (token !== this.playToken || (requireEnabled && !this.enabled)) {
        return;
      }

      unit.parallelHeadCommands.forEach((command) => this.sendHeadPitch(command));
      await this.executeCommand(unit.command);
      await wait(getPlaybackUnitWaitMs(unit));
    }
  }

  buildPlaybackUnits(scenario) {
    const units = [];
    const pendingParallelHeadCommands = [];
    let index = 0;

    while (index < scenario.steps.length) {
      const command = this.buildCommand(scenario.steps[index], scenario, index);

      if (isParallelHeadCommand(command)) {
        pendingParallelHeadCommands.push(command);
        index += 1;
        continue;
      }

      if (command.kind === "head_pitch") {
        pendingParallelHeadCommands.splice(0).forEach((pendingCommand) => {
          units.push({
            command: pendingCommand,
            parallelHeadCommands: []
          });
        });
        units.push({
          command,
          parallelHeadCommands: []
        });
        index += 1;
        continue;
      }

      const parallelHeadCommands = pendingParallelHeadCommands.splice(0);
      let nextIndex = index + 1;

      while (nextIndex < scenario.steps.length) {
        const nextCommand = this.buildCommand(scenario.steps[nextIndex], scenario, nextIndex);
        if (!isParallelHeadCommand(nextCommand)) {
          break;
        }

        parallelHeadCommands.push(nextCommand);
        nextIndex += 1;
      }

      units.push({
        command,
        parallelHeadCommands
      });
      index = nextIndex;
    }

    pendingParallelHeadCommands.forEach((command) => {
      units.push({
        command,
        parallelHeadCommands: []
      });
    });

    return units;
  }

  buildMixedPlaybackUnits(primaryScenario, oppositeScenario) {
    const primaryChannels = getIdleScenarioChannels(primaryScenario);
    const oppositeChannels = getIdleScenarioChannels(oppositeScenario);
    const bodyScenario = primaryChannels.effectiveAnimationType === IDLE_SCENARIO_TYPES.BODY
      ? primaryScenario
      : oppositeChannels.effectiveAnimationType === IDLE_SCENARIO_TYPES.BODY
        ? oppositeScenario
        : null;
    const headScenario = primaryChannels.effectiveAnimationType === IDLE_SCENARIO_TYPES.HEAD
      ? primaryScenario
      : oppositeChannels.effectiveAnimationType === IDLE_SCENARIO_TYPES.HEAD
        ? oppositeScenario
        : null;

    if (!bodyScenario || !headScenario) {
      return this.buildPlaybackUnits(primaryScenario);
    }

    const units = this.clonePlaybackUnits(this.buildPlaybackUnits(bodyScenario));
    const headCommands = this.extractHeadPitchCommands(headScenario);
    if (!headCommands.length) {
      return units;
    }

    const attachableUnits = units.filter((unit) => unit.command.kind !== "head_pitch");
    headCommands.forEach((command, index) => {
      const targetUnit = attachableUnits[index];
      if (targetUnit) {
        targetUnit.parallelHeadCommands.push(command);
        return;
      }

      units.push({
        command: this.buildPauseCommandForParallelHead(command),
        parallelHeadCommands: [command]
      });
    });

    return units;
  }

  clonePlaybackUnits(units = []) {
    return units.map((unit) => ({
      command: { ...unit.command },
      parallelHeadCommands: unit.parallelHeadCommands.map((command) => ({ ...command }))
    }));
  }

  extractHeadPitchCommands(scenario) {
    return this.buildPlaybackUnits(scenario).flatMap((unit) => {
      const commands = [];
      if (unit.command.kind === "head_pitch") {
        commands.push(unit.command);
      }
      commands.push(...unit.parallelHeadCommands);
      return commands.map((command) => ({ ...command, mode: "parallel" }));
    });
  }

  buildPauseCommandForParallelHead(command) {
    return {
      scenario: command.scenario,
      step: command.step,
      kind: "pause",
      linear: 0,
      angular: 0,
      durationMs: 0,
      pauseMs: 0,
      rampMs: 0,
      decayMs: 0,
      pulse: HEAD_PITCH_DEFAULT_PULSE,
      mode: "sequence",
      easing: HEAD_PITCH_DEFAULT_EASING
    };
  }

  async executeCommand(command) {
    if (command.kind === "move") {
      await this.commandQueue.sendRealtimeMotion({
        linear: command.linear,
        angular: command.angular,
        durationMs: command.durationMs,
        rampMs: command.rampMs,
        label: `${command.scenario}:${command.step}`,
        source: IDLE_SOURCE,
        log: true,
        record: true
      });
    } else if (command.kind === "stop") {
      await this.commandQueue.sendRealtimeStop?.(`${command.scenario}:step_${command.step}`, {
        log: true,
        record: true
      });
    } else if (command.kind === "head_pitch") {
      this.sendHeadPitch(command);
    }
  }

  buildCommand(step, scenario, index) {
    const globals = IDLE_SCENARIO_GLOBAL_DEFAULTS;
    const speedScale = Number(globals.speedScale || 1);
    const durationScale = Number(globals.durationScale || 1);
    const angularSign = Number(globals.angularSign || 1);
    const kind = normalizeStepKind(step.kind);
    const left = kind === "move" ? clamp(Number(step.left) * speedScale, -MAX_SPEED, MAX_SPEED) : 0;
    const right = kind === "move" ? clamp(Number(step.right) * speedScale, -MAX_SPEED, MAX_SPEED) : 0;
    const linear = clamp((left + right) / 2, -MAX_SPEED, MAX_SPEED);
    const angular = clamp(((right - left) / 2) * angularSign, -MAX_SPEED, MAX_SPEED);
    const maxDuration = kind === "head_pitch" ? HEAD_PITCH_MAX_DURATION_MS : 1200;
    const fallbackDurationMs = kind === "head_pitch" ? HEAD_PITCH_DEFAULT_DURATION_MS : 0;
    const rawDurationMs = step.durationMs ?? fallbackDurationMs;
    const durationMs = Math.round(clamp(Number(rawDurationMs) * durationScale, 0, maxDuration));
    const pauseMs = Math.round(clamp(Number(step.pauseMs), 0, 2000));
    const requestedRampMs = Math.round(clamp(Number(globals.rampMs), 0, MAX_RAMP_MS));
    const rampMs = kind === "move" ? Math.min(requestedRampMs, Math.floor(durationMs / 2)) : 0;
    const pulse = Math.round(clamp(Number(step.pulse ?? HEAD_PITCH_DEFAULT_PULSE), HEAD_PITCH_MIN_PULSE, HEAD_PITCH_MAX_PULSE));
    const mode = step.mode === "parallel" ? "parallel" : "sequence";
    const easing = HEAD_PITCH_EASINGS.includes(step.easing) ? step.easing : HEAD_PITCH_DEFAULT_EASING;

    return {
      scenario: scenario.id,
      step: index + 1,
      kind,
      linear,
      angular,
      durationMs,
      pauseMs,
      rampMs,
      decayMs: rampMs,
      pulse,
      mode,
      easing
    };
  }

  sendHeadPitch(command) {
    const label = `${command.scenario}:${command.step}:head_pitch`;

    if (typeof this.robotClient?.sendHeadPitch === "function") {
      const messageId = this.robotClient.sendHeadPitch({
        pulse: command.pulse,
        durationMs: command.durationMs,
        easing: command.easing,
        label
      });
      this.log(`Idle head pitch sent pulse=${command.pulse} duration=${command.durationMs}ms mode=${command.mode} id=${messageId}`, "debug");
      return;
    }

    const messageId = this.robotClient?.sendJson?.({
      type: "head_pitch",
      pulse: command.pulse,
      duration_ms: command.durationMs,
      easing: command.easing,
      label
    });
    this.log(`Idle head pitch sent pulse=${command.pulse} duration=${command.durationMs}ms mode=${command.mode} id=${messageId ?? "--"}`, "debug");
  }

  selectScenario() {
    const balanceSelection = this.selectBalanceDebtScenario();
    if (balanceSelection) {
      return balanceSelection;
    }

    this.incrementBalanceDebts();
    const blockedSourceIds = this.getBalanceSourceIds();
    const candidates = IDLE_SCENARIO_ORDER
      .map((id) => getIdleScenarioById(id))
      .filter(Boolean)
      .filter((scenario) => !blockedSourceIds.has(scenario.id))
      .filter((scenario) => !this.recentScenarioIds.includes(scenario.id));

    const fallbackCandidates = IDLE_SCENARIO_ORDER
      .map((id) => getIdleScenarioById(id))
      .filter(Boolean)
      .filter((scenario) => !blockedSourceIds.has(scenario.id));
    const pool = candidates.length ? candidates : fallbackCandidates;
    const scenario = pool[Math.floor(Math.random() * pool.length)] ?? null;

    return { scenario, reason: "random" };
  }

  selectOppositeMixScenario(primaryScenario) {
    const channels = getIdleScenarioChannels(primaryScenario);
    if (!channels.allowOppositeMix) {
      return null;
    }

    const targetType = channels.effectiveAnimationType === IDLE_SCENARIO_TYPES.BODY
      ? IDLE_SCENARIO_TYPES.HEAD
      : channels.effectiveAnimationType === IDLE_SCENARIO_TYPES.HEAD
        ? IDLE_SCENARIO_TYPES.BODY
        : "";
    if (!targetType) {
      return null;
    }

    if (Math.random() >= this.settings.oppositeMixChance) {
      return null;
    }

    const balanceDebt = this.getBalanceDebtForType(targetType);
    const balanceScenario = balanceDebt?.targetId ? getIdleScenarioById(balanceDebt.targetId) : null;
    if (balanceScenario && balanceScenario.id !== primaryScenario.id) {
      return {
        scenario: balanceScenario,
        reason: `opposite_balance:${Math.round(balanceDebt.chance * 100)}%`
      };
    }

    const candidates = this.getOppositeMixCandidates(targetType, primaryScenario.id, {
      avoidRecent: true
    });
    const fallbackCandidates = candidates.length
      ? candidates
      : this.getOppositeMixCandidates(targetType, primaryScenario.id, { avoidRecent: false });
    const scenario = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)] ?? null;
    if (!scenario) {
      return null;
    }

    return {
      scenario,
      reason: `opposite_mix:${Math.round(this.settings.oppositeMixChance * 100)}%`
    };
  }

  getOppositeMixCandidates(targetType, primaryScenarioId, { avoidRecent = true } = {}) {
    return IDLE_SCENARIO_ORDER
      .map((id) => getIdleScenarioById(id))
      .filter(Boolean)
      .filter((scenario) => scenario.id !== primaryScenarioId)
      .filter((scenario) => !this.getBalanceSourceIds().has(scenario.id))
      .filter((scenario) => !avoidRecent || !this.recentScenarioIds.includes(scenario.id))
      .filter((scenario) => {
        const channels = getIdleScenarioChannels(scenario);
        return channels.effectiveAnimationType === targetType && channels.allowOppositeMix;
      });
  }

  recordScenarioCompletion(scenario, selection = {}, mixedScenario = null) {
    const completedScenarios = [scenario, mixedScenario].filter(Boolean);
    completedScenarios.forEach((entry) => {
      this.recentScenarioIds = [
        entry.id,
        ...this.recentScenarioIds.filter((id) => id !== entry.id)
      ].slice(0, RECENT_HISTORY_LIMIT);
    });

    const completedIds = new Set(completedScenarios.map((entry) => entry.id));
    const balancedIds = this.clearCompletedBalanceDebts(completedIds);
    completedScenarios.forEach((entry) => {
      if (!balancedIds.has(entry.id)) {
        this.addBalanceDebtForScenario(entry, completedIds);
      }
    });
  }

  selectBalanceDebtScenario({ targetType = "", excludeIds = new Set() } = {}) {
    this.pruneInvalidBalanceDebts();
    const candidates = this.getUniqueBalanceDebtEntries()
      .filter(({ scenario }) => !excludeIds.has(scenario.id))
      .filter(({ scenario }) => {
        return !targetType || getIdleScenarioChannels(scenario).effectiveAnimationType === targetType;
      })
      .sort((a, b) => Number(b.debt.chance || 0) - Number(a.debt.chance || 0));

    const selection = candidates.find((entry) => Math.random() < Number(entry.debt.chance || 0));
    if (!selection) {
      return null;
    }

    return {
      scenario: selection.scenario,
      reason: `balance:${Math.round(selection.debt.chance * 100)}%`,
      balanceDebt: { ...selection.debt }
    };
  }

  incrementBalanceDebts() {
    Object.keys(this.channelBalanceDebts).forEach((type) => {
      const debt = this.channelBalanceDebts[type];
      if (!debt) {
        return;
      }

      this.channelBalanceDebts[type] = {
        ...debt,
        chance: Math.min(1, Number(debt.chance || 0) + this.settings.balanceChanceIncrement)
      };
    });
  }

  addBalanceDebtForScenario(scenario, completedIds = new Set()) {
    if (!scenario?.pairWith || completedIds.has(scenario.pairWith)) {
      return;
    }

    const targetScenario = getIdleScenarioById(scenario.pairWith);
    if (!targetScenario || targetScenario.id === scenario.id) {
      return;
    }

    const targetType = getIdleScenarioChannels(targetScenario).effectiveAnimationType;
    const balanceChannels = getBalanceChannelTypes(targetType);
    if (!balanceChannels.length) {
      return;
    }

    balanceChannels.forEach((channelType) => {
      this.setChannelBalanceDebt(channelType, scenario, targetScenario, targetType);
    });
  }

  setChannelBalanceDebt(channelType, scenario, targetScenario, targetType) {
    const existingDebt = this.channelBalanceDebts[channelType];
    const debt = {
      balanceChannel: channelType,
      sourceId: scenario.id,
      targetId: targetScenario.id,
      targetType,
      chance: this.settings.balanceStartChance
    };

    if (existingDebt) {
      this.channelBalanceDebts[channelType] = {
        ...existingDebt,
        balanceChannel: channelType,
        sourceId: scenario.id,
        targetId: targetScenario.id,
        targetType,
        chance: Math.max(
          Number(existingDebt.chance || 0),
          this.settings.balanceStartChance
        )
      };
      return;
    }

    this.channelBalanceDebts[channelType] = debt;
  }

  clearCompletedBalanceDebts(completedIds = new Set()) {
    const balancedIds = new Set();
    Object.keys(this.channelBalanceDebts).forEach((type) => {
      const debt = this.channelBalanceDebts[type];
      if (debt && completedIds.has(debt.targetId)) {
        balancedIds.add(debt.targetId);
        this.channelBalanceDebts[type] = null;
      }
    });
    return balancedIds;
  }

  pruneInvalidBalanceDebts() {
    Object.keys(this.channelBalanceDebts).forEach((type) => {
      const debt = this.channelBalanceDebts[type];
      if (debt && !getIdleScenarioById(debt.targetId)) {
        this.channelBalanceDebts[type] = null;
      }
    });
  }

  getBalanceSourceIds() {
    return new Set(this.getBalanceDebtSnapshots().map((debt) => debt.sourceId).filter(Boolean));
  }

  getBalanceDebtForType(type) {
    return isBalanceChannelType(type) && this.channelBalanceDebts[type]
      ? { ...this.channelBalanceDebts[type] }
      : null;
  }

  getUniqueBalanceDebtEntries() {
    const entriesByTarget = new Map();
    Object.values(this.channelBalanceDebts).filter(Boolean).forEach((debt) => {
      const scenario = getIdleScenarioById(debt.targetId);
      if (!scenario) {
        return;
      }

      const existing = entriesByTarget.get(debt.targetId);
      if (!existing || Number(debt.chance || 0) > Number(existing.debt.chance || 0)) {
        entriesByTarget.set(debt.targetId, { debt, scenario });
      }
    });
    return Array.from(entriesByTarget.values());
  }

  getPrimaryBalanceDebtSnapshot() {
    return this.getBalanceDebtSnapshots()
      .sort((a, b) => Number(b.chance || 0) - Number(a.chance || 0))[0] ?? null;
  }

  getBalanceDebtSnapshots() {
    return Object.values(this.channelBalanceDebts)
      .filter(Boolean)
      .map((debt) => ({ ...debt }));
  }

  getChannelBalanceDebtSnapshots() {
    return Object.fromEntries(
      Object.entries(this.channelBalanceDebts).map(([type, debt]) => [
        type,
        debt ? { ...debt } : null
      ])
    );
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

function getPlaybackUnitWaitMs(unit) {
  const baseWaitMs = getCommandWaitMs(unit.command);
  const parallelWaitMs = unit.parallelHeadCommands.reduce((maxMs, command) => {
    return Math.max(maxMs, getCommandWaitMs(command));
  }, 0);
  return Math.max(baseWaitMs, parallelWaitMs);
}

function getCommandWaitMs(command) {
  return Math.max(0, command.durationMs + command.decayMs + command.pauseMs);
}

function isParallelHeadCommand(command) {
  return command.kind === "head_pitch" && command.mode === "parallel";
}

function isBalanceChannelType(type) {
  return type === IDLE_SCENARIO_TYPES.BODY || type === IDLE_SCENARIO_TYPES.HEAD;
}

function getBalanceChannelTypes(type) {
  if (type === IDLE_SCENARIO_TYPES.BODY_HEAD) {
    return [IDLE_SCENARIO_TYPES.BODY, IDLE_SCENARIO_TYPES.HEAD];
  }

  return isBalanceChannelType(type) ? [type] : [];
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
    ),
    oppositeMixChance: normalizeNumber(
      source.oppositeMixChance,
      0,
      1,
      DEFAULT_IDLE_SCHEDULER_SETTINGS.oppositeMixChance
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

function normalizeStepKind(kind) {
  return ["move", "stop", "pause", "head_pitch"].includes(kind) ? kind : "pause";
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}
