export class OllamaProvider {
  constructor({
    baseUrl = "http://localhost:11434",
    model = "",
    timeoutMs = 20000,
    temperature = 0.4,
    logger,
    trace = false
  } = {}) {
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.model = model;
    this.timeoutMs = Number(timeoutMs) || 20000;
    this.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;
    this.logger = logger;
    this.trace = Boolean(trace);
  }

  getName() {
    return "ollama";
  }

  async status() {
    if (!this.model) {
      return unavailable(this.getName(), this.model, "LOCAL_BRAIN_MODEL is required for Ollama.");
    }

    try {
      const startedAt = Date.now();
      this.traceLog(
        `PROVIDER_STATUS start provider=${this.getName()} model=${this.model} url=${this.baseUrl}/api/tags timeout=${Math.min(this.timeoutMs, 5000)}ms`
      );
      const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: "GET",
        timeoutMs: Math.min(this.timeoutMs, 5000)
      });
      this.traceLog(
        `PROVIDER_STATUS response provider=${this.getName()} status=${response.status} duration=${Date.now() - startedAt}ms`
      );

      if (!response.ok) {
        return unavailable(this.getName(), this.model, `Ollama status HTTP ${response.status}`);
      }

      return {
        ok: true,
        provider: this.getName(),
        model: this.model,
        available: true,
        details: {
          baseUrl: this.baseUrl
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
        error: "LOCAL_BRAIN_MODEL is required for Ollama.",
        reason: "provider_error"
      };
    }

    const startedAt = Date.now();
    const messageCount = Array.isArray(messages) ? messages.length : 0;
    const promptChars = Array.isArray(messages)
      ? messages.reduce((sum, message) => sum + String(message?.content ?? "").length, 0)
      : 0;
    this.traceLog(
      `PROVIDER_HTTP start provider=${this.getName()} model=${this.model} url=${this.baseUrl}/api/chat timeout=${this.timeoutMs}ms messages=${messageCount} promptChars=${promptChars}`
    );
    const chatResponse = await fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: this.temperature
        }
      })
    });
    this.traceLog(
      `PROVIDER_HTTP response provider=${this.getName()} status=${chatResponse.status} duration=${Date.now() - startedAt}ms`
    );

    if (chatResponse.status === 404) {
      this.traceLog("PROVIDER_HTTP fallback provider=ollama route=/api/generate reason=chat_404", "warn");
      return this.thinkWithGenerate(messages);
    }

    const payload = await chatResponse.json().catch(() => ({}));

    if (!chatResponse.ok) {
      this.traceLog(
        `PROVIDER_HTTP error provider=${this.getName()} status=${chatResponse.status} message="${shortLogText(payload.error)}"`,
        "warn"
      );
      return {
        ok: false,
        error: payload.error ?? `Ollama HTTP ${chatResponse.status}`,
        reason: "provider_error"
      };
    }

    return payload.message?.content ?? payload.response ?? "";
  }

  async thinkWithGenerate(messages = []) {
    const prompt = messages
      .map((message) => `${String(message.role ?? "user").toUpperCase()}:\n${message.content ?? ""}`)
      .join("\n\n");
    const startedAt = Date.now();
    this.traceLog(
      `PROVIDER_HTTP start provider=${this.getName()} model=${this.model} url=${this.baseUrl}/api/generate timeout=${this.timeoutMs}ms`
    );
    const response = await fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: "POST",
      timeoutMs: this.timeoutMs,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: this.temperature
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    this.traceLog(
      `PROVIDER_HTTP response provider=${this.getName()} status=${response.status} duration=${Date.now() - startedAt}ms`
    );

    if (!response.ok) {
      this.traceLog(
        `PROVIDER_HTTP error provider=${this.getName()} status=${response.status} message="${shortLogText(payload.error)}"`,
        "warn"
      );
      return {
        ok: false,
        error: payload.error ?? `Ollama generate HTTP ${response.status}`,
        reason: "provider_error"
      };
    }

    return payload.response ?? "";
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
      throw new Error(`ollama_timeout_after_${timeoutMs}ms`);
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
