import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESP32Gateway } from "./lib/esp32Gateway.js";
import { createLocalBrainServerFromEnv } from "./lib/localBrain/localBrainServer.js";
import { LearnedPhraseStore } from "./lib/memory/learnedPhraseStore.js";
import { MemoryStore, looksLikeSecret } from "./lib/memory/memoryStore.js";
import { RobotActionQueue } from "./lib/robotBridge/actionQueue.js";
import { RobotEventQueue } from "./lib/robotBridge/eventQueue.js";
import { RuntimeRegistry } from "./lib/robotBridge/runtimeRegistry.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const esp32DefaultWsUrl = process.env.ESP32_DEFAULT_WS_URL || "ws://192.168.4.1:81";
const esp32ConnectOnStart = process.env.ESP32_CONNECT_ON_START === "true";
const esp32ConnectTimeoutMs = Number(process.env.ESP32_CONNECT_TIMEOUT_MS || 8000);
const esp32Gateway = new ESP32Gateway({
  connectTimeoutMs: esp32ConnectTimeoutMs
});
const robotActionQueue = new RobotActionQueue();
const memoryStore = new MemoryStore();
const learnedPhraseStore = new LearnedPhraseStore();
const robotEventQueue = new RobotEventQueue({
  maxEvents: Number(process.env.ROBOT_EVENT_MAX_STORED || 200)
});
const requireRuntimeAuth = process.env.ROBOT_REQUIRE_RUNTIME_AUTH === "true";
const runtimeHeartbeatStaleMs = Number(process.env.ROBOT_RUNTIME_HEARTBEAT_STALE_MS || 5000);
const robotActionWaitTimeoutMs = Number(process.env.ROBOT_ACTION_WAIT_TIMEOUT_MS || 15000);
const robotEventWaitTimeoutMs = Number(process.env.ROBOT_EVENT_WAIT_TIMEOUT_MS || 30000);
const localFirstDisableKimiCloud = process.env.LOCAL_FIRST_DISABLE_KIMI_CLOUD !== "false";
const localBrainProvider = normalizeLocalBrainProvider(process.env.LOCAL_BRAIN_PROVIDER);
const localBrainModel = process.env.LOCAL_BRAIN_MODEL || defaultLocalBrainModel(localBrainProvider);
const localBrainServer = createLocalBrainServerFromEnv(process.env, serverLog);
const localBrainRequireLocalNetwork = process.env.LOCAL_BRAIN_REQUIRE_LOCAL_NETWORK === "true";
const runtimeRegistry = new RuntimeRegistry({
  tokenTtlMs: Number(process.env.ROBOT_RUNTIME_TOKEN_TTL_MS || 86_400_000),
  staleMs: runtimeHeartbeatStaleMs
});
const requireHttpsForExternal =
  process.env.ROBOT_BRIDGE_REQUIRE_HTTPS_FOR_EXTERNAL !== "false";

