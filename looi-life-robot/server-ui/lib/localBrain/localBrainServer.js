import { buildLocalBrainMessages } from "./brainPromptBuilder.js";
import { sanitizeBrainContext } from "./brainContextSanitizer.js";
import {
  normalizeBrainResponse,
  parseBrainResponse
} from "./brainResponseParser.js";
import { FireworksProvider } from "./providers/fireworksProvider.js";
import { GroqProvider } from "./providers/groqProvider.js";
import { MockProvider } from "./providers/mockProvider.js";
import { OllamaProvider } from "./providers/ollamaProvider.js";
import { OpenAICompatibleProvider } from "./providers/openAICompatibleProvider.js";
import { RuleProvider } from "./providers/ruleProvider.js";

export class LocalBrainServer {
  constructor({ provider, enabled = true, logger, trace = false } = {}) {
    this.provider = provider ?? new MockProvider();
    this.enabled = enabled !== false;
    this.logger = logger;
    this.trace = Boolean(trace);
    this.requestCounter = 0;
  }

  async status() {
    const providerStatus = await this.provider.status?.().catch((error) => ({
      ok: true,
      provider: this.provider.getName?.() ?? "unknown",
      model: this.provider.model ?? "",
      available: false,
      details: {
        error: error.message
      }
    }));

    return {
      ok: true,
      enabled: this.enabled,
      provider: providerStatus.provider ?? this.provider.getName?.() ?? "unknown",
      model: providerStatus.model ?? this.provider.model ?? "",
      available: Boolean(this.enabled && providerStatus.available !== false),
      details: providerStatus.details ?? {}
    };
  }

  async think(input = {}) {
    const started = Date.now();
    const requestId = `brain_${Date.now()}_${++this.requestCounter}`;
    const provider = this.provider.getName?.() ?? "unknown";
    const model = this.provider.model ?? provider;
    const triggerText = extractTriggerText(input);

    this.traceLog(requestId, "REQUEST", {
      reason: input.reason ?? "manual",
      triggerType: input.triggerEvent?.type ?? null,
      text: triggerText,
      provider,
      model
    });

    if (!this.enabled) {
      this.traceLog(requestId, "SKIP", { reason: "disabled" }, "warn");
      return failedResponse({
        provider,
        model,
        latencyMs: Date.now() - started,
        error: "Local brain server is disabled.",
        reason: "disabled"
      });
    }

    const context = sanitizeBrainContext({
      ...(input.context ?? {}),
      reason: input.reason,
      triggerEvent: input.triggerEvent
    });
    const messages = buildLocalBrainMessages(context);
    this.traceLog(requestId, "CONTEXT", summarizeContext(context));
    this.traceLog(requestId, "CALL_PROVIDER", {
      provider,
      model,
      messageCount: messages.length,
      promptChars: messages.reduce((sum, message) => sum + String(message.content ?? "").length, 0)
    });

    try {
      const raw = await this.provider.think({
        context,
        messages,
        input
      });
      this.traceLog(requestId, "RAW_RESPONSE", summarizeRawResponse(raw));
      const parsed = parseBrainResponse(raw);

      if (parsed?.ok === false) {
        this.traceLog(requestId, "PROVIDER_ERROR", {
          reason: parsed.reason ?? "provider_error",
          error: parsed.error ?? "Provider returned an error."
        }, "warn");
        return failedResponse({
          provider,
          model,
          latencyMs: Date.now() - started,
          error: parsed.error ?? "Provider returned an error.",
          reason: parsed.reason ?? "provider_error",
          raw: parsed
        });
      }

      const normalized = normalizeBrainResponse(parsed, {
        provider,
        model,
        latencyMs: Date.now() - started,
        raw: typeof raw === "string" ? raw.slice(0, 2000) : null
      });
      this.traceLog(requestId, "NORMALIZED", {
        ok: normalized.ok,
        latencyMs: normalized.latencyMs,
        text: normalized.text,
        action: normalized.action
          ? {
              type: normalized.action.type,
              args: normalized.action.args
            }
          : null,
        reason: normalized.reason,
        confidence: normalized.confidence
      }, normalized.ok ? "info" : "warn");
      return normalized;
    } catch (error) {
      this.traceLog(requestId, "FAILED", {
        error: error.message,
        latencyMs: Date.now() - started
      }, "warn");
      this.log(`Local brain provider failed: ${error.message}`, "warn");
      return failedResponse({
        provider,
        model,
        latencyMs: Date.now() - started,
        error: error.message,
        reason: "provider_error"
      });
    }
  }

  async chat(input = {}) {
    return this.think({
      reason: input.reason ?? "manual",
      triggerEvent: {
        type: "user_text",
        payload: {
          text: String(input.message ?? "")
        }
      },
      context: input.context ?? {}
    });
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }

  traceLog(requestId, step, payload = {}, level = "info") {
    if (!this.trace) {
      return;
    }

    this.log(`TRACE ${requestId} ${step} ${safeJson(payload)}`, level);
  }
}

