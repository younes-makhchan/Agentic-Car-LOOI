import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 3014;
const baseUrl = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL: "true",
    ROBOT_BRIDGE_REQUIRE_HTTPS_FOR_EXTERNAL: "true",
    ROBOT_BRIDGE_PUBLIC_URL: "https://smoke.example",
    ROBOT_BRIDGE_TOKEN: "smoke_bridge_token",
    ROBOT_REQUIRE_RUNTIME_AUTH: "false",
    ROBOT_EVENT_WAIT_TIMEOUT_MS: "3000"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(`${baseUrl}/api/robot-bridge/health`);

  const created = await postJson("/api/robot-bridge/events", {
    source: "phone-browser",
    type: "user_speech",
    text: "hello robot",
    payload: {
      confidence: 0.9,
      language: "en-US",
      final: true
    },
    priority: "normal"
  });
  assert.equal(created.ok, true);
  assert.ok(created.event.id);

  const fresh = await getJson("/api/robot-bridge/events/new");
  assert.equal(fresh.events.length, 1);
  assert.equal(fresh.events[0].type, "user_speech");

  const claimed = await postJson("/api/robot-bridge/events/claim", {
    consumer: "smoke",
    limit: 1
  });
  assert.equal(claimed.events.length, 1);
  assert.equal(claimed.events[0].status, "claimed");

  const handled = await postJson(`/api/robot-bridge/events/${created.event.id}/handled`, {
    result: {
      handledBy: "smoke"
    }
  });
  assert.equal(handled.event.status, "handled");

  const recent = await getJson("/api/robot-bridge/events/recent");
  assert.ok(recent.events.length >= 1);

  const waitPromise = getJson("/api/robot-bridge/events/wait?timeoutMs=3000&pollMs=100&types=user_text,user_speech");
  await wait(250);
  const waitedEvent = await postJson("/api/robot-bridge/events", {
    source: "ui",
    type: "user_text",
    text: "come here",
    payload: {},
    priority: "high"
  });
  assert.ok(waitedEvent.event.id);
  const waited = await waitPromise;
  assert.equal(waited.ok, true);
  assert.equal(waited.done, true);
  assert.equal(waited.timedOut, false);
  assert.equal(waited.events[0].type, "user_text");

  const config = await getJson("/api/config");
  assert.equal(Object.hasOwn(config, "ROBOT_BRIDGE_TOKEN"), false);
  assert.equal(Object.hasOwn(config, "ROBOT_RUNTIME_PAIRING_CODE"), false);

  console.log(
    JSON.stringify({
      ok: true,
      firstEventId: created.event.id,
      waitedEventId: waitedEvent.event.id
    })
  );
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

  throw new Error("Event inbox smoke server did not start");
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return parseResponse(response, true);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return parseResponse(response, true);
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
