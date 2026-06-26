import { clampInteger, waitMs } from "../core/runtimeUtils.js";
import { parseBrainResponse } from "./actionParser.js";
import { BrainLatencyBudget } from "./brainLatencyBudget.js";
import { clampBrainPolicy, createDefaultBrainPolicy } from "./brainPolicy.js";

const PHYSICAL_ACTIONS = new Set();

const THOUGHT_EVENTS = new Set([
  "user_text",
  "camera_observation",
  "system"
]);

const LLM_TRIGGER_EVENT_TYPES = new Set([
  "user_text"
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
        `STEP 2 BRAIN_RESPONSE provider=${this.provider} latency=${Math.round(Number(this.latestLatencyMs) || 0)}ms text="${response.text ?? ""}" action=${response.action ? JSON.stringify({ type: response.action.type, args: response.action.args ?? {} }) : "none"}`
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
      response: stripLargeMediaFields(response),
      results: thought.results,
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
      return this.executeStopNow(event);
    }

    if (!THOUGHT_EVENTS.has(event.type)) {
      return null;
    }

    if (!this.shouldThinkAboutEvent(event)) {
      return null;
    }

    return this.requestEventThought(event, event.payload?.gateReason ?? "event");
  }

  async requestEventThought(event, reason = "event") {
    if (!this.running) {
      return null;
    }

    const policy = this.policy();
    const now = Date.now();

    if (!this.shouldThinkAboutEvent(event)) {
      return null;
    }

    if (now - this.lastEventThoughtAt < policy.eventThoughtCooldownMs) {
      return null;
    }

    this.lastEventThoughtAt = now;
    await wait(policy.eventThoughtCooldownMs);
    return this.thinkNow(reason, event);
  }

  shouldThinkAboutEvent(event) {
    if (event?.type === "local_stop_phrase") {
      return true;
    }

    const payload = event?.payload ?? {};
    if (event?.type === "user_text") {
      if (!hasUserText(event.payload, event)) {
        return false;
      }

      return true;
    }

    if (event?.type === "camera_observation") {
      return payload.shouldTriggerBrain === true && payload.fromUserRequest === true;
    }

    if (event?.type === "system") {
      return payload.shouldTriggerBrain === true || Number(event.priority || 0) >= 2;
    }

    return false;
  }

  buildContext(reason, triggerEvent) {
    const runtimeContext =
      typeof this.getRuntimeContext === "function" ? this.getRuntimeContext() : {};
    const { attention: _attention, ...brainRuntimeContext } = runtimeContext ?? {};
    const policy = this.policy();

    return {
      reason,
      triggerEvent,
      policy,
      lifeState: {
        mood: brainRuntimeContext.lifeState?.mood,
        energy: brainRuntimeContext.lifeState?.energy,
        userVisible: brainRuntimeContext.lifeState?.userVisible,
        userPosition: brainRuntimeContext.lifeState?.userPosition,
        userDistance: brainRuntimeContext.lifeState?.userDistance,
        isSpeaking: brainRuntimeContext.lifeState?.isSpeaking,
        isListening: brainRuntimeContext.lifeState?.isListening
      },
      audio: {
        listening: brainRuntimeContext.geminiLive?.micStreaming,
        speaking: brainRuntimeContext.audioStatus?.isSpeaking
      },
      recentEvents:
        brainRuntimeContext.recentEvents ??
        this.eventBus?.getRecentEvents?.({ limit: 5 }) ??
        [],
    };
  }

  async executeBrainResponse(response, context = {}) {
    const policy = this.policy();
    const results = [];
    const action = response?.action;

    if (action) {
      results.push(await this.executeBrainAction(action, context, policy, response));
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

    ["user_text", "camera_observation", "local_stop_phrase", "system"].forEach(
      (type) => {
        this.unsubscribers.push(this.eventBus.subscribe(type, (event) => this.handleEvent(event)));
      }
    );
  }

  async thinkWithAvailableAdapter(context) {
    const primaryAllowed = this.shouldUsePrimaryAdapter(context);
    const candidates = [
      ...(primaryAllowed ? [{ adapter: this.primaryAdapter, fallbackUsed: false }] : []),
      { adapter: this.fallback, fallbackUsed: true },
      { adapter: this.adapter, fallbackUsed: true }
    ].filter((entry, index, list) =>
      entry.adapter &&
      list.findIndex((candidate) => candidate.adapter === entry.adapter) === index
    );

    if (!primaryAllowed && this.primaryAdapter) {
      this.log(
        `Local Brain skipped server LLM for trigger=${context.triggerEvent?.type ?? "none"} reason=${context.reason ?? "unknown"}.`
      );
    }

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
        const timeoutMs = this.latencyBudget.eventThoughtTimeoutMs;
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
        this.log(
          error.message === "brain_timeout" || /aborted/i.test(error.message)
            ? `Local Brain primary timed out; using fallback if available. (${error.message})`
            : `Local Brain adapter failed: ${error.message}`,
          "warn"
        );
      }
    }

    this.adapterAvailable = false;
    throw lastError ?? new Error("No Local Brain adapter or fallback is available.");
  }

  shouldUsePrimaryAdapter(context = {}) {
    const reason = context.reason ?? "";
    const triggerType = context.triggerEvent?.type ?? null;
    const payload = context.triggerEvent?.payload ?? {};

    if (reason === "manual") {
      return true;
    }

    if (!LLM_TRIGGER_EVENT_TYPES.has(triggerType)) {
      return false;
    }

    return hasUserText(payload, context.triggerEvent);
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
    const result = await this.toolExecutor?.executeAction?.(action);
    this.lastThoughtAt = Date.now();
    const thought = this.recordThought({
      reason: "local_stop_phrase",
      triggerEvent: event,
      response: {
        ok: true,
        source: "local_safety",
        action,
        reason: "local stop phrase"
      },
      results: [result],
      skipped: false,
      message: "Stop executed immediately."
    });

    this.eventBus?.publish?.("brain_thought_result", {
      thought,
      results: thought.results
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
      reason: action.reason ?? response?.reason ?? context.reason
    };

    this.log(
      `STEP 3 ACTION ${executableAction.type}: ${JSON.stringify(executableAction.args)}`
    );

    if (!this.toolExecutor?.executeAction) {
      return {
        status: "failed",
        type,
        executed: false,
        physical: PHYSICAL_ACTIONS.has(type),
        message: "ToolExecutor is not available."
      };
    }

    const result = await this.toolExecutor.executeAction(executableAction);
    return result ?? {
      status: "failed",
      type,
      executed: false,
      physical: PHYSICAL_ACTIONS.has(type),
      message: "ToolExecutor returned no result."
    };
  }

  checkPolicy(action, context, policy) {
    if (action.type === "stop") {
      return null;
    }

    if (PHYSICAL_ACTIONS.has(action.type)) {
      if (!policy.localMotionArmed) {
        return rejected(action, "Local Motion is disarmed.", true);
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
    const safeResults = stripLargeMediaFields(results ?? []);
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
      actionType: response?.action?.type ?? null,
      results: safeResults,
      result: safeResults,
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
  return waitMs(ms, { maxMs: 10000 });
}

function hasUserText(...sources) {
  return sources.some((source) => {
    if (!source || typeof source !== "object") {
      return false;
    }

    const value =
      source.text ??
      source.normalizedText ??
      source.payload?.text ??
      source.payload?.normalizedText ??
      "";
    return String(value).trim().length > 0;
  });
}

function stripLargeMediaFields(value, depth = 0) {
  if (depth > 8) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => stripLargeMediaFields(item, depth + 1));
  }

  if (!value || typeof value !== "object") {
    return stripLargeMediaScalar(value);
  }

  const result = {};

  Object.entries(value).forEach(([key, child]) => {
    if (/^(dataUrl|data_url|imageData|image_data|base64|blob|raw)$/i.test(String(key))) {
      return;
    }

    result[key] = stripLargeMediaFields(child, depth + 1);
  });

  return result;
}

function stripLargeMediaScalar(value) {
  if (typeof value !== "string") {
    return value;
  }

  if (/^data:(image|audio|video)\//i.test(value)) {
    return "[local_media_omitted]";
  }

  return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
}
