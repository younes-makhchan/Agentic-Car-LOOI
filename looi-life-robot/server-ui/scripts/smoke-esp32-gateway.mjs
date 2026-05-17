import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 3021;
const baseUrl = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL: "true",
    ROBOT_BRIDGE_TOKEN: "smoke_token",
    ESP32_DEFAULT_WS_URL: "ws://192.168.4.1:81",
    ESP32_CONNECT_ON_START: "false"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(`${baseUrl}/api/health`);

  const config = await getJson("/api/config");
  assert.equal(config.esp32ConnectionMode, "server_gateway");
  assert.equal(config.defaultEsp32WsUrl, "ws://192.168.4.1:81");

  const status = await getJson("/api/esp32/status");
  assert.equal(status.ok, true);
  assert.equal(status.status.connected, false);
  assert.equal(status.status.state, "disconnected");
  assert.ok(Array.isArray(status.messages));

  const send = await postJson(
    "/api/esp32/send",
    {
      payload: {
        type: "ping"
      }
    },
    { expectOk: false }
  );
  assert.equal(send.ok, false);
  assert.match(send.error, /not connected/i);

  console.log(JSON.stringify({ ok: true, mode: config.esp32ConnectionMode }));
} finally {
  child.kill("SIGTERM");
}

async function waitForServer(url) {
  const started = Date.now();

  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      await wait(100);
    }
  }

  throw new Error("ESP32 gateway smoke server did not start");
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return parseResponse(response, true);
}

async function postJson(path, body, { expectOk = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return parseResponse(response, expectOk);
}

async function parseResponse(response, expectOk) {
  const payload = await response.json();

  if (expectOk && !response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
