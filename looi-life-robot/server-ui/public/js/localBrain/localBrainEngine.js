import { parseBrainResponse } from "./actionParser.js";
import { BrainLatencyBudget } from "./brainLatencyBudget.js";
import { clampBrainPolicy, createDefaultBrainPolicy } from "./brainPolicy.js";

const PHYSICAL_ACTIONS = new Set([
  "drive",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle"
]);

const CAMERA_ACTIONS = new Set([
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

const THOUGHT_EVENTS = new Set([
  "user_speech",
  "user_text",
  "camera_observation",
  "autonomous_tick",
  "system"
]);

const IGNORED_SPEECH_CLASSIFICATIONS = new Set([
  "background",
  "noise",
  "unknown"
]);

export class LocalBrainEngine {
  constructor({
    eventBus,
    lifeEngine,
    toolExecutor,
    attentionSystem,
    latencyBudget,
    getRuntimeContext,
    getPolicy,
    logger,
    primaryAdapter,
    adapter,
    fallback
  } = {}) {
    this.eventBus = eventBus;
    this.lifeEngine = lifeEngine;
    this.toolExecutor = toolExecutor;
    this.attentionSystem = attentionSystem;
    this.latencyBudget = latencyBudget ?? new BrainLatencyBudget();
    this.getRuntimeContext = getRuntimeContext;
    this.getPolicy = getPolicy;
    this.logger = logger;
    this.primaryAdapter = primaryAdapter ?? adapter;
    this.adapter = adapter;
    this.fallback = fallback;
    this.adapterAvailable = false;
    this.provider = "unknown";
    this.model = "";
    this.latestLatencyMs = null;
    this.lastError = null;
    this.lastFallbackUsed = false;
    this.running = false;
    this.autonomousTimer = null;
    this.processing = false;
    this.lastThoughtAt = 0;
    this.lastEventThoughtAt = 0;
    this.recentThoughts = [];
    this.maxThoughts = 40;
    this.unsubscribers = [];
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }

    this.running = true;
    this.subscribeToEvents();
    this.log("Local Brain started.");
    return this.getStatus();
  }

  stop() {
    this.running = false;
    clearTimeout(this.autonomousTimer);
    this.autonomousTimer = null;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.log("Local Brain stopped.");
    return this.getStatus();
  }

  isRunning() {
    return this.running;
  }

  getStatus() {
    return {
      running: this.running,
      processing: this.processing,
      adapterAvailable: this.adapterAvailable,
      provider: this.provider,
      model: this.model,
      latestLatencyMs: this.latestLatencyMs,
      lastError: this.lastError,
      fallbackUsed: this.lastFallbackUsed,
      latencyStats: this.latencyBudget?.getStats?.() ?? null,
      attention: this.attentionSystem?.getStatus?.() ?? null,
      lastThoughtAt: this.lastThoughtAt,
      recentThoughts: this.getRecentThoughts({ limit: 5 })
    };
  }

  async thinkNow(reason = "manual", triggerEvent = null) {
    const policy = this.policy();

    if (!policy.localBrainEnabled && reason !== "local_stop_phrase") {
      return this.recordThought({
        reason,
        triggerEvent,
        response: null,
        results: [],
        skipped: true,
        message: "Local Brain is disabled."
      });
    }

    if (this.processing) {
      return this.recordThought({
        reason,
        triggerEvent,
        response: null,
        results: [],
        skipped: true,
        message: "Local Brain is already thinking."
      });
    }

    if (reason !== "local_stop_phrase" && !this.canThink(policy)) {
      return this.recordThought({
        reason,
        triggerEvent,
        response: null,
        results: [],
        skipped: true,
        message: "Local Brain thought rate limit reached."
      });
    }

    this.processing = true;
    const context = this.buildContext(reason, triggerEvent);

    try {
      const { rawResponse, fallbackUsed } = await this.thinkWithAvailableAdapter(context);
      const response = parseBrainResponse(rawResponse);
      this.latestLatencyMs = Number(rawResponse?.latencyMs ?? response?.raw?.latencyMs ?? this.latestLatencyMs ?? 0);
      this.provider = rawResponse?.provider ?? response?.provider ?? response?.source ?? this.provider;
      this.model = rawResponse?.model ?? response?.model ?? this.model;
      this.lastFallbackUsed = fallbackUsed;
      this.lastError = null;
      this.log(
        `Local Brain response provider=${this.provider} latency=${Math.round(Number(this.latestLatencyMs) || 0)}ms text="${response.text ?? ""}" actions=${JSON.stringify((response.actions ?? []).map((action) => ({ type: action.type, args: action.args ?? {} })))}`
      );
      const results = await this.executeBrainResponse(response, context);
      this.lastThoughtAt = Date.now();
      const thought = this.recordThought({
        reason,
        triggerEvent,
        response,
        results,
        skipped: false,
        message: response.reason
      });

      this.eventBus?.publish?.("brain_thought_result", {
        thought,
        response,
        results,
        provider: this.provider,
        latencyMs: this.latestLatencyMs,
        fallbackUsed
      }, {
        source: "local_brain",
        priority: 1
      });

      return thought;
    } catch (error) {
      this.lastThoughtAt = Date.now();
      this.lastError = error.message;
      const thought = this.recordThought({
        reason,
        triggerEvent,
        response: null,
        results: [],
        skipped: false,
        message: error.message,
        error: error.message
      });
      this.eventBus?.publish?.("brain_thought_result", {
        thought,
        error: error.message
      }, {
        source: "local_brain",
        priority: 2
      });
      this.log(`Local Brain thought failed: ${error.message}`, "warn");
      return thought;
    } finally {
      this.processing = false;
      this.lastThoughtAt = Date.now();
    }
  }

  async handleEvent(event) {
    if (!event || !this.running) {
      return null;
    }

    if (event.type === "local_stop_phrase") {
      this.attentionSystem?.enterStopCooldown?.(
        event.payload?.reason ?? "local_stop_phrase",
        this.policy().stopRespectCooldownMs
      );
      return this.executeStopNow(event);
    }

    if (!THOUGHT_EVENTS.has(event.type)) {
      return null;
    }

    if (event.type === "autonomous_tick") {
      return this.requestAutonomousThought(event.payload?.reason ?? "autonomous_tick", event);
    }

    const policy = this.policy();

    if (!policy.localBrainEnabled) {
      return null;
    }

    if (!this.shouldThinkAboutEvent(event)) {
      return null;
    }

    return this.requestEventThought(event, event.payload?.gateReason ?? "event");
  }

  async handleSpeechGateResult(result = {}, transcript = {}) {
    if (result.shouldImmediateStop) {
      const event = transcript.event ?? {
        type: "local_stop_phrase",
        payload: {
          text: transcript.text,
          classification: result.classification,
          reason: result.reason
        },
        source: transcript.source ?? "speech",
        timestamp: transcript.timestamp ?? new Date().toISOString()
      };
      this.attentionSystem?.enterStopCooldown?.(
        result.reason ?? "local_stop_phrase",
        this.policy().stopRespectCooldownMs
      );
      return this.executeStopNow(event);
    }

    if (!result.shouldTriggerBrain || !result.accepted) {
      return null;
    }

    const event = transcript.event ?? {
      type: transcript.source === "typed" ? "user_text" : "user_speech",
      payload: {
        text: transcript.text,
        classification: result.classification,
        accepted: result.accepted,
        shouldTriggerBrain: result.shouldTriggerBrain,
        suggestedIntent: result.suggestedIntent,
        gateReason: result.reason
      },
      source: transcript.source ?? "speech",
      timestamp: transcript.timestamp ?? new Date().toISOString()
    };

    return this.requestEventThought(event, result.reason ?? "speech_gate");
  }

  async requestEventThought(event, reason = "event") {
    if (!this.running) {
      return null;
    }

    const policy = this.policy();
    const now = Date.now();

    if (!policy.localBrainEnabled || !this.shouldThinkAboutEvent(event)) {
      return null;
    }

    if (now - this.lastEventThoughtAt < policy.eventThoughtCooldownMs) {
      return null;
    }

    this.lastEventThoughtAt = now;
    await wait(policy.eventThoughtCooldownMs);
    return this.thinkNow(reason, event);
  }

  async requestAutonomousThought(reason = "autonomous_tick", triggerEvent = null) {
    if (!this.running) {
      return null;
    }

    const policy = this.policy();

    if (!policy.localBrainEnabled || !policy.autonomousMode) {
      return null;
    }

    if (this.attentionSystem && !this.attentionSystem.canAutonomouslyAct(policy)) {
      return null;
    }

    const event = triggerEvent ?? {
      type: "autonomous_tick",
      payload: { reason },
      source: "local_brain",
      timestamp: new Date().toISOString()
    };

    return this.thinkNow("autonomous_tick", event);
  }

  shouldThinkAboutEvent(event) {
    if (event?.type === "local_stop_phrase" || event?.type === "autonomous_tick") {
      return true;
    }

    const payload = event?.payload ?? {};
    const classification = payload.classification ?? payload.speechClassification ?? null;

    if (event?.type === "user_speech" || event?.type === "user_text") {
      if (payload.shouldTriggerBrain === false) {
        return false;
      }

      if (IGNORED_SPEECH_CLASSIFICATIONS.has(classification) && payload.accepted !== true) {
        return false;
      }

      if (this.attentionSystem && !this.attentionSystem.shouldThinkAboutEvent(event)) {
        return false;
      }

      return payload.accepted === true || payload.shouldTriggerBrain === true;
    }

    if (event?.type === "camera_observation") {
      const observation = payload.observation ?? payload.latestObservation ?? {};
      const attention = this.attentionSystem?.getStatus?.();
      return Boolean(
        payload.shouldTriggerBrain ||
        observation.userVisible ||
        ["attentive", "conversation"].includes(attention?.mode)
      );
    }

    if (event?.type === "system") {
      return payload.shouldTriggerBrain === true || Number(event.priority || 0) >= 2;
    }

    return false;
  }

  buildContext(reason, triggerEvent) {
    const runtimeContext =
      typeof this.getRuntimeContext === "function" ? this.getRuntimeContext() : {};
    const policy = this.policy();

    return {
      ...runtimeContext,
      reason,
      triggerEvent,
      policy,
      lifeState: runtimeContext.lifeState ?? this.lifeEngine?.getState?.() ?? null,
      recentEvents:
        runtimeContext.recentEvents ??
        this.eventBus?.getRecentEvents?.({ limit: 30 }) ??
        [],
      attention: runtimeContext.attention ?? this.attentionSystem?.getStatus?.() ?? null,
      recentThoughts: this.getRecentThoughts({ limit: 8 })
    };
  }

  async executeBrainResponse(response, context = {}) {
    const policy = this.policy();
    const actions = Array.isArray(response?.actions) ? response.actions : [];
    const maxActions = policy.maxActionsPerThought;
    const results = [];

    for (const action of actions.slice(0, maxActions)) {
      const result = await this.executeBrainAction(action, context, policy, response);
      results.push(result);
    }

    return results;
  }

  getRecentThoughts({ limit = 20 } = {}) {
    const max = clampInteger(limit, 1, this.maxThoughts, 20);
    return this.recentThoughts.slice(0, max).map((thought) => ({
      ...thought,
      results: thought.results?.map((result) => ({ ...result })) ?? []
    }));
  }

  setAdapter(adapter) {
    this.primaryAdapter = adapter;
  }

  setFallback(fallback) {
    this.fallback = fallback;
  }

  async checkAdapterStatus() {
    const adapter = this.primaryAdapter;

    if (!adapter) {
      this.adapterAvailable = false;
      this.provider = "none";
      this.model = "";
      this.lastError = "No primary adapter configured.";
      return this.getStatus();
    }

    try {
      const status = typeof adapter.status === "function"
        ? await adapter.status()
        : { brain: { available: await adapter.isAvailable?.() } };
      const brain = status.brain ?? status;
      this.adapterAvailable = Boolean(brain.available ?? status.available);
      this.provider = brain.provider ?? status.provider ?? "local-server";
      this.model = brain.model ?? status.model ?? "";
      this.lastError = brain.details?.error ?? status.error ?? null;
    } catch (error) {
      this.adapterAvailable = false;
      this.lastError = error.message;
    }

    return this.getStatus();
  }

  subscribeToEvents() {
    if (!this.eventBus?.subscribe) {
      return;
    }

    ["user_speech", "user_text", "camera_observation", "local_stop_phrase", "autonomous_tick", "system"].forEach(
      (type) => {
        this.unsubscribers.push(this.eventBus.subscribe(type, (event) => this.handleEvent(event)));
      }
    );
  }

  scheduleAutonomousLoop() {
    clearTimeout(this.autonomousTimer);

    if (!this.running) {
      return;
    }

    const policy = this.policy();
    const delay = Math.max(1000, Number(policy.minAutonomousThoughtIntervalMs || 3000));

    this.autonomousTimer = globalThis.setTimeout(async () => {
      try {
        const nextPolicy = this.policy();

        if (
          this.running &&
          nextPolicy.localBrainEnabled &&
          nextPolicy.autonomousMode &&
          !this.processing &&
          Date.now() - this.lastThoughtAt >= nextPolicy.minAutonomousThoughtIntervalMs
        ) {
          this.eventBus?.publish?.("autonomous_tick", {}, { source: "local_brain" });
          await this.thinkNow("autonomous_tick", null);
        }
      } finally {
        this.scheduleAutonomousLoop();
      }
    }, delay);
  }

  async thinkWithAvailableAdapter(context) {
    const candidates = [
      { adapter: this.primaryAdapter, fallbackUsed: false },
      { adapter: this.fallback, fallbackUsed: true },
      { adapter: this.adapter, fallbackUsed: true }
    ].filter((entry, index, list) =>
      entry.adapter &&
      list.findIndex((candidate) => candidate.adapter === entry.adapter) === index
    );

    let lastError = null;

    for (const candidate of candidates) {
      try {
        const available = typeof candidate.adapter.isAvailable === "function"
          ? await candidate.adapter.isAvailable()
          : true;

        if (!available) {
          lastError = new Error("Adapter unavailable.");
          continue;
        }

        const startedAt = Date.now();
        const timeoutMs = context.reason === "autonomous_tick"
          ? this.latencyBudget.autonomousThoughtTimeoutMs
          : this.latencyBudget.eventThoughtTimeoutMs;
        const thinkPromise = candidate.adapter.think(context);
        const rawResponse = candidate.fallbackUsed
          ? await thinkPromise
          : await this.latencyBudget.withTimeout(thinkPromise, timeoutMs, async () => {
              throw new Error("brain_timeout");
            });
        const latencyMs = Number(rawResponse?.latencyMs ?? Date.now() - startedAt);
        this.latestLatencyMs = latencyMs;
        this.latencyBudget?.recordLatency?.(
          rawResponse?.provider ?? rawResponse?.source ?? (candidate.fallbackUsed ? "fallback" : "primary"),
          latencyMs
        );

        if (!candidate.fallbackUsed) {
          this.adapterAvailable = true;
        }

        return {
          rawResponse,
          fallbackUsed: candidate.fallbackUsed
        };
      } catch (error) {
        lastError = error;
        this.log(`Local Brain adapter failed: ${error.message}`, "warn");
      }
    }

    this.adapterAvailable = false;
    throw lastError ?? new Error("No Local Brain adapter or fallback is available.");
  }

  async executeStopNow(event) {
    const action = {
      id: `local_stop_${Date.now()}`,
      source: "local_brain",
      type: "stop",
      args: {
        reason: event.payload?.reason ?? "local_stop_phrase"
      },
      reason: "Local stop phrase"
    };
    const result = await this.toolExecutor?.executeBridgeAction?.(action);
    this.lastThoughtAt = Date.now();
    const thought = this.recordThought({
      reason: "local_stop_phrase",
      triggerEvent: event,
      response: {
        ok: true,
        source: "local_safety",
        actions: [action],
        reason: "local stop phrase"
      },
      results: [result],
      skipped: false,
      message: "Stop executed immediately."
    });

    this.eventBus?.publish?.("brain_thought_result", {
      thought,
      results: [result]
    }, {
      source: "local_brain",
      priority: 5
    });

    return thought;
  }

  async executeBrainAction(action, context, policy, response) {
    const type = action.type;

    if (type === "none") {
      return {
        status: "completed",
        type,
        executed: false,
        physical: false,
        message: action.reason ?? "No action."
      };
    }

    const policyResult = this.checkPolicy(action, context, policy);

    if (policyResult) {
      return policyResult;
    }

    const executableAction = {
      ...action,
      id: action.id ?? `local_brain_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      source: "local_brain",
      args: action.args ?? {},
      reason: action.reason ?? response?.reason ?? context.reason,
      autonomous: context.reason === "autonomous_tick"
    };

    this.log(
      `Local Brain executing action ${executableAction.type}: ${JSON.stringify(executableAction.args)}`
    );

    if (!this.toolExecutor?.executeBridgeAction) {
      return {
        status: "failed",
        type,
        executed: false,
        physical: PHYSICAL_ACTIONS.has(type),
        message: "ToolExecutor is not available."
      };
    }

    const result = await this.toolExecutor.executeBridgeAction(executableAction);
    return result ?? {
      status: "failed",
      type,
      executed: false,
      physical: PHYSICAL_ACTIONS.has(type),
      message: "ToolExecutor returned no result."
    };
  }

  checkPolicy(action, context, policy) {
    const autonomous = context.reason === "autonomous_tick";

    if (action.type === "stop") {
      return null;
    }

    if (PHYSICAL_ACTIONS.has(action.type)) {
      if (!policy.localMotionArmed) {
        return rejected(action, "Local Motion is disarmed.", true);
      }

      if (autonomous && !policy.allowAutonomousMovement) {
        return rejected(action, "Autonomous movement is disabled.", true);
      }

      const stopRespectUntil = Number(
        context.lifeState?.stopRespectUntil ?? this.lifeEngine?.getState?.().stopRespectUntil ?? 0
      );

      if (stopRespectUntil > Date.now()) {
        return rejected(action, "Robot is respecting a recent stop/freeze request.", true, {
          stopRespectUntil
        });
      }
    }

    if (CAMERA_ACTIONS.has(action.type) && !policy.localCameraAllowed) {
      return rejected(action, "Local Camera is not allowed for the Local Brain.", false);
    }

    if (action.type === "speak") {
      if (!policy.localSpeechAllowed) {
        return rejected(action, "Local Speech is disabled.", false);
      }

      if (autonomous && !policy.allowAutonomousSpeech) {
        return rejected(action, "Autonomous speech is disabled.", false);
      }
    }

    return null;
  }

  canThink(policy) {
    const now = Date.now();
    const recent = this.recentThoughts.filter((thought) => now - Number(thought.at || 0) < 60000);
    return recent.length < policy.maxThoughtsPerMinute;
  }

  policy() {
    const value = typeof this.getPolicy === "function" ? this.getPolicy() : createDefaultBrainPolicy();
    return clampBrainPolicy(value);
  }

  recordThought({ reason, triggerEvent, response, results, skipped, message, error } = {}) {
    const thought = {
      id: `thought_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      timestamp: new Date().toISOString(),
      reason,
      triggerType: triggerEvent?.type ?? null,
      triggerText: triggerEvent?.payload?.text ?? null,
      source: response?.source ?? null,
      provider: response?.provider ?? this.provider ?? response?.source ?? null,
      model: response?.model ?? this.model ?? null,
      latencyMs: Number(response?.latencyMs ?? this.latestLatencyMs ?? 0),
      text: response?.text ?? null,
      fallbackUsed: this.lastFallbackUsed,
      actionTypes: Array.isArray(response?.actions)
        ? response.actions.map((action) => action.type)
        : [],
      results: results ?? [],
      result: results ?? [],
      skipped: Boolean(skipped),
      message: message ?? response?.reason ?? "",
      error: error ?? null
    };

    this.recentThoughts.unshift(thought);
    this.recentThoughts.length = Math.min(this.recentThoughts.length, this.maxThoughts);
    this.log(
      `Local Brain ${thought.skipped ? "skipped" : "thought"}: ${thought.message}`,
      thought.error ? "warn" : "info"
    );
    return thought;
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const logMethod = typeof this.logger[level] === "function" ? level : "log";
    this.logger[logMethod](message);
  }
}

function rejected(action, message, physical, detail = {}) {
  return {
    status: "rejected",
    type: action.type,
    executed: false,
    physical,
    message,
    detail,
    timestamp: new Date().toISOString()
  };
}

function wait(ms) {
  const delay = clampInteger(ms, 0, 10000, 0);
  return delay > 0 ? new Promise((resolve) => globalThis.setTimeout(resolve, delay)) : Promise.resolve();
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}
