import { OpenAICompatibleProvider } from "./openAICompatibleProvider.js";

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";

export class GroqProvider extends OpenAICompatibleProvider {
  constructor({
    baseUrl = DEFAULT_GROQ_BASE_URL,
    apiKey = "",
    model = DEFAULT_GROQ_MODEL,
    timeoutMs = 20000,
    temperature = 0.2,
    maxOutputTokens = 192,
    logger,
    trace = false
  } = {}) {
    super({
      baseUrl,
      apiKey,
      model: model || DEFAULT_GROQ_MODEL,
      timeoutMs,
      temperature,
      maxOutputTokens,
      name: "groq",
      responseFormat: { type: "json_object" },
      logger,
      trace
    });
  }

  async status() {
    if (!this.apiKey) {
      return {
        ok: true,
        provider: this.getName(),
        model: this.model || DEFAULT_GROQ_MODEL,
        available: false,
        details: {
          error: "GROQ_API_KEY is required."
        }
      };
    }

    return super.status();
  }

  async think(input = {}) {
    if (!this.apiKey) {
      return {
        ok: false,
        error: "GROQ_API_KEY is required.",
        reason: "provider_error"
      };
    }

    return super.think(input);
  }
}
