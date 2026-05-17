import dotenv from "dotenv";
import { KimiClient } from "../lib/kimi/kimiClient.js";
import { KimiRobotAgent } from "../lib/kimi/kimiRobotAgent.js";

dotenv.config();

const bridgeUrl = String(process.env.ROBOT_BRIDGE_URL || "http://localhost:3000").replace(/\/+$/, "");
const bridgeToken = process.env.ROBOT_BRIDGE_TOKEN || "";
const pollMs = Number(process.env.KIMI_AGENT_POLL_MS || 2500);
const eventLimit = Number(process.env.KIMI_AGENT_EVENT_LIMIT || 3);
const actionWaitMs = Number(process.env.KIMI_AGENT_ACTION_WAIT_MS || 15000);
const dryRun = process.argv.includes("--dry-run");
const once = process.argv.includes("--once");

if (!process.env.KIMI_API_KEY && !dryRun) {
  console.error("KIMI_API_KEY is required. Add it to server-ui/.env or export it.");
  process.exit(1);
}

const kimiClient = new KimiClient();
const agent = new KimiRobotAgent({
  kimiClient,
  logger: console
});

console.log(
  JSON.stringify({
    ok: true,
    service: "looi-kimi-agent",
    bridgeUrl,
    model: process.env.KIMI_MODEL || "kimi-k2.6",
    dryRun,
    once,
    pollMs
  })
);

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  try {
    await tick();
  } catch (error) {
    console.warn(`Kimi agent tick failed: ${error.message}`);
  }

  if (once) {
    break;
  }

  await wait(pollMs);
} while (!stopping);

async function tick() {
  const health = await bridgeGet("/api/robot-bridge/health");

  if (!health?.runtime?.online) {
    console.log("Runtime offline; waiting for phone heartbeat.");
    return;
  }

  const claimed = await bridgePost("/api/robot-bridge/events/claim", {
    consumer: "kimi_robot_agent",
    limit: eventLimit
  });
  const events = claimed.events ?? [];

  if (events.length === 0) {
    return;
  }

  const [memoryPayload, phrasesPayload, statusPayload] = await Promise.all([
    bridgeGet("/api/robot-bridge/memory/context"),
    bridgeGet("/api/robot-bridge/memory/learned-phrases"),
    bridgeGet("/api/robot-bridge/runtime/status")
  ]);

  let plan;

  if (dryRun) {
    plan = {
      say: "Dry run saw events.",
      ignore: true,
      actions: [],
      memory: []
    };
  } else {
    plan = await agent.planTurn({
      events,
      runtime: statusPayload.runtime ?? health.runtime ?? {},
      memory: memoryPayload.memory ?? {},
      learnedPhrases: phrasesPayload.phrases ?? []
    });
  }

  const actionResults = [];

  for (const memory of plan.memory ?? []) {
    const written = await bridgePost("/api/robot-bridge/memory/write", memory);
    actionResults.push({
      type: "memory",
      ok: true,
      writtenTo: written.writtenTo
    });
  }

  for (const action of plan.actions ?? []) {
    const created = await bridgePost("/api/robot-bridge/actions", {
      source: "kimi_claw_cloud",
      type: action.type,
      args: action.args ?? {},
      reason: action.reason || "kimi_robot_agent"
    });
    const actionId = created.action?.id;
    const waited = actionId
      ? await bridgeGet(
          `/api/robot-bridge/actions/${encodeURIComponent(actionId)}/wait?timeoutMs=${actionWaitMs}`
        )
      : null;

    actionResults.push({
      type: action.type,
      actionId,
      done: Boolean(waited?.done),
      status: waited?.action?.status ?? created.action?.status ?? "unknown",
      result: waited?.action?.result ?? null,
      error: waited?.action?.error ?? null
    });
  }

  const handledResult = {
    kimi: {
      say: plan.say ?? "",
      ignored: Boolean(plan.ignore),
      actionCount: plan.actions?.length ?? 0,
      memoryCount: plan.memory?.length ?? 0
    },
    actionResults
  };

  for (const event of events) {
    await bridgePost(`/api/robot-bridge/events/${encodeURIComponent(event.id)}/handled`, {
      result: handledResult
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      handledEvents: events.map((event) => event.id),
      plan: {
        say: plan.say,
        ignore: plan.ignore,
        actions: plan.actions?.map((action) => action.type) ?? [],
        memoryCount: plan.memory?.length ?? 0
      },
      actionResults
    })
  );
}

async function bridgeGet(path) {
  return bridgeFetch(path, { method: "GET" });
}

async function bridgePost(path, body) {
  return bridgeFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body ?? {})
  });
}

async function bridgeFetch(path, init = {}) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Bridge HTTP ${response.status}`);
  }

  return payload;
}

function authHeaders() {
  return {
    ...(bridgeToken
      ? {
          Authorization: `Bearer ${bridgeToken}`
        }
      : {}),
    "ngrok-skip-browser-warning": "true"
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
