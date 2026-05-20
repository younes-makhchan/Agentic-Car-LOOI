const DEFAULT_URL = "ws://192.168.4.1:81";
const MAX_SPEED = 0.4;
const MAX_DURATION_MS = 1000;
const MIN_DURATION_MS = 50;
const MAX_RAMP_MS = 500;
const POLL_FALLBACK_INTERVAL_MS = 1000;
const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

let messageCounter = 0;

export class ESP32Client {
  constructor({ url = DEFAULT_URL, logger, apiBase = "/api/esp32", getAuthHeaders = () => ({}) } = {}) {
    this.url = url;
    this.logger = logger;
    this.apiBase = apiBase;
    this.getAuthHeaders = getAuthHeaders;
    this.connected = false;
    this.readyState = READY_STATE.CLOSED;
    this.latestTelemetry = null;
    this.latestConfig = null;
    this.lastPongAt = null;
    this.lastMessageAt = null;
    this.lastSeq = 0;
    this.pollTimer = null;
    this.eventSource = null;
    this.eventStreamConnected = false;
    this.statusCallbacks = new Set();
    this.telemetryCallbacks = new Set();
    this.messageCallbacks = new Set();
    this.ackCallbacks = new Set();
    this.configCallbacks = new Set();
    this.errorCallbacks = new Set();
  }

  connect(urlOverride) {
    const requestedUrl =
      typeof urlOverride === "string" && urlOverride.trim()
        ? urlOverride.trim()
        : this.url;

    this.url = requestedUrl;
    this.readyState = READY_STATE.CONNECTING;
    this.emitStatus();
    this.log(`Asking server gateway to connect to ESP32 at ${this.url}...`);

    return this.postGateway("/connect", { url: this.url })
      .then((payload) => {
        this.applySnapshot(payload);
        this.startGatewayUpdates();
        this.log(`Server gateway connected to ESP32 at ${this.url}`);
        this.ping();
        return this.getStatus();
      })
      .catch((error) => {
        this.connected = false;
        this.readyState = READY_STATE.CLOSED;
        this.emitStatus();
        this.emitError({
          type: "gateway_error",
          message: error.message
        });
        throw error;
      });
  }

  disconnect() {
    this.stopGatewayUpdates();
    this.connected = false;
    this.readyState = READY_STATE.CLOSED;
    this.latestTelemetry = null;
    this.lastPongAt = null;
    this.emitStatus();

    return this.postGateway("/disconnect", {
      reason: "browser_disconnect"
    }).catch((error) => {
      this.log(`ESP32 gateway disconnect failed: ${error.message}`, "warn");
    });
  }

  isConnected() {
    return this.connected && this.readyState === READY_STATE.OPEN;
  }

  getStatus() {
    const readyState = this.readyState;

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
      throw new Error("ESP32 server gateway is not connected.");
    }

    const message = { ...payload };

    if (!message.id) {
      message.id = createMessageId();
    }

    this.postGateway("/send", {
      payload: message
    })
      .then((snapshot) => this.applySnapshot(snapshot))
      .catch((error) => {
        this.emitError({
          type: "gateway_error",
          cmd: message.type,
          message: error.message
        });
        this.log(`ESP32 gateway send failed: ${error.message}`, "error");
      });

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

  refreshStatus() {
    return this.getGateway(`/status?since=${encodeURIComponent(this.lastSeq)}`).then((snapshot) => {
      this.applySnapshot(snapshot);
      if (this.isConnected()) {
        this.startGatewayUpdates();
      }
      return this.getStatus();
    });
  }

  startGatewayUpdates() {
    if (this.eventSource || this.pollTimer) {
      return;
    }

    if (typeof EventSource === "function") {
      this.startEventStream();
      return;
    }

    this.startPollingFallback("EventSource is not available in this browser.");
  }

  stopGatewayUpdates() {
    this.stopEventStream();
    this.stopPollingFallback();
  }

