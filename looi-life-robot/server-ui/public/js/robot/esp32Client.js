const DEFAULT_URL = "ws://192.168.4.1:81";
const MAX_SPEED = 0.4;
const MAX_DURATION_MS = 1000;
const MIN_DURATION_MS = 50;
const MAX_RAMP_MS = 500;

let messageCounter = 0;

export class ESP32Client {
  constructor({ url = DEFAULT_URL, logger } = {}) {
    this.url = url;
    this.logger = logger;
    this.ws = null;
    this.connected = false;
    this.latestTelemetry = null;
    this.latestConfig = null;
    this.lastPongAt = null;
    this.lastMessageAt = null;
    this.statusCallbacks = new Set();
    this.telemetryCallbacks = new Set();
    this.messageCallbacks = new Set();
    this.ackCallbacks = new Set();
    this.configCallbacks = new Set();
    this.errorCallbacks = new Set();
  }

  connect(urlOverride) {
    if (typeof WebSocket !== "function") {
      return Promise.reject(new Error("WebSocket is not available in this browser."));
    }

    const requestedUrl =
      typeof urlOverride === "string" && urlOverride.trim()
        ? urlOverride.trim()
        : this.url;

    this.url = requestedUrl;

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.connected &&
      this.ws.url === requestedUrl
    ) {
      this.log(`ESP32 already connected at ${this.url}`);
      this.emitStatus();
      return Promise.resolve(this.getStatus());
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
      this.disconnect();
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);

      this.ws = ws;
      this.connected = false;
      this.emitStatus();
      this.log(`Connecting to ESP32 at ${this.url}...`);

      ws.addEventListener("open", () => {
        this.connected = true;
        this.emitStatus();
        this.log(`Connected to ESP32 at ${this.url}`);

        if (!settled) {
          settled = true;
          resolve(this.getStatus());
        }

        try {
          this.ping();
        } catch (error) {
          this.log(`Initial ping failed: ${error.message}`, "warn");
        }
      });

      ws.addEventListener("close", (event) => {
        const wasConnected = this.connected;
        const manualClose = ws.__manualClose === true;

        this.connected = false;
        this.latestTelemetry = null;
        this.latestConfig = null;
        this.lastPongAt = null;

        if (this.ws === ws) {
          this.ws = null;
        }

        this.emitStatus();
        this.log(
          `ESP32 socket closed${event?.code ? ` (${event.code})` : ""}${
            event?.reason ? `: ${event.reason}` : "."
          }`,
          manualClose || wasConnected ? "info" : "warn"
        );

        if (!settled) {
          settled = true;
          reject(new Error(`Failed to connect to ${this.url}.`));
        }
      });