export function createLocalBrainServerFromEnv(env = process.env, logger) {
  const providerName = normalizeProvider(env.LOCAL_BRAIN_PROVIDER);
  const enabled = env.LOCAL_BRAIN_ENABLED !== "false";
  const trace = env.LOCAL_BRAIN_TRACE === "true";
  const timeoutMs = Number(env.LOCAL_BRAIN_TIMEOUT_MS || 20000);
  const temperature = Number(env.LOCAL_BRAIN_TEMPERATURE || 0.4);
  const maxOutputTokens = Number(env.LOCAL_BRAIN_MAX_OUTPUT_TOKENS || 1024);

  try {
    return new LocalBrainServer({
      enabled,
      logger,
      trace,
      provider: createProvider(providerName, {
        model: env.LOCAL_BRAIN_MODEL || undefined,
        baseUrl: env.LOCAL_BRAIN_BASE_URL || "http://localhost:11434",
        openAiBaseUrl: env.LOCAL_BRAIN_OPENAI_BASE_URL || "http://localhost:1234/v1",
        apiKey: env.LOCAL_BRAIN_OPENAI_API_KEY || "local-not-needed",
        groqBaseUrl: env.GROQ_BASE_URL || env.LOCAL_BRAIN_GROQ_BASE_URL || "https://api.groq.com/openai/v1",
        groqApiKey: env.GROQ_API_KEY || env.LOCAL_BRAIN_GROQ_API_KEY || "",
        fireworksBaseUrl:
          env.FIREWORKS_BASE_URL ||
          env.LOCAL_BRAIN_FIREWORKS_BASE_URL ||
          "https://api.fireworks.ai/inference/v1",
        fireworksApiKey: env.FIREWORKS_API_KEY || env.LOCAL_BRAIN_FIREWORKS_API_KEY || "",
        fireworksTopP: env.FIREWORKS_TOP_P ?? env.LOCAL_BRAIN_FIREWORKS_TOP_P,
        fireworksTopK: env.FIREWORKS_TOP_K ?? env.LOCAL_BRAIN_FIREWORKS_TOP_K,
        fireworksPresencePenalty:
          env.FIREWORKS_PRESENCE_PENALTY ?? env.LOCAL_BRAIN_FIREWORKS_PRESENCE_PENALTY,
        fireworksFrequencyPenalty:
          env.FIREWORKS_FREQUENCY_PENALTY ?? env.LOCAL_BRAIN_FIREWORKS_FREQUENCY_PENALTY,
        logger,
        trace,
        timeoutMs,
        temperature,
        maxOutputTokens
      })
    });
  } catch (error) {
    logger?.(`Invalid local brain provider "${providerName}", falling back to mock: ${error.message}`, "warn");
    return new LocalBrainServer({
      enabled,
      logger,
      trace,
      provider: new MockProvider()
    });
  }
}

function extractTriggerText(input = {}) {
  return shortLogText(
    input.triggerEvent?.payload?.text ??
      input.triggerEvent?.text ??
      input.context?.triggerEvent?.payload?.text ??
      input.context?.triggerEvent?.text ??
      ""
  );
}

function summarizeContext(context = {}) {
  const trigger = context.triggerEvent ?? {};
  return {
    reason: context.reason,
    triggerType: trigger.type ?? null,
    triggerText: shortLogText(trigger.text ?? ""),
    life: context.lifeState
      ? {
          mood: context.lifeState.mood,
          userVisible: context.lifeState.userVisible,
          userPosition: context.lifeState.userPosition,
          userDistance: context.lifeState.userDistance
        }
      : null
  };
}

function summarizeRawResponse(raw) {
  if (typeof raw === "string") {
    return {
      type: "string",
      chars: raw.length,
      preview: shortLogText(raw, 600)
    };
  }

  if (raw && typeof raw === "object") {
    return {
      type: "object",
      keys: Object.keys(raw).slice(0, 20),
      ok: raw.ok,
      reason: shortLogText(raw.reason, 180),
      action: raw.action
        ? { type: raw.action?.type, args: raw.action?.args ?? {} }
        : null
    };
  }

  return {
    type: typeof raw,
    preview: shortLogText(raw)
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function shortLogText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function createProvider(providerName, options) {
  switch (providerName) {
    case "mock":
      return new MockProvider({ model: options.model ?? "mock" });
    case "rule":
      return new RuleProvider({ model: options.model ?? "rule" });
    case "ollama":
      return new OllamaProvider({
        baseUrl: options.baseUrl,
        model: options.model ?? "",
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        logger: options.logger,
        trace: options.trace
      });
    case "groq":
      return new GroqProvider({
        baseUrl: options.groqBaseUrl,
        apiKey: options.groqApiKey,
        model: options.model ?? "llama-3.1-8b-instant",
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        logger: options.logger,
        trace: options.trace
      });
    case "fireworks":
      return new FireworksProvider({
        baseUrl: options.fireworksBaseUrl,
        apiKey: options.fireworksApiKey,
        model: options.model ?? "accounts/fireworks/models/gpt-oss-20b",
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        topP: options.fireworksTopP,
        topK: options.fireworksTopK,
        presencePenalty: options.fireworksPresencePenalty,
        frequencyPenalty: options.fireworksFrequencyPenalty,
        logger: options.logger,
        trace: options.trace
      });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: options.openAiBaseUrl,
        apiKey: options.apiKey,
        model: options.model ?? "",
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        logger: options.logger,
        trace: options.trace
      });
    default:
      return new MockProvider({ model: "mock" });
  }
}

function normalizeProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "rule", "ollama", "groq", "fireworks", "openai-compatible"].includes(provider)
    ? provider
    : "mock";
}

function failedResponse({ provider, model, latencyMs, error, reason = "provider_error", raw = null }) {
  return {
    ok: false,
    provider,
    model,
    latencyMs,
    text: null,
    action: null,
    reason,
    confidence: 0,
    raw,
    error: String(error ?? "Unknown provider error").slice(0, 500)
  };
}