// Only public, browser-safe config lives here.
const PUBLIC_CONFIG = {
  defaultEsp32WsUrl: esp32DefaultWsUrl,
  esp32ConnectionMode: "server_gateway",
  esp32ConnectOnStart,
  maxSpeed: 0.4,
  maxDurationMs: 1000,
  localFirstMode: true,
  localBrainDefaultEnabled: true,
  localBrainAutonomousDefault: false,
  localBrainThoughtIntervalMs: Number(process.env.LOCAL_BRAIN_THOUGHT_INTERVAL_MS || 4000),
  localBrainMaxThoughtsPerMinute: Number(process.env.LOCAL_BRAIN_MAX_THOUGHTS_PER_MINUTE || 12),
  localBrainServerEnabled: process.env.LOCAL_BRAIN_ENABLED !== "false",
  localBrainProvider,
  localBrainModel,
  localBrainEventTimeoutMs: Number(process.env.LOCAL_BRAIN_EVENT_TIMEOUT_MS || 12000),
  localBrainAutonomousTimeoutMs: Number(process.env.LOCAL_BRAIN_AUTONOMOUS_TIMEOUT_MS || 20000),
  alwaysListeningDefault: false,
  audioLevelMonitorDefault: false,
  wakeNamesDefault: ["looi", "louie", "lui", "robot"],
  attentionWindowMs: Number(process.env.LOOI_ATTENTION_WINDOW_MS || 20000),
  conversationWindowMs: Number(process.env.LOOI_CONVERSATION_WINDOW_MS || 30000),
  speechGateEventCooldownMs: Number(process.env.LOOI_SPEECH_GATE_EVENT_COOLDOWN_MS || 800),
  autonomousSchedulerTickMs: Number(process.env.LOOI_AUTONOMOUS_SCHEDULER_TICK_MS || 1000),
  looiModeDefault: false,
  idleMicroBehaviorDefault: true,
  attentionBodyTrackingDefault: false,
  keepRobotAwakeDefault: false,
  idleMicroMinMs: Number(process.env.LOOI_IDLE_MICRO_MIN_MS || 4000),
  idleMicroMaxMs: Number(process.env.LOOI_IDLE_MICRO_MAX_MS || 12000),
  macroDefaultRampMs: Number(process.env.LOOI_MACRO_DEFAULT_RAMP_MS || 160),
  performanceMonitorEnabledDefault: true,
  robotBridgeEnabled: !localFirstDisableKimiCloud,
  robotBridgePollMs: Number(process.env.ROBOT_BRIDGE_POLL_MS || 1000),
  robotBridgePublicUrlConfigured: Boolean(process.env.ROBOT_BRIDGE_PUBLIC_URL),
  bridgeAuthEnabled: Boolean(process.env.ROBOT_BRIDGE_TOKEN),
  robotRequireRuntimeAuth: requireRuntimeAuth,
  robotRuntimeHeartbeatMs: 1000,
  robotRuntimeHeartbeatStaleMs: runtimeHeartbeatStaleMs,
  robotEventWaitTimeoutMs,
  cameraObservationPostMs: 3000,
  cameraSnapshotMaxWidth: 320,
  legacyCloudBridgeInactive: localFirstDisableKimiCloud
};

app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "looi-life-server",
    time: new Date().toISOString()
  });
});

app.get("/api/config", (_req, res) => {
  res.json(PUBLIC_CONFIG);
});

app.get("/api/local-brain/status", requireLocalBrainAccess, async (_req, res) => {
  const status = await localBrainServer.status();

  res.json({
    ok: true,
    localFirstMode: true,
    brain: status
  });
});

app.post("/api/local-brain/think", requireLocalBrainAccess, async (req, res) => {
  const response = await localBrainServer.think({
    reason: req.body?.reason ?? "manual",
    triggerEvent: req.body?.triggerEvent ?? null,
    context: req.body?.context ?? {}
  });

  res.status(response.ok === false ? 502 : 200).json(response);
});

app.post("/api/local-brain/chat", requireLocalBrainAccess, async (req, res) => {
  const response = await localBrainServer.chat({
    message: req.body?.message ?? "",
    context: req.body?.context ?? {},
    reason: req.body?.reason ?? "manual"
  });

  res.status(response.ok === false ? 502 : 200).json(response);
});

// Local-first runtime uses the ESP32 gateway and memory endpoints below.
// Legacy cloud robot-bridge endpoints remain later for reference/backward compatibility.
app.get("/api/esp32/status", requireEsp32GatewayAccess, (req, res) => {
  res.json({
    ok: true,
    ...esp32Gateway.getSnapshot({
      since: req.query.since
    })
  });
});

app.get("/api/esp32/messages", requireEsp32GatewayAccess, (req, res) => {
  res.json({
    ok: true,
    ...esp32Gateway.getSnapshot({
      since: req.query.since
    })
  });
});

