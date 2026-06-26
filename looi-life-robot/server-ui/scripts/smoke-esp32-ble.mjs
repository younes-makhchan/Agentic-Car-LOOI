import assert from "node:assert/strict";
import { ESP32Client } from "../public/js/robot/esp32Client.js";

const SERVICE_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0001";
const COMMAND_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0002";
const EVENTS_UUID = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0003";

const commandWrites = [];
const eventListeners = new Set();
const deviceListeners = new Set();

const commandCharacteristic = {
  async writeValueWithoutResponse(value) {
    commandWrites.push(new Uint8Array(value));
  }
};

const eventsCharacteristic = {
  addEventListener(type, callback) {
    if (type === "characteristicvaluechanged") {
      eventListeners.add(callback);
    }
  },
  removeEventListener(type, callback) {
    if (type === "characteristicvaluechanged") {
      eventListeners.delete(callback);
    }
  },
  async startNotifications() {
    return this;
  },
  async stopNotifications() {
    return this;
  }
};

const service = {
  async getCharacteristic(uuid) {
    if (uuid === COMMAND_UUID) {
      return commandCharacteristic;
    }
    if (uuid === EVENTS_UUID) {
      return eventsCharacteristic;
    }
    throw new Error(`unexpected characteristic ${uuid}`);
  }
};

const server = {
  async getPrimaryService(uuid) {
    assert.equal(uuid, SERVICE_UUID);
    return service;
  }
};

const device = {
  name: "LOOI Body",
  gatt: {
    connected: false,
    async connect() {
      this.connected = true;
      return server;
    },
    disconnect() {
      this.connected = false;
      for (const callback of deviceListeners) {
        callback();
      }
    }
  },
  addEventListener(type, callback) {
    if (type === "gattserverdisconnected") {
      deviceListeners.add(callback);
    }
  }
};

const bluetooth = {
  requestCount: 0,
  async requestDevice(options) {
    this.requestCount += 1;
    assert.equal(options.optionalServices[0], SERVICE_UUID);
    return device;
  }
};

const logs = [];
const client = new ESP32Client({
  bluetooth,
  minDurationMs: 0,
  logger: (message, level = "info") => logs.push({ message, level })
});

let latestTelemetry = null;
let latestConfig = null;
let lastAck = null;
let disconnectError = null;

client.onTelemetry((telemetry) => {
  latestTelemetry = telemetry;
});
client.onConfig((config) => {
  latestConfig = config;
});
client.onAck((ack) => {
  lastAck = ack;
});
client.onError((error) => {
  if (error.type === "bluetooth_disconnected") {
    disconnectError = error;
  }
});

const status = await client.connect();
assert.equal(status.connected, true);
assert.equal(status.transport, "web_bluetooth");
assert.equal(bluetooth.requestCount, 1);
await waitForWrites(2);
assert.ok(commandWrites.length >= 2, "connect should request config and ping");

client.sendMotion({
  linear: 0.8,
  angular: -0.8,
  durationMs: 5000,
  rampMs: 900,
  label: "test_motion"
});
await waitForWrites(3);

const motionPayload = decodeWrites(commandWrites).find((payload) => payload.type === "motion");
assert.equal(motionPayload.linear, 0.4);
assert.equal(motionPayload.angular, -0.4);
assert.equal(motionPayload.duration_ms, 1000);
assert.equal(motionPayload.ramp_ms, 500);
assert.equal(motionPayload.label, "test_motion");

emitNotification('{"type":"telemetry","transport":"ble","motor_state":"stopped","config":{"max_speed":0.4}}\n');
assert.equal(latestTelemetry.motor_state, "stopped");
assert.equal(latestConfig.max_speed, 0.4);

emitNotification('{"type":"ack","cmd":"motion","accepted":true}\n');
assert.equal(lastAck.cmd, "motion");

device.gatt.disconnect();
assert.equal(client.isConnected(), false);
assert.equal(disconnectError.type, "bluetooth_disconnected");

const unsupported = new ESP32Client({ bluetooth: null });
await assert.rejects(() => unsupported.connect(), /Web Bluetooth is not available/);

console.log(JSON.stringify({
  ok: true,
  writes: commandWrites.length,
  logs: logs.length
}));

function emitNotification(text) {
  const value = new DataView(new TextEncoder().encode(text).buffer);
  for (const callback of eventListeners) {
    callback({ target: { value } });
  }
}

function decodeWrites(writes) {
  return new TextDecoder()
    .decode(concatUint8Arrays(writes))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function concatUint8Arrays(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function waitForWrites(count) {
  const startedAt = Date.now();
  while (commandWrites.length < count && Date.now() - startedAt < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(commandWrites.length >= count, `expected at least ${count} writes`);
}
