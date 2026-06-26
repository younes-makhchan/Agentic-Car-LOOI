const BLE_DEVICE_NAME = "LOOI Body";
const BLE_SERVICE_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0001";
const BLE_COMMAND_CHARACTERISTIC_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0002";
const BLE_EVENTS_CHARACTERISTIC_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0003";
const BLE_WRITE_CHUNK_SIZE = 180;
const MAX_SPEED = 0.4;
const MAX_DURATION_MS = 1000;
const MIN_DURATION_MS = 50;
const MAX_RAMP_MS = 500;
export const HEAD_PITCH_MIN_PULSE = 500;
export const HEAD_PITCH_MAX_PULSE = 620;
export const HEAD_PITCH_DEFAULT_PULSE = 570;
export const HEAD_PITCH_DEFAULT_DURATION_MS = 350;
export const HEAD_PITCH_MAX_DURATION_MS = 2000;
export const HEAD_PITCH_DEFAULT_EASING = "ease_in_out_cubic";
export const HEAD_PITCH_EASINGS = Object.freeze([
  "ease_in_out_cubic",
  "ease_out_cubic",
  "ease_out_quart",
  "exponential_smoothing",
  "critically_damped_spring",
  "minimum_jerk"
]);

const READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};

let messageCounter = 0;

export class ESP32Client {
  constructor({
    logger,
    maxSpeed = MAX_SPEED,
    minDurationMs = MIN_DURATION_MS,
    bluetooth = globalThis.navigator?.bluetooth
  } = {}) {
    this.logger = logger;
    this.bluetooth = bluetooth;
    this.maxSpeed = clamp(maxSpeed, 0.05, 0.5);
    this.minDurationMs = clamp(minDurationMs, 0, MAX_DURATION_MS);
    this.connected = false;
    this.connecting = false;
    this.readyState = READY_STATE.CLOSED;
    this.device = null;
    this.server = null;
    this.service = null;
    this.commandCharacteristic = null;
    this.eventsCharacteristic = null;
    this.deviceName = BLE_DEVICE_NAME;
    this.latestTelemetry = null;
    this.latestConfig = null;
    this.lastPongAt = null;
    this.lastMessageAt = null;
    this.notificationBuffer = "";
    this.sendQueue = Promise.resolve();
    this.statusCallbacks = new Set();
    this.telemetryCallbacks = new Set();
    this.messageCallbacks = new Set();
    this.ackCallbacks = new Set();
    this.configCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.handleNotification = this.handleNotification.bind(this);
    this.handleGattDisconnected = this.handleGattDisconnected.bind(this);
  }

  async connect() {
    this.ensureWebBluetoothAvailable();
    this.connecting = true;
    this.readyState = READY_STATE.CONNECTING;
    this.emitStatus();
    this.log("Opening Bluetooth picker for LOOI Body...");

    try {
      const device = await this.bluetooth.requestDevice({
        filters: [
          { name: BLE_DEVICE_NAME },
          { namePrefix: "LOOI" }
        ],
        optionalServices: [BLE_SERVICE_UUID]
      });

      this.device = device;
      this.deviceName = device?.name || BLE_DEVICE_NAME;
      device.addEventListener?.("gattserverdisconnected", this.handleGattDisconnected);

      this.server = await device.gatt.connect();
      this.service = await this.server.getPrimaryService(BLE_SERVICE_UUID);
      this.commandCharacteristic = await this.service.getCharacteristic(
        BLE_COMMAND_CHARACTERISTIC_UUID
      );
      this.eventsCharacteristic = await this.service.getCharacteristic(
        BLE_EVENTS_CHARACTERISTIC_UUID
      );
      this.eventsCharacteristic.addEventListener(
        "characteristicvaluechanged",
        this.handleNotification
      );
      await this.eventsCharacteristic.startNotifications();

      this.connected = true;
      this.connecting = false;
      this.readyState = READY_STATE.OPEN;
      this.notificationBuffer = "";
      this.emitStatus();
      this.log(`Bluetooth connected to ${this.deviceName}.`);
      this.requestConfig();
      this.ping();
      return this.getStatus();
    } catch (error) {
      this.connected = false;
      this.connecting = false;
      this.readyState = READY_STATE.CLOSED;
      this.emitStatus();
      this.emitError({
        type: "bluetooth_error",
        message: normalizeBluetoothError(error)
      });
      throw error;
    }
  }

  async disconnect() {
    this.connected = false;
    this.connecting = false;
    this.readyState = READY_STATE.CLOSING;
    this.emitStatus();

    try {
      if (this.eventsCharacteristic) {
        this.eventsCharacteristic.removeEventListener?.(
          "characteristicvaluechanged",
          this.handleNotification
        );
        await this.eventsCharacteristic.stopNotifications?.();
      }
    } catch (error) {
      this.log(`Bluetooth notifications stop failed: ${error.message}`, "warn");
    }

    try {
      this.device?.gatt?.disconnect?.();
    } catch (error) {
      this.log(`Bluetooth disconnect failed: ${error.message}`, "warn");
    }

    this.clearConnectionState();
    this.emitStatus();
    return this.getStatus();
  }

  isConnected() {
    return Boolean(
      this.connected &&
      this.readyState === READY_STATE.OPEN &&
      this.device?.gatt?.connected &&
      this.commandCharacteristic
    );
  }