app.post("/api/esp32/connect", requireEsp32GatewayAccess, async (req, res) => {
  try {
    const status = await esp32Gateway.connect(
      typeof req.body?.url === "string" ? req.body.url : esp32DefaultWsUrl,
      {
        timeoutMs: esp32ConnectTimeoutMs
      }
    );

    res.json({
      ok: true,
      status,
      telemetry: esp32Gateway.latestTelemetry,
      config: esp32Gateway.latestConfig
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error.message,
      status: esp32Gateway.getStatus()
    });
  }
});

app.post("/api/esp32/disconnect", requireEsp32GatewayAccess, (req, res) => {
  const status = esp32Gateway.disconnect({
    reason: req.body?.reason ?? "ui_disconnect"
  });

  res.json({
    ok: true,
    status
  });
});

app.post("/api/esp32/send", requireEsp32GatewayAccess, (req, res) => {
  try {
    const payload = req.body?.payload;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      res.status(400).json({
        ok: false,
        error: "payload must be an object"
      });
      return;
    }

    const id = esp32Gateway.sendJson(payload);

    res.json({
      ok: true,
      id,
      status: esp32Gateway.getStatus()
    });
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error.message,
      status: esp32Gateway.getStatus()
    });
  }
});

// Legacy KimiClaw Cloud bridge endpoints are inactive in the local-first browser runtime.
app.get("/api/robot-bridge/health", (_req, res) => {
  const stats = robotActionQueue.getStats();
  const eventStats = robotEventQueue.getStats();

  res.json({
    ok: true,
    service: "looi-robot-bridge",
    time: new Date().toISOString(),
    publicUrlConfigured: Boolean(process.env.ROBOT_BRIDGE_PUBLIC_URL),
    pendingActions: stats.pending,
    recentActions: stats.recent,
    newEvents: eventStats.new,
    recentEvents: eventStats.recent,
    requireHttpsForExternal,
    runtime: runtimeRegistry.getPublicStatus()
  });
});

app.post("/api/robot-bridge/runtime/register", (req, res) => {
  const pairingCode = typeof req.body?.pairingCode === "string" ? req.body.pairingCode : "";
  const expectedPairingCode = process.env.ROBOT_RUNTIME_PAIRING_CODE;

  if (
    requireRuntimeAuth &&
    (!expectedPairingCode || pairingCode !== expectedPairingCode)
  ) {
    res.status(401).json({
      ok: false,
      error: "Invalid runtime pairing code"
    });
    return;
  }

  const runtime = runtimeRegistry.createRuntime({
    name: req.body?.name ?? "phone-browser"
  });

  res.json({
    ok: true,
    ...runtime,
    requireRuntimeAuth
  });
});

app.post("/api/robot-bridge/runtime/heartbeat", requireRobotRuntimeAuth, (req, res) => {
  const runtimeToken = getRuntimeTokenFromRequest(req);
  const runtime = runtimeRegistry.updateHeartbeat({
    runtimeId: req.body?.runtimeId,
    runtimeToken,
    status: req.body?.status ?? {}
  });

  if (!runtime) {
    res.status(401).json({
      ok: false,
      error: "Invalid robot runtime heartbeat"
    });
    return;
  }

  res.json({
    ok: true,
    online: runtimeRegistry.isRuntimeOnline(),
    serverTime: new Date().toISOString()
  });
});

app.get("/api/robot-bridge/runtime/status", requireRobotBridgeAuth, (_req, res) => {
  res.json({
    ok: true,
    runtime: runtimeRegistry.getPublicStatus()
  });
});

app.post("/api/robot-bridge/events", requireRobotRuntimeAuth, (req, res) => {
  try {
    const event = robotEventQueue.enqueueEvent(req.body ?? {});
    res.json({
      ok: true,
      event
    });
  } catch (error) {
    sendBridgeError(res, error);
  }
});

app.get("/api/robot-bridge/events/recent", requireRobotBridgeAuth, (req, res) => {
  res.json({
    ok: true,
    events: robotEventQueue.getRecentEvents({ limit: req.query.limit })
  });
});

app.get("/api/robot-bridge/events/new", requireRobotBridgeAuth, (req, res) => {
  res.json({
    ok: true,
    events: robotEventQueue.getNewEvents({
      limit: req.query.limit,
      types: req.query.types
    })
  });
});

