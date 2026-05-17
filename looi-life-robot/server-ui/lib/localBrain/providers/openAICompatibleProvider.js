export class OpenAICompatibleProvider {
  constructor({
    baseUrl = "http://localhost:1234/v1",
    apiKey = "local-not-needed",
    model = "",
    timeoutMs = 20000,
    temperature = 0.4,
    maxOutputTokens = 192,
    name = "openai-compatible",
    responseFormat = null,
    extraParams = {},
    logger,
    trace = false
  } = {}) {
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number(timeoutMs) || 20000;
    this.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;
    this.maxOutputTokens = Number(maxOutputTokens) || 192;
    this.name = name;
    this.responseFormat = responseFormat;
    this.extraParams = isPlainObject(extraParams) ? { ...extraParams } : {};
    this.logger = logger;
    this.trace = Boolean(trace);
  }

  getName() {
    return this.name;
  }

  async status() {
    if (!this.model) {
      return unavailable(this.getName(), this.model, "LOCAL_BRAIN_MODEL is required.");
    }

    try {
      const startedAt = Date.now();
      this.traceLog(
        `PROVIDER_STATUS start provider=${this.getName()} model=${this.model} url=${this.baseUrl}/models timeout=${Math.min(this.timeoutMs, 5000)}ms`
      );
      const response = await fetchWithTimeout(`${this.baseUrl}/models`, {
        method: "GET",
        timeoutMs: Math.min(this.timeoutMs, 5000),
        headers: this.headers()
      });
      this.traceLog(
        `PROVIDER_STATUS response provider=${this.getName()} status=${response.status} duration=${Date.now() - startedAt}ms`
      );

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
      this.traceLog(
        `PROVIDER_STATUS failed provider=${this.getName()} error="${shortLogText(error.message)}"`,
        "warn"
      );
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

    const startedAt = Date.now();
    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const promptChars = Array.isArray(messages)
      ? messages.reduce((sum, message) => sum + String(message?.content ?? "").length, 0)
      : 0;
    const requestBody = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxOutputTokens,
      ...this.extraParams,
      ...(this.responseFormat ? { response_format: this.responseFormat } : {})
    };

    this.traceLog(
      `PROVIDER_HTTP start provider=${this.getName()} model=${this.model} url=${this.baseUrl}/chat/completions timeout=${this.timeoutMs}ms messages=${messageCount} promptChars=${promptChars}`
    );

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: this.headers(),
      body: JSON.stringify(requestBody)
    });
    const payload = await response.json().catch(() => ({}));
    const durationMs = Date.now() - startedAt;

    this.traceLog(
      `PROVIDER_HTTP response provider=${this.getName()} status=${response.status} duration=${durationMs}ms choices=${Array.isArray(payload.choices) ? payload.choices.length : 0}`
    );

    if (!response.ok) {
      this.traceLog(
        `PROVIDER_HTTP error provider=${this.getName()} status=${response.status} message="${shortLogText(payload.error?.message ?? payload.error ?? "")}"`,
        "warn"
      );
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

  traceLog(message, level = "info") {
    if (!this.trace || typeof this.logger !== "function") {
      return;
    }

    this.logger(message, level);
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
  } catch (error) {
    if (error?.name === "AbortError" || /aborted/i.test(error?.message ?? "")) {
      throw new Error(`local_openai_timeout_after_${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function shortLogText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