  getStatus() {
    return {
      url: this.deviceName,
      connected: this.isConnected(),
      readyState: this.readyState,
      state: getReadyStateLabel(this.readyState, this.connected, this.connecting),
      lastMessageAt: this.lastMessageAt,
      lastPongAt: this.lastPongAt,
      transport: "web_bluetooth",
      deviceName: this.deviceName,
      supported: this.isSupported()
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
      throw new Error("LOOI Body Bluetooth is not connected.");
    }

    const message = { ...payload };

    if (!message.id) {
      message.id = createMessageId();
    }

    this.sendQueue = this.sendQueue
      .catch(() => {})
      .then(() => this.writeJsonMessage(message))
      .catch((error) => {
        this.emitError({
          type: "bluetooth_error",
          cmd: message.type,
          message: error.message
        });
        this.log(`Bluetooth send failed: ${error.message}`, "error");
      });

    return message.id;
  }

  sendMotion({ linear = 0, angular = 0, durationMs = 300, rampMs, label } = {}) {
    const payload = {
      type: "motion",
      linear: clamp(linear, -this.maxSpeed, this.maxSpeed),
      angular: clamp(angular, -this.maxSpeed, this.maxSpeed),
      duration_ms: clamp(durationMs, this.minDurationMs, MAX_DURATION_MS)
    };

    if (Number.isFinite(Number(rampMs))) {
      payload.ramp_ms = clamp(rampMs, 0, MAX_RAMP_MS);
    }

    if (typeof label === "string" && label.trim()) {
      payload.label = label.trim().slice(0, 60);
    }

    return this.sendJson(payload);
  }

  sendHeadPitch({
    pulse = HEAD_PITCH_DEFAULT_PULSE,
    durationMs = HEAD_PITCH_DEFAULT_DURATION_MS,
    easing = HEAD_PITCH_DEFAULT_EASING,
    label
  } = {}) {
    const payload = {
      type: "head_pitch",
      pulse: Math.round(clamp(pulse, HEAD_PITCH_MIN_PULSE, HEAD_PITCH_MAX_PULSE)),
      duration_ms: Math.round(clamp(durationMs, 0, HEAD_PITCH_MAX_DURATION_MS)),
      easing: normalizeHeadPitchEasing(easing)
    };

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

  async refreshStatus() {
    this.emitStatus();
    return this.getStatus();
  }

  isSupported() {
    return Boolean(this.bluetooth?.requestDevice);
  }

  ensureWebBluetoothAvailable() {
    if (!this.isSupported()) {
      throw new Error("Web Bluetooth is not available in this browser. Use Chrome on HTTPS or localhost.");
    }
  }

  async writeJsonMessage(message) {
    const encoded = new TextEncoder().encode(`${JSON.stringify(message)}\n`);

    for (let offset = 0; offset < encoded.length; offset += BLE_WRITE_CHUNK_SIZE) {
      const chunk = encoded.slice(offset, offset + BLE_WRITE_CHUNK_SIZE);
      await writeBleChunk(this.commandCharacteristic, chunk);
    }
  }

  handleNotification(event) {
    const value = event?.target?.value;
    if (!value) {
      return;
    }

    this.notificationBuffer += new TextDecoder().decode(value);

    while (true) {
      const newlineIndex = this.notificationBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      const line = this.notificationBuffer.slice(0, newlineIndex).trim();
      this.notificationBuffer = this.notificationBuffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      try {
        this.handleMessageObject(JSON.parse(line));
      } catch (error) {
        this.emitError({
          type: "parse_error",
          message: `Invalid Bluetooth JSON: ${error.message}`
        });
      }
    }
  }

  handleGattDisconnected() {
    const wasConnected = this.connected || this.connecting;
    this.clearConnectionState();
    this.emitStatus();

    if (wasConnected) {
      this.log("LOOI Body Bluetooth disconnected.", "warn");
      this.emitError({
        type: "bluetooth_disconnected",
        message: "LOOI Body Bluetooth disconnected."
      });
    }
  }

  clearConnectionState() {
    this.connected = false;
    this.connecting = false;
    this.readyState = READY_STATE.CLOSED;
    this.server = null;
    this.service = null;
    this.commandCharacteristic = null;
    this.eventsCharacteristic = null;
    this.latestTelemetry = null;
    this.lastPongAt = null;
    this.notificationBuffer = "";
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

  handleMessageObject(message) {
    if (!message || typeof message !== "object") {
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

async function writeBleChunk(characteristic, chunk) {
  if (typeof characteristic?.writeValueWithoutResponse === "function") {
    await characteristic.writeValueWithoutResponse(chunk);
    return;
  }

  if (typeof characteristic?.writeValueWithResponse === "function") {
    await characteristic.writeValueWithResponse(chunk);
    return;
  }

  if (typeof characteristic?.writeValue === "function") {
    await characteristic.writeValue(chunk);
    return;
  }

  throw new Error("Bluetooth command characteristic does not support writes.");
}

function clamp(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function normalizeHeadPitchEasing(value) {
  return HEAD_PITCH_EASINGS.includes(value) ? value : HEAD_PITCH_DEFAULT_EASING;
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function createMessageId() {
  messageCounter += 1;
  return `esp32-ble-${Date.now()}-${messageCounter}`;
}

function getReadyStateLabel(readyState, connected, connecting) {
  if (connected) {
    return "connected";
  }

  if (connecting || readyState === READY_STATE.CONNECTING) {
    return "connecting";
  }

  if (readyState === READY_STATE.CLOSING) {
    return "closing";
  }

  return "disconnected";
}

function normalizeBluetoothError(error) {
  const message = error?.message || String(error);

  if (/user cancelled|user canceled|cancelled|canceled/i.test(message)) {
    return "Bluetooth pairing was cancelled.";
  }

  return message;
}
