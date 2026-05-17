export class OllamaProvider {
  constructor({
    baseUrl = "http://localhost:11434",
    model = "",
    timeoutMs = 20000,
    temperature = 0.4
  } = {}) {
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.model = model;
    this.timeoutMs = Number(timeoutMs) || 20000;
    this.temperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.4;
  }

  getName() {
    return "ollama";
  }

  async status() {
    if (!this.model) {
      return unavailable(this.getName(), this.model, "LOCAL_BRAIN_MODEL is required for Ollama.");
    }

    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: "GET",
        timeoutMs: Math.min(this.timeoutMs, 5000)
      });

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

    if (chatResponse.status === 404) {
      return this.thinkWithGenerate(messages);
    }

    const payload = await chatResponse.json().catch(() => ({}));

    if (!chatResponse.ok) {
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

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error ?? `Ollama generate HTTP ${response.status}`,
        reason: "provider_error"
      };
    }

    return payload.response ?? "";
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