  startEventStream() {
    if (this.eventSource) {
      return;
    }

    const eventUrl = `${this.apiBase}/events?since=${encodeURIComponent(this.lastSeq)}`;
    const source = new EventSource(eventUrl);
    this.eventSource = source;
    this.eventStreamConnected = false;

    source.addEventListener("open", () => {
      this.eventStreamConnected = true;
      this.stopPollingFallback();
      this.log("ESP32 gateway event stream connected.");
    });

    source.addEventListener("snapshot", (event) => {
      const snapshot = parseEventSourcePayload(event.data);
      if (snapshot) {
        this.applySnapshot(snapshot);
      }
    });

    source.addEventListener("error", () => {
      if (this.eventStreamConnected) {
        this.log("ESP32 gateway event stream interrupted; browser will retry.", "warn");
        return;
      }

      this.log("ESP32 gateway event stream unavailable; falling back to low-rate polling.", "warn");
      this.stopEventStream();
      this.startPollingFallback("event_stream_unavailable");
    });
  }

  stopEventStream() {
    if (!this.eventSource) {
      return;
    }

    this.eventSource.close();
    this.eventSource = null;
    this.eventStreamConnected = false;
  }

  startPollingFallback(reason = "fallback") {
    if (this.pollTimer) {
      return;
    }

    this.log(`ESP32 gateway using fallback polling (${reason}).`, "warn");
    this.pollMessages();
    this.pollTimer = globalThis.setInterval(() => {
      this.pollMessages();
    }, POLL_FALLBACK_INTERVAL_MS);
  }

  stopPollingFallback() {
    globalThis.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  pollMessages() {
    this.getGateway(`/messages?since=${encodeURIComponent(this.lastSeq)}`)
      .then((snapshot) => this.applySnapshot(snapshot))
      .catch((error) => {
        this.log(`ESP32 gateway poll failed: ${error.message}`, "warn");
      });
  }

  applySnapshot(snapshot = {}) {
    const status = snapshot.status ?? snapshot;

    if (status?.url) {
      this.url = status.url;
    }

    this.connected = Boolean(status?.connected);
    this.readyState = Number.isFinite(Number(status?.readyState))
      ? Number(status.readyState)
      : this.connected
        ? READY_STATE.OPEN
        : READY_STATE.CLOSED;
    this.lastMessageAt = status?.lastMessageAt ?? this.lastMessageAt;
    this.lastPongAt = status?.lastPongAt ?? this.lastPongAt;

    if (snapshot.telemetry) {
      this.latestTelemetry = snapshot.telemetry;
      this.emitTelemetry(snapshot.telemetry);
    }

    if (snapshot.config) {
      this.latestConfig = structuredCloneSafe(snapshot.config);
      this.emitConfig(this.latestConfig, {
        type: "config",
        config: this.latestConfig
      });
    }

    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    messages.forEach((entry) => {
      this.lastSeq = Math.max(this.lastSeq, Number(entry.seq) || this.lastSeq);
      this.handleMessageObject(entry.message);
    });

    if (Number.isFinite(Number(snapshot.latestSeq))) {
      this.lastSeq = Math.max(this.lastSeq, Number(snapshot.latestSeq));
    }

    this.emitStatus();
  }

  async getGateway(path) {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        ...this.safeAuthHeaders()
      }
    });

    return parseGatewayResponse(response);
  }

  async postGateway(path, body = {}) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.safeAuthHeaders()
      },
      body: JSON.stringify(body)
    });

    return parseGatewayResponse(response);
  }

  safeAuthHeaders() {
    try {
      const headers = this.getAuthHeaders();
      return headers && typeof headers === "object" ? headers : {};
    } catch (error) {
      this.log(`ESP32 gateway auth headers unavailable: ${error.message}`, "warn");
      return {};
    }
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

    this.handleMessageObject(message);
  }

  handleMessageObject(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (message.type === "gateway_status") {
      this.log(`ESP32 gateway ${message.status}${message.url ? ` (${message.url})` : ""}`);
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
  if (connected) {
    return "connected";
  }

  if (readyState === READY_STATE.CONNECTING) {
    return "connecting";
  }

  if (readyState === READY_STATE.CLOSING) {
    return "closing";
  }

  return "disconnected";
}

async function parseGatewayResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `ESP32 gateway HTTP ${response.status}`);
  }

  return payload;
}

function parseEventSourcePayload(data) {
  try {
    return JSON.parse(data);
  } catch (_error) {
    return null;
  }
}