app.post("/api/robot-bridge/events/claim", requireRobotBridgeAuth, (req, res) => {
  const body = req.body ?? {};

  res.json({
    ok: true,
    events: robotEventQueue.claimEvents({
      consumer: body.consumer ?? "kimi_claw_cloud",
      limit: body.limit ?? 10
    })
  });
});

app.get("/api/robot-bridge/events/wait", requireRobotBridgeAuth, async (req, res) => {
  const timeoutMs = clampNumber(req.query.timeoutMs, 0, 60_000, robotEventWaitTimeoutMs);
  const pollMs = clampNumber(req.query.pollMs, 100, 2_000, 500);
  const result = await robotEventQueue.waitForEvent({
    timeoutMs,
    pollMs,
    types: req.query.types
  });

  res.json({
    ok: true,
    done: result.done,
    events: result.events,
    timedOut: result.timedOut
  });
});

app.post("/api/robot-bridge/events/clear", requireRobotBridgeAuth, (req, res) => {
  const includeNew = req.body?.includeNew === true;
  const cleared = robotEventQueue.clearAll({ includeNew });

  res.json({
    ok: true,
    cleared,
    includeNew,
    stats: robotEventQueue.getStats()
  });
});

app.get("/api/robot-bridge/events/:id", requireRobotBridgeAuth, (req, res) => {
  const event = robotEventQueue.getEvent(req.params.id);
  sendEventResult(res, event);
});

app.post("/api/robot-bridge/events/:id/handled", requireRobotBridgeAuth, (req, res) => {
  const event = robotEventQueue.markHandled(req.params.id, req.body?.result ?? {});
  sendEventResult(res, event);
});

app.post("/api/robot-bridge/events/:id/ignored", requireRobotBridgeAuth, (req, res) => {
  const event = robotEventQueue.markIgnored(req.params.id, req.body?.result ?? {});
  sendEventResult(res, event);
});

app.post("/api/robot-bridge/actions", requireRobotBridgeAuth, (req, res) => {
  try {
    const action = robotActionQueue.enqueueAction(req.body ?? {});
    res.json({
      ok: true,
      action
    });
  } catch (error) {
    sendBridgeError(res, error);
  }
});

app.post("/api/robot-bridge/actions/batch", requireRobotBridgeAuth, (req, res) => {
  try {
    const actions = robotActionQueue.enqueueBatch(req.body ?? {});

    res.json({
      ok: true,
      actions
    });
  } catch (error) {
    sendBridgeError(res, error);
  }
});

app.get("/api/robot-bridge/actions/pending", (req, res) => {
  res.json({
    ok: true,
    actions: robotActionQueue.getPendingActions({ limit: req.query.limit })
  });
});

app.post("/api/robot-bridge/actions/claim", requireRobotRuntimeAuth, (req, res) => {
  const body = req.body ?? {};

  res.json({
    ok: true,
    actions: robotActionQueue.claimActions({
      consumer: body.consumer ?? "phone-browser",
      limit: body.limit ?? 10
    })
  });
});

app.get("/api/robot-bridge/actions/recent", (req, res) => {
  res.json({
    ok: true,
    actions: robotActionQueue.getRecentActions({ limit: req.query.limit })
  });
});

app.get("/api/robot-bridge/actions/:id", requireRobotBridgeAuth, (req, res) => {
  const action = robotActionQueue.getAction(req.params.id);
  sendActionResult(res, action);
});

