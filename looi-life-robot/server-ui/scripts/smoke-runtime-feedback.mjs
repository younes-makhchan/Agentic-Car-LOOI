import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 3013;
const baseUrl = `http://localhost:${port}`;
const pairingCode = "smoke_pairing";
const child = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL: "true",
    ROBOT_BRIDGE_REQUIRE_HTTPS_FOR_EXTERNAL: "true",
    ROBOT_BRIDGE_PUBLIC_URL: "https://smoke.example",
    ROBOT_BRIDGE_TOKEN: "smoke_bridge_token",
    ROBOT_REQUIRE_RUNTIME_AUTH: "true",
    ROBOT_RUNTIME_PAIRING_CODE: pairingCode,
    ROBOT_RUNTIME_HEARTBEAT_STALE_MS: "5000",
    ROBOT_ACTION_WAIT_TIMEOUT_MS: "5000"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(`${baseUrl}/api/robot-bridge/health`);

  const rejectedRegister = await postJson(
    "/api/robot-bridge/runtime/register",
    {
      name: "phone-browser",
      pairingCode: "wrong"
    },
    { expectOk: false }
  );
  assert.equal(rejectedRegister.ok, false);

  const registered = await postJson("/api/robot-bridge/runtime/register", {
    name: "phone-browser",
    pairingCode
  });
  assert.equal(registered.ok, true);
  assert.ok(registered.runtimeId);
  assert.ok(registered.runtimeToken);
  assert.equal(registered.requireRuntimeAuth, true);

  const runtimeHeaders = {
    Authorization: `Bearer ${registered.runtimeToken}`
  };

  const heartbeat = await postJson(
    "/api/robot-bridge/runtime/heartbeat",
    {
      runtimeId: registered.runtimeId,
      status: {
        cloudMotionArmed: false,
        simulatorMode: true,
        bridgePolling: true,
        robotConnected: true,
        connectionState: "simulated_connected",
        lifeState: {
          mood: "curious",
          currentBehavior: "soft_idle",
          obstacle: false,
          robotMotorState: "stopped"
        },
        telemetry: {
          motor_state: "stopped",
          simulated: true
        },
        latestAction: {
          actionId: null
        },
        browserTime: new Date().toISOString()
      }
    },
    { headers: runtimeHeaders }
  );
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.online, true);

  const runtimeStatus = await getJson("/api/robot-bridge/runtime/status");
  assert.equal(runtimeStatus.ok, true);
  assert.equal(runtimeStatus.runtime.online, true);
  assert.equal(runtimeStatus.runtime.simulatorMode, true);
  assert.equal(runtimeStatus.runtime.mood, "curious");

  const created = await postJson("/api/robot-bridge/actions", {
    source: "test",
    type: "express",
    args: {
      emotion: "happy"
    },
    reason: "runtime smoke"
  });
  assert.equal(created.ok, true);
  assert.ok(created.action.id);

  const fetched = await getJson(`/api/robot-bridge/actions/${created.action.id}`);
  assert.equal(fetched.action.id, created.action.id);
  assert.equal(fetched.action.status, "pending");

  const unauthorizedClaim = await postJson(
    "/api/robot-bridge/actions/claim",
    {
      consumer: "smoke",
      limit: 1
    },
    { expectOk: false }
  );
  assert.equal(unauthorizedClaim.ok, false);

  const claimed = await postJson(
    "/api/robot-bridge/actions/claim",
    {
      consumer: "smoke",
      limit: 1
    },
    { headers: runtimeHeaders }
  );
  assert.equal(claimed.actions.length, 1);

  const waitPromise = getJson(`/api/robot-bridge/actions/${created.action.id}/wait?timeoutMs=3000&pollMs=100`);
  await wait(250);
  const completed = await postJson(
    `/api/robot-bridge/actions/${created.action.id}/complete`,
    {
      result: {
        received: true,
        executed: true
      }
    },
    { headers: runtimeHeaders }
  );
  assert.equal(completed.action.status, "completed");

  const waited = await waitPromise;
  assert.equal(waited.ok, true);
  assert.equal(waited.done, true);
  assert.equal(waited.timedOut, false);
  assert.equal(waited.action.status, "completed");

  const config = await getJson("/api/config");
  assert.equal(config.robotRequireRuntimeAuth, true);
  assert.equal(config.robotRuntimeHeartbeatStaleMs, 5000);
  assert.equal(Object.hasOwn(config, "ROBOT_BRIDGE_TOKEN"), false);
  assert.equal(Object.hasOwn(config, "ROBOT_RUNTIME_PAIRING_CODE"), false);
  assert.equal(Object.hasOwn(config, "runtimeToken"), false);

  console.log(
    JSON.stringify({
      ok: true,
      runtimeId: registered.runtimeId,
      actionId: created.action.id
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

  throw new Error("Runtime feedback smoke server did not start");
}

async function getJson(path, { expectOk = true, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return parseResponse(response, expectOk);
}

async function postJson(path, body, { expectOk = true, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
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
