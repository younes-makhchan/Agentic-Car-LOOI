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

  const eventSnapshot = await readFirstSseSnapshot("/api/esp32/events");
  assert.equal(eventSnapshot.ok, true);
  assert.equal(eventSnapshot.status.connected, false);
  assert.equal(eventSnapshot.status.state, "disconnected");

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

async function readFirstSseSnapshot(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal
    });
    assert.equal(response.ok, true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const event = extractSnapshotEvent(buffer);
      if (event) {
        controller.abort();
        return event;
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new Error("ESP32 SSE snapshot was not received");
}

function extractSnapshotEvent(buffer) {
  const chunks = buffer.split(/\n\n/);

  for (const chunk of chunks) {
    if (!chunk.includes("event: snapshot")) {
      continue;
    }

    const dataLine = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "));

    if (!dataLine) {
      continue;
    }

    return JSON.parse(dataLine.slice("data: ".length));
  }

  return null;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
