export class OpenAICompatibleProvider {
  constructor({
    baseUrl = "http://localhost:1234/v1",
    apiKey = "local-not-needed",
    model = "",
    timeoutMs = 20000,
    temperature = 0.4,
    maxOutputTokens = 512
  } = {}) {
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number(timeoutMs) || 20000;
    this.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;
    this.maxOutputTokens = Number(maxOutputTokens) || 512;
  }

  getName() {
    return "openai-compatible";
  }

  async status() {
    if (!this.model) {
      return unavailable(this.getName(), this.model, "LOCAL_BRAIN_MODEL is required.");
    }

    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/models`, {
        method: "GET",
        timeoutMs: Math.min(this.timeoutMs, 5000),
        headers: this.headers()
      });

      return {
        ok: true,
        provider: this.getName(),
        model: this.model,
        available: response.ok,
        details: {
          baseUrl: this.baseUrl,
          status: response.status
        }
      };
    } catch (error) {
      return unavailable(this.getName(), this.model, error.message);
    }
  }

  async think({ messages } = {}) {
    if (!this.model) {
      return {
        ok: false,
        error: "LOCAL_BRAIN_MODEL is required.",
        reason: "provider_error"
      };
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxOutputTokens
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error?.message ?? payload.error ?? `OpenAI-compatible HTTP ${response.status}`,
        reason: "provider_error"
      };
    }

    return payload.choices?.[0]?.message?.content ?? "";
  }

  headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
    };
  }
}

function unavailable(provider, model, error) {
  return {
    ok: true,
    provider,
    model: model || "",
    available: false,
    details: { error }
  };
}

async function fetchWithTimeout(url, { timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