app.get("/api/robot-bridge/actions/:id/wait", requireRobotBridgeAuth, async (req, res) => {
  const actionId = req.params.id;
  const timeoutMs = clampNumber(
    req.query.timeoutMs,
    0,
    30_000,
    robotActionWaitTimeoutMs
  );
  const pollMs = clampNumber(req.query.pollMs, 100, 2_000, 500);
  const started = Date.now();

  let action = robotActionQueue.getAction(actionId);

  if (!action) {
    res.status(404).json({
      ok: false,
      error: "Robot bridge action not found"
    });
    return;
  }

  while (!isTerminalAction(action) && Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    action = robotActionQueue.getAction(actionId);

    if (!action) {
      res.status(404).json({
        ok: false,
        error: "Robot bridge action not found"
      });
      return;
    }
  }

  const done = isTerminalAction(action);

  res.json({
    ok: true,
    done,
    action,
    timedOut: !done
  });
});

app.post("/api/robot-bridge/actions/:id/complete", requireRobotRuntimeAuth, (req, res) => {
  const action = robotActionQueue.completeAction(req.params.id, req.body?.result ?? {});
  sendActionResult(res, action);
});

app.post("/api/robot-bridge/actions/:id/fail", requireRobotRuntimeAuth, (req, res) => {
  const action = robotActionQueue.failAction(req.params.id, req.body?.error ?? "Action failed");
  sendActionResult(res, action);
});

app.post("/api/robot-bridge/actions/:id/reject", requireRobotRuntimeAuth, (req, res) => {
  const action = robotActionQueue.rejectAction(
    req.params.id,
    req.body?.error ?? "Action rejected"
  );
  sendActionResult(res, action);
});

app.post("/api/robot-bridge/actions/clear", requireRobotBridgeAuth, (req, res) => {
  const includePending = req.body?.includePending === true;
  const cleared = robotActionQueue.clearAll({ includePending });

  res.json({
    ok: true,
    cleared,
    includePending,
    stats: robotActionQueue.getStats()
  });
});

