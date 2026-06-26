import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const DEFAULT_FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_FIREWORKS_MODEL = "accounts/fireworks/models/gpt-oss-20b";

export class FireworksProvider extends OpenAICompatibleProvider {
  constructor({
    baseUrl = DEFAULT_FIREWORKS_BASE_URL,
    apiKey = "",
    model = DEFAULT_FIREWORKS_MODEL,
    timeoutMs = 20000,
    temperature = 0.15,
    maxOutputTokens = 192,
    topP = 1,
    topK = 40,
    presencePenalty = 0,
    frequencyPenalty = 0,
    logger,
    trace = false
  } = {}) {
    super({
      baseUrl,
      apiKey,
      model: model || DEFAULT_FIREWORKS_MODEL,
      timeoutMs,
      temperature,
      maxOutputTokens,
      name: "fireworks",
      logger,
      trace,
      extraParams: {
        top_p: normalizeNumber(topP, 1),
        top_k: normalizeNumber(topK, 40),
        presence_penalty: normalizeNumber(presencePenalty, 0),
        frequency_penalty: normalizeNumber(frequencyPenalty, 0)
      }
    });
  }

  async status() {
    if (!this.apiKey) {
      return {
        ok: true,
        provider: this.getName(),
        model: this.model || DEFAULT_FIREWORKS_MODEL,
        available: false,
        details: {
          error: "FIREWORKS_API_KEY is required."
        }
      };
    }

    return super.status();
  }

  async think(input = {}) {
    if (!this.apiKey) {
      return {
        ok: false,
        error: "FIREWORKS_API_KEY is required.",
        reason: "provider_error"
      };
    }

    return super.think(input);
  }
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
