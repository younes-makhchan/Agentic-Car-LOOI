import WebSocket from "ws";

const DEFAULT_URL = "ws://192.168.4.1:81";
const MAX_MESSAGES = 200;

let messageCounter = 0;

export class ESP32Gateway {
  constructor({ logger = console, connectTimeoutMs = 8000 } = {}) {
    this.logger = logger;
    this.connectTimeoutMs = connectTimeoutMs;
    this.url = DEFAULT_URL;
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.latestTelemetry = null;
    this.latestConfig = null;
    this.lastMessageAt = null;
    this.lastPongAt = null;
    this.lastError = null;
    this.messages = [];
    this.seq = 0;
  }

  async connect(url = DEFAULT_URL, { timeoutMs = this.connectTimeoutMs } = {}) {
    const nextUrl = typeof url === "string" && url.trim() ? url.trim() : DEFAULT_URL;
    this.url = nextUrl;

    if (this.isConnected() && this.ws?.url === nextUrl) {
      return this.getStatus();
    }

    this.disconnect({ clearState: false, reason: "reconnect" });

    if (typeof WebSocket !== "function") {
      throw new Error("Server WebSocket client is not available in this Node runtime.");
    }

    this.connecting = true;
    this.lastError = null;

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(nextUrl);
      const timer = setTimeout(() => {
        const error = new Error(`Timed out connecting to ESP32 at ${nextUrl}.`);
        this.lastError = error.message;
        this.connecting = false;
        this.connected = false;
        this.recordMessage({
          type: "error",
          cmd: "gateway_connect",
          message: error.message
        });

        try {
          ws.close(1000, "connect_timeout");
        } catch (_error) {
          // Ignore close failures during timeout cleanup.
        }

        settleReject(error);
      }, Math.max(1000, Number(timeoutMs) || this.connectTimeoutMs));
      this.ws = ws;
      this.recordMessage({
        type: "gateway_status",
        status: "connecting",
        url: nextUrl
      });

      const settleReject = (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      };

      ws.addEventListener("open", () => {
        this.connected = true;
        this.connecting = false;
        this.lastError = null;
        this.recordMessage({
          type: "gateway_status",
          status: "connected",
          url: nextUrl
        });

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(this.getStatus());
        }
      });

      ws.addEventListener("close", (event) => {
        const wasConnecting = this.connecting;
        this.connected = false;
        this.connecting = false;

        if (this.ws === ws) {
          this.ws = null;
        }

        this.recordMessage({
          type: "gateway_status",
          status: "disconnected",
          url: nextUrl,
          code: event?.code ?? null,
          reason: event?.reason ?? ""
        });

        if (wasConnecting) {
          settleReject(new Error(`Failed to connect to ESP32 at ${nextUrl}.`));
        }
      });

      ws.addEventListener("error", () => {
        const error = new Error(`ESP32 WebSocket error at ${nextUrl}`);
        this.lastError = error.message;
        this.recordMessage({
          type: "error",
          cmd: "gateway_connect",
          message: error.message
        });
        settleReject(error);
      });

      ws.addEventListener("message", (event) => {
        this.handleRawMessage(event.data);
      });
    });
  }

  disconnect({ clearState = true, reason = "server_disconnect" } = {}) {
    const ws = this.ws;

    this.connected = false;
    this.connecting = false;
    this.ws = null;

    if (clearState) {
      this.latestTelemetry = null;
      this.latestConfig = null;
      this.lastPongAt = null;
    }

    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      ws.close(1000, reason);
    }

    this.recordMessage({
      type: "gateway_status",
      status: "disconnected",
      url: this.url,
      reason
    });

    return this.getStatus();
  }

  isConnected() {
    return Boolean(this.connected && this.ws?.readyState === WebSocket.OPEN);
  }

  sendJson(payload = {}) {
    if (!this.isConnected()) {
      throw new Error("ESP32 gateway is not connected.");
    }

    const message = { ...payload };

    if (!message.id) {
      message.id = createMessageId();
    }

    this.ws.send(JSON.stringify(message));
    return message.id;
  }

  getStatus() {
    const readyState = this.ws?.readyState ?? WebSocket.CLOSED;

    return {
      url: this.url,
      connected: this.isConnected(),
      connecting: this.connecting,
      readyState,
      state: getReadyStateLabel(readyState, this.connected, this.connecting),
      lastMessageAt: this.lastMessageAt,
      lastPongAt: this.lastPongAt,
      lastError: this.lastError
    };
  }

  getMessagesSince(since = 0) {
    const numericSince = Number(since);
    const minSeq = Number.isFinite(numericSince) ? numericSince : 0;

    return this.messages.filter((entry) => entry.seq > minSeq);
  }

  getSnapshot({ since = 0 } = {}) {
    return {
      status: this.getStatus(),
      telemetry: this.latestTelemetry,
      config: this.latestConfig,
      messages: this.getMessagesSince(since),
      latestSeq: this.seq
    };
  }

  handleRawMessage(rawMessage) {
    let text = rawMessage;

    if (rawMessage instanceof ArrayBuffer) {
      text = Buffer.from(rawMessage).toString("utf8");
    } else if (ArrayBuffer.isView(rawMessage)) {
      text = Buffer.from(rawMessage.buffer).toString("utf8");
    }

    let message;

    try {
      message = JSON.parse(String(text));
    } catch (error) {
      this.lastError = `Invalid ESP32 JSON: ${error.message}`;
      this.recordMessage({
        type: "error",
        cmd: "gateway_parse",
        message: this.lastError
      });
      return;
    }

    this.lastMessageAt = Date.now();

    if (message.type === "telemetry") {
      this.latestTelemetry = message;
      if (message.config) {
        this.latestConfig = clone(message.config);
      }
    } else if (message.type === "config") {
      this.latestConfig = clone(message.config ?? message);
    } else if (message.type === "ack" && message.cmd === "config_update" && message.config) {
      this.latestConfig = clone(message.config);
    } else if (message.type === "pong") {
      this.lastPongAt = Date.now();
    } else if (message.type === "error") {
      this.lastError = message.message ?? "ESP32 error";
    }

    this.recordMessage(message);
  }

  recordMessage(message) {
    this.seq += 1;
    this.messages.push({
      seq: this.seq,
      receivedAt: Date.now(),
      message
    });
    this.messages = this.messages.slice(-MAX_MESSAGES);
  }
}

function createMessageId() {
  messageCounter += 1;
  return `esp32-server-${Date.now()}-${messageCounter}`;
}

function getReadyStateLabel(readyState, connected, connecting) {
  if (connected) {
    return "connected";
  }

  if (connecting || readyState === WebSocket.CONNECTING) {
    return "connecting";
  }

  if (readyState === WebSocket.CLOSING) {
    return "closing";
  }

  return "disconnected";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
