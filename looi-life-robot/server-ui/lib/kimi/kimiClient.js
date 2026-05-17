export class KimiClient {
  constructor({
    apiKey = process.env.KIMI_API_KEY,
    baseUrl = process.env.KIMI_BASE_URL || "https://api.moonshot.ai/v1",
    model = process.env.KIMI_MODEL || "kimi-k2.6",
    fetchImpl = globalThis.fetch,
    timeoutMs = 30000
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.baseUrl && this.model && this.fetchImpl);
  }

  async chat({ messages, temperature = 0.4, maxTokens = 900 } = {}) {
    if (!this.isConfigured()) {
      throw new Error("Kimi client is not configured. Set KIMI_API_KEY.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || `Kimi API HTTP ${response.status}`);
      }

      return {
        raw: payload,
        content: String(payload?.choices?.[0]?.message?.content ?? "").trim(),
        usage: payload?.usage ?? null,
        model: payload?.model ?? this.model
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
