import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = 3012;
const baseUrl = `http://localhost:${port}`;
const child = spawn(process.execPath, ["server.js"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL: "true",
    ROBOT_BRIDGE_REQUIRE_HTTPS_FOR_EXTERNAL: "true",
    ROBOT_BRIDGE_PUBLIC_URL: "https://smoke.example",
    ROBOT_BRIDGE_TOKEN: "smoke_token"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(`${baseUrl}/api/robot-bridge/health`);

  const health = await getJson("/api/robot-bridge/health");
  assert.equal(health.ok, true);
  assert.equal(health.service, "looi-robot-bridge");
  assert.equal(health.publicUrlConfigured, true);
  assert.equal(health.requireHttpsForExternal, true);

  const created = await postJson("/api/robot-bridge/actions", {
    source: "test",
    type: "curious_scan",
    args: {
      direction: "both",
      intensity: 0.7
    },
    reason: "smoke test"
  });
  assert.equal(created.ok, true);
  assert.ok(created.action.id);

  const externalHttp = await postJson(
    "/api/robot-bridge/actions",
    {
      source: "kimi_claw_cloud",
      type: "stop",
      args: {}
    },
    {
      expectOk: false,
      headers: {
        "x-forwarded-for": "8.8.8.8",
        "x-forwarded-proto": "http",
        Authorization: "Bearer smoke_token"
      }
    }
  );
  assert.equal(externalHttp.ok, false);

  const externalHttps = await postJson(
    "/api/robot-bridge/actions",
    {
      source: "kimi_claw_cloud",
      type: "express",
      args: {
        emotion: "happy",
        intensity: 0.8
      },
      reason: "external https smoke"
    },
    {
      headers: {
        "x-forwarded-for": "8.8.8.8",
        "x-forwarded-proto": "https",
        Authorization: "Bearer smoke_token"
      }
    }
  );
  assert.equal(externalHttps.ok, true);

  const batch = await postJson("/api/robot-bridge/actions/batch", {
    source: "test",
    actions: [
      {
        type: "retreat",
        args: {
          style: "gentle",
          distance: "short"
        }
      },
      {
        type: "stop",
        args: {
          reason: "batch_smoke"
        }
      }
    ],
    reason: "batch smoke"
  });
  assert.equal(batch.actions.length, 2);

  const invalid = await postJson(
    "/api/robot-bridge/actions",
    {
      source: "test",
      type: "raw_pwm",
      args: {}
    },
    { expectOk: false }
  );
  assert.equal(invalid.ok, false);

  const pending = await getJson("/api/robot-bridge/actions/pending");
  assert.equal(pending.actions.length, 4);

  const claimed = await postJson("/api/robot-bridge/actions/claim", {
    consumer: "smoke",
    limit: 10
  });
  assert.equal(claimed.actions.length, 4);
  assert.equal(claimed.actions[0].status, "claimed");

  const completed = await postJson(
    `/api/robot-bridge/actions/${claimed.actions[0].id}/complete`,
    {
      result: {
        received: true,
        executed: false
      }
    }
  );
  assert.equal(completed.action.status, "completed");

  const failed = await postJson(`/api/robot-bridge/actions/${claimed.actions[1].id}/fail`, {
    error: "smoke failure"
  });
  assert.equal(failed.action.status, "failed");

  const rejected = await postJson(`/api/robot-bridge/actions/${claimed.actions[2].id}/reject`, {
    error: "smoke rejection"
  });
  assert.equal(rejected.action.status, "rejected");

  const recent = await getJson("/api/robot-bridge/actions/recent");
  assert.ok(recent.actions.length >= 1);

  const cleared = await postJson("/api/robot-bridge/actions/clear", {
    includePending: false
  });
  assert.equal(cleared.ok, true);
  assert.ok(cleared.cleared >= 3);

  const config = await getJson("/api/config");
  assert.equal(config.robotBridgeEnabled, true);
  assert.equal(config.robotBridgePublicUrlConfigured, true);
  assert.equal(Object.hasOwn(config, "ROBOT_BRIDGE_TOKEN"), false);
  assert.equal(Object.hasOwn(config, "robotBridgeToken"), false);

  console.log(
    JSON.stringify({
      ok: true,
      actionId: created.action.id,
      recentCount: recent.actions.length
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

  throw new Error("Robot bridge smoke server did not start");
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return parseResponse(response, true);
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