      ws.addEventListener("error", (event) => {
        const errorPayload = {
          type: "socket_error",
          message: `WebSocket error while connecting to ${this.url}`,
          event
        };

        this.emitError(errorPayload);
        this.log(errorPayload.message, "error");

        if (!settled) {
          settled = true;
          reject(new Error(errorPayload.message));
        }
      });

      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
    });
  }

  disconnect() {
    if (!this.ws) {
      this.connected = false;
      this.latestTelemetry = null;
      this.latestConfig = null;
      this.lastPongAt = null;
      this.emitStatus();
      return;
    }

    const socket = this.ws;
    this.connected = false;
    socket.__manualClose = true;
    this.latestTelemetry = null;
    this.lastPongAt = null;
    this.emitStatus();

    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, "browser_disconnect");
      return;
    }

    this.ws = null;
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getStatus() {
    const readyState =
      this.ws?.readyState ?? (typeof WebSocket === "function" ? WebSocket.CLOSED : 3);

    return {
      url: this.url,
      connected: this.isConnected(),
      readyState,
      state: getReadyStateLabel(readyState, this.connected),
      lastMessageAt: this.lastMessageAt,
      lastPongAt: this.lastPongAt
    };
  }

  getLatestTelemetry() {
    return this.latestTelemetry ? { ...this.latestTelemetry } : null;
  }

  getLatestConfig() {
    return this.latestConfig ? structuredCloneSafe(this.latestConfig) : null;
  }

  onStatus(callback) {
    return this.registerCallback(this.statusCallbacks, callback);
  }

  onTelemetry(callback) {
    return this.registerCallback(this.telemetryCallbacks, callback);
  }

  onMessage(callback) {
    return this.registerCallback(this.messageCallbacks, callback);
  }

  onAck(callback) {
    return this.registerCallback(this.ackCallbacks, callback);
  }

  onConfig(callback) {
    return this.registerCallback(this.configCallbacks, callback);
  }

  onError(callback) {
    return this.registerCallback(this.errorCallbacks, callback);
  }

  sendJson(payload) {
    if (!this.isConnected()) {
      throw new Error("ESP32 WebSocket is not connected.");
    }

    const message = { ...payload };

    if (!message.id) {
      message.id = createMessageId();
    }

    this.ws.send(JSON.stringify(message));
    return message.id;
  }

  sendMotion({ linear = 0, angular = 0, durationMs = 300, rampMs, label } = {}) {
    const payload = {
      type: "motion",
      linear: clamp(linear, -MAX_SPEED, MAX_SPEED),
      angular: clamp(angular, -MAX_SPEED, MAX_SPEED),
      duration_ms: clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS)
    };

    if (Number.isFinite(Number(rampMs))) {
      payload.ramp_ms = clamp(rampMs, 0, MAX_RAMP_MS);
    }

    if (typeof label === "string" && label.trim()) {
      payload.label = label.trim().slice(0, 60);
    }

    return this.sendJson(payload);
  }

  sendConfigUpdate(config = {}) {
    return this.sendJson({
      type: "config_update",
      ...config
    });
  }

  requestConfig() {
    return this.sendJson({
      type: "config_get"
    });
  }

  stop(reason = "browser_stop") {
    return this.sendJson({
      type: "stop",
      reason
    });
  }

  ping() {
    return this.sendJson({
      type: "ping"
    });
  }

  registerCallback(store, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    store.add(callback);
    return () => store.delete(callback);
  }

  emitStatus() {
    const status = this.getStatus();
    this.statusCallbacks.forEach((callback) => callback(status));
  }

  emitTelemetry(telemetry) {
    this.telemetryCallbacks.forEach((callback) => callback(telemetry));
  }

  emitMessage(message) {
    this.messageCallbacks.forEach((callback) => callback(message));
  }

  emitAck(message) {
    this.ackCallbacks.forEach((callback) => callback(message));
  }

  emitConfig(config, message = {}) {
    this.configCallbacks.forEach((callback) => callback(config, message));
  }

  emitError(error) {
    this.errorCallbacks.forEach((callback) => callback(error));
  }

  handleMessage(rawMessage) {
    let message;

    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      this.log(`Failed to parse ESP32 message: ${error.message}`, "warn");
      return;
    }

    this.lastMessageAt = Date.now();

    if (message.type === "telemetry") {
      this.latestTelemetry = message;
      if (message.config) {
        this.latestConfig = structuredCloneSafe(message.config);
        this.emitConfig(this.latestConfig, message);
      }
      this.emitTelemetry(message);
    } else if (message.type === "ack") {
      if (message.cmd === "config_update" && message.config) {
        this.latestConfig = structuredCloneSafe(message.config);
        this.emitConfig(this.latestConfig, message);
      }
      this.emitAck(message);
    } else if (message.type === "config") {
      this.latestConfig = structuredCloneSafe(message.config ?? message);
      this.emitConfig(this.latestConfig, message);
    } else if (message.type === "error") {
      this.emitError(message);
      this.log(`ESP32 error${message.cmd ? ` (${message.cmd})` : ""}: ${message.message}`, "error");
    } else if (message.type === "pong") {
      this.lastPongAt = Date.now();
      this.log(`ESP32 pong received (${message.uptime_ms ?? "--"} ms uptime).`);
    }

    this.emitMessage(message);
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const logMethod = typeof this.logger[level] === "function" ? level : "log";
    this.logger[logMethod](message);
  }
}

function clamp(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function createMessageId() {
  messageCounter += 1;
  return `esp32-${Date.now()}-${messageCounter}`;
}

function getReadyStateLabel(readyState, connected) {
  if (typeof WebSocket !== "function") {
    return connected ? "connected" : "disconnected";
  }

  if (connected) {
    return "connected";
  }

  if (readyState === WebSocket.CONNECTING) {
    return "connecting";
  }

  if (readyState === WebSocket.CLOSING) {
    return "closing";
  }

  return "disconnected";
}
