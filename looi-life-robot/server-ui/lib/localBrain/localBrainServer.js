import { buildLocalBrainMessages } from "./brainPromptBuilder.js";
import { sanitizeBrainContext } from "./brainContextSanitizer.js";
import {
  normalizeBrainResponse,
  parseBrainResponse
} from "./brainResponseParser.js";
import { MockProvider } from "./providers/mockProvider.js";
import { OllamaProvider } from "./providers/ollamaProvider.js";
import { OpenAICompatibleProvider } from "./providers/openAICompatibleProvider.js";
import { RuleProvider } from "./providers/ruleProvider.js";

export class LocalBrainServer {
  constructor({ provider, enabled = true, logger } = {}) {
    this.provider = provider ?? new MockProvider();
    this.enabled = enabled !== false;
    this.logger = logger;
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
    const provider = this.provider.getName?.() ?? "unknown";
    const model = this.provider.model ?? provider;

    if (!this.enabled) {
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

    try {
      const raw = await this.provider.think({
        context,
        messages,
        input
      });
      const parsed = parseBrainResponse(raw);

      if (parsed?.ok === false) {
        return failedResponse({
          provider,
          model,
          latencyMs: Date.now() - started,
          error: parsed.error ?? "Provider returned an error.",
          reason: parsed.reason ?? "provider_error",
          raw: parsed
        });
      }

      return normalizeBrainResponse(parsed, {
        provider,
        model,
        latencyMs: Date.now() - started,
        raw: typeof raw === "string" ? raw.slice(0, 2000) : null
      });
    } catch (error) {
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
}

export function createLocalBrainServerFromEnv(env = process.env, logger) {
  const providerName = normalizeProvider(env.LOCAL_BRAIN_PROVIDER);
  const enabled = env.LOCAL_BRAIN_ENABLED !== "false";
  const timeoutMs = Number(env.LOCAL_BRAIN_TIMEOUT_MS || 20000);
  const temperature = Number(env.LOCAL_BRAIN_TEMPERATURE || 0.4);
  const maxOutputTokens = Number(env.LOCAL_BRAIN_MAX_OUTPUT_TOKENS || 512);

  try {
    return new LocalBrainServer({
      enabled,
      logger,
      provider: createProvider(providerName, {
        model: env.LOCAL_BRAIN_MODEL || undefined,
        baseUrl: env.LOCAL_BRAIN_BASE_URL || "http://localhost:11434",
        openAiBaseUrl: env.LOCAL_BRAIN_OPENAI_BASE_URL || "http://localhost:1234/v1",
        apiKey: env.LOCAL_BRAIN_OPENAI_API_KEY || "local-not-needed",
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
      provider: new MockProvider()
    });
  }
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
        temperature: options.temperature
      });
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: options.openAiBaseUrl,
        apiKey: options.apiKey,
        model: options.model ?? "",
        timeoutMs: options.timeoutMs,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens
      });
    default:
      return new MockProvider({ model: "mock" });
  }
}

function normalizeProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "rule", "ollama", "openai-compatible"].includes(provider)
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
    actions: [],
    reason,
    confidence: 0,
    raw,
    error: String(error ?? "Unknown provider error").slice(0, 500)
  };
}