app.post("/api/memory/write", requireMemoryAccess, async (req, res) => {
  try {
    const result = await memoryStore.writeMemory({
      type: req.body?.type,
      text: req.body?.text,
      metadata: req.body?.metadata ?? {}
    });

    res.json({
      ok: true,
      memory: result,
      writtenTo: result.path
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.get("/api/memory/context", requireMemoryAccess, async (_req, res) => {
  try {
    res.json({
      ok: true,
      memory: await memoryStore.getCompactMemoryContext()
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.get("/api/memory/learned-phrases", requireMemoryAccess, async (_req, res) => {
  try {
    res.json({
      ok: true,
      phrases: await learnedPhraseStore.listPhrases()
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.post("/api/memory/learned-phrases", requireMemoryAccess, async (req, res) => {
  try {
    rejectSecretLikeLearnedPhrase(req.body ?? {});
    const entry = await addLearnedPhraseAndRemember(req.body ?? {}, "manual");

    res.json({
      ok: true,
      phrase: entry
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.delete("/api/memory/learned-phrases/:id", requireMemoryAccess, async (req, res) => {
  try {
    const result = await learnedPhraseStore.removePhrase(req.params.id);

    if (!result) {
      res.status(404).json({
        ok: false,
        error: "learned phrase not found"
      });
      return;
    }

    res.json({
      ok: true,
      removed: result
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.post("/api/memory/learned-phrases/:id/use", requireMemoryAccess, async (req, res) => {
  try {
    const phrase = await learnedPhraseStore.recordUse(req.params.id);

    if (!phrase) {
      res.status(404).json({
        ok: false,
        error: "learned phrase not found"
      });
      return;
    }

    res.json({
      ok: true,
      phrase
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.get("/api/memory/stats", requireMemoryAccess, async (_req, res) => {
  try {
    const [stats, phrases] = await Promise.all([
      memoryStore.getMemoryStats(),
      learnedPhraseStore.listPhrases()
    ]);

    res.json({
      ok: true,
      stats: {
        ...stats,
        learnedPhraseCount: phrases.length
      }
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.get("/api/robot-bridge/memory/context", requireRobotBridgeAuth, async (_req, res) => {
  try {
    res.json({
      ok: true,
      memory: await memoryStore.getCompactMemoryContext()
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.post("/api/robot-bridge/memory/write", requireRobotBridgeAuth, async (req, res) => {
  try {
    const result = await memoryStore.writeMemory({
      type: req.body?.type,
      text: req.body?.text,
      metadata: {
        source: "kimi_claw",
        ...(req.body?.metadata ?? {})
      }
    });

    res.json({
      ok: true,
      memory: result,
      writtenTo: result.path
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.get("/api/robot-bridge/memory/learned-phrases", requireRobotBridgeAuth, async (_req, res) => {
  try {
    res.json({
      ok: true,
      phrases: await learnedPhraseStore.listPhrases()
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

app.post("/api/robot-bridge/memory/learned-phrases", requireRobotBridgeAuth, async (req, res) => {
  try {
    rejectSecretLikeLearnedPhrase(req.body ?? {});
    const entry = await addLearnedPhraseAndRemember(req.body ?? {}, "kimi_claw");

    res.json({
      ok: true,
      phrase: entry
    });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

// Placeholder: POST /api/agent/message
// Placeholder: POST /api/agent/tool-results

function requireRobotBridgeAuth(req, res, next) {
  if (verifyRobotBridgeAuth(req)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Unauthorized robot bridge request"
  });
}

function requireRobotRuntimeAuth(req, res, next) {
  if (verifyRuntimeAuth(req)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Unauthorized robot runtime request"
  });
}

function requireMemoryAccess(req, res, next) {
  if (isLocalRequest(req) || verifyRuntimeAuth(req) || verifyRobotBridgeAuth(req)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Unauthorized memory request"
  });
}

function requireLocalBrainAccess(req, res, next) {
  if (!localBrainRequireLocalNetwork || isLocalRequest(req) || isPrivateLanRequest(req)) {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    error: "Local brain endpoint requires localhost or private LAN access."
  });
}

function requireEsp32GatewayAccess(req, res, next) {
  if (
    isLocalRequest(req) ||
    isPrivateLanRequest(req) ||
    verifyActualRuntimeToken(req) ||
    process.env.ROBOT_ESP32_GATEWAY_ALLOW_PUBLIC === "true"
  ) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error:
      "Unauthorized ESP32 gateway request. Use local/LAN access or register the phone runtime first."
  });
}

function verifyRobotBridgeAuth(req) {
  const localRequest = isLocalRequest(req);

  if (localRequest && process.env.ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL === "true") {
    return true;
  }

  if (process.env.ROBOT_BRIDGE_ALLOW_UNAUTH_LAN === "true" && isPrivateLanRequest(req)) {
    return true;
  }

  if (requireHttpsForExternal && !localRequest && !isHttpsRequest(req)) {
    return false;
  }

  const expectedToken = process.env.ROBOT_BRIDGE_TOKEN;

  if (!expectedToken) {
    return false;
  }

  const authHeader = req.get("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  const bearerToken = authHeader.startsWith(bearerPrefix)
    ? authHeader.slice(bearerPrefix.length)
    : "";
  const headerToken = req.get("x-robot-bridge-token") ?? "";

  return bearerToken === expectedToken || headerToken === expectedToken;
}

function verifyRuntimeAuth(req) {
  if (!requireRuntimeAuth) {
    return true;
  }

  return verifyActualRuntimeToken(req);
}

function verifyActualRuntimeToken(req) {
  const runtimeToken = getRuntimeTokenFromRequest(req);
  const expectedBridgeToken = process.env.ROBOT_BRIDGE_TOKEN;

  if (!runtimeToken || (expectedBridgeToken && runtimeToken === expectedBridgeToken)) {
    return false;
  }

  return Boolean(runtimeRegistry.verifyRuntimeToken(runtimeToken));
}

function getRuntimeTokenFromRequest(req) {
  const authHeader = req.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  return bearerToken || req.get("x-robot-runtime-token") || "";
}

function isLocalRequest(req) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "";
  const forwardedFor = String(req.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const host = req.hostname ?? "";

  if (forwardedFor) {
    return (
      forwardedFor === "127.0.0.1" ||
      forwardedFor === "::1" ||
      forwardedFor === "::ffff:127.0.0.1"
    );
  }

  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

function isPrivateLanRequest(req) {
  const ip = getClientIp(req);

  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function getClientIp(req) {
  const forwardedFor = String(req.get("x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const rawIp = forwardedFor || req.ip || req.socket?.remoteAddress || "";

  return String(rawIp)
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");
}

function isHttpsRequest(req) {
  return req.secure || String(req.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

function isTerminalAction(action) {
  return ["completed", "failed", "rejected"].includes(action?.status);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : min;

  if (!Number.isFinite(numericValue)) {
    return Math.min(max, Math.max(min, fallbackValue));
  }

  return Math.min(max, Math.max(min, numericValue));
}

function sendBridgeError(res, error) {
  const statusCode = error.statusCode ?? 500;

  res.status(statusCode).json({
    ok: false,
    error: statusCode === 500 ? "Robot bridge error" : error.message
  });
}

function sendActionResult(res, action) {
  if (!action) {
    res.status(404).json({
      ok: false,
      error: "Robot bridge action not found"
    });
    return;
  }

  res.json({
    ok: true,
    action
  });
}

function sendEventResult(res, event) {
  if (!event) {
    res.status(404).json({
      ok: false,
      error: "Robot event not found"
    });
    return;
  }

  res.json({
    ok: true,
    event
  });
}

function sendMemoryError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;

  res.status(statusCode).json({
    ok: false,
    error: statusCode === 500 ? "Memory request failed" : error.message
  });
}

async function addLearnedPhraseAndRemember(body = {}, fallbackSource = "manual") {
  const entry = await learnedPhraseStore.addPhrase({
    phrase: body.phrase,
    meaning: body.meaning,
    action: body.action,
    args: body.args ?? {},
    confidence: body.confidence ?? "medium",
    source: body.source ?? fallbackSource
  });

  await memoryStore.appendLongTermMemory(
    `Learned phrase "${entry.phrase}" means "${entry.meaning || entry.action}" and maps to ${entry.action}.`,
    {
      source: entry.source,
      importance: entry.confidence,
      memory_type: "learned_phrase"
    }
  );

  return entry;
}

function rejectSecretLikeLearnedPhrase(entry = {}) {
  const value = [
    entry.phrase,
    entry.meaning,
    typeof entry.args === "object" ? JSON.stringify(entry.args) : ""
  ].join(" ");

  if (looksLikeSecret(value)) {
    throw Object.assign(new Error("learned phrase appears to contain a token, API key, or password"), {
      statusCode: 400
    });
  }
}

function normalizeLocalBrainProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "rule", "ollama", "openai-compatible"].includes(provider)
    ? provider
    : "mock";
}

function defaultLocalBrainModel(provider) {
  return {
    mock: "mock",
    rule: "rule",
    ollama: "",
    "openai-compatible": ""
  }[provider] ?? "mock";
}

function serverLog(message, level = "info") {
  const prefix = level === "warn" ? "WARN" : level === "error" ? "ERROR" : "INFO";
  console.log(`[LOCAL_BRAIN:${prefix}] ${message}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(`[BOOT] Server startup failed: ${error.message}`);
    process.exit(1);
  });
}

export { app, robotActionQueue, robotEventQueue, verifyRobotBridgeAuth };

async function startServer() {
  if (esp32ConnectOnStart) {
    console.log(`[BOOT] Connecting to ESP32 before server start: ${esp32DefaultWsUrl}`);
    try {
      await esp32Gateway.connect(esp32DefaultWsUrl, {
        timeoutMs: esp32ConnectTimeoutMs
      });
      console.log(`[BOOT] ESP32 connected: ${esp32DefaultWsUrl}`);
    } catch (error) {
      console.warn(`[BOOT] ESP32 preconnect skipped: ${error.message}`);
      console.warn("[BOOT] Server will still start. Connect ESP32 from the UI when the robot is reachable.");
    }
  }

  app.listen(port, () => {
    console.log(`LOOI Life Server listening on http://localhost:${port}`);
  });
}
