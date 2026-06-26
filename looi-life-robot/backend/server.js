import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGeminiLiveRelaySession,
  createGeminiLiveRelay
} from "./lib/gemini/geminiLiveRelay.js";
import { getGeminiLiveEnv } from "./lib/gemini/geminiLiveToken.js";
import { createLocalBrainServerFromEnv } from "./lib/localBrain/localBrainServer.js";
// DISABLED_ROBOFLOW_FOLLOW: keep lib/roboflow/webrtcProxy.js and the package dependency
// for easy restoration, but do not import or expose Roboflow routes while follow is disabled.
// import {
//   fetchRoboflowTurnConfig,
//   getRoboflowWebrtcEnv,
//   initializeRoboflowWebrtcWorker,
//   isRoboflowWorkflowError,
//   publicRoboflowWebrtcConfig,
//   terminateRoboflowPipeline
// } from "./lib/roboflow/webrtcProxy.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const serverTraceEnabled = process.env.SERVER_TRACE === "true" || process.env.API_TRACE === "true";
const serverTracePollEndpoints =
  process.env.SERVER_TRACE_POLL_ENDPOINTS === "true" ||
  process.env.API_TRACE_POLL_ENDPOINTS === "true";
const serverTraceRequestBodies = process.env.SERVER_TRACE_REQUEST_BODIES !== "false";
const serverTraceResponseBodies = process.env.SERVER_TRACE_RESPONSE_BODIES !== "false";
let apiTraceCounter = 0;
let lastServerLogEntry = null;
const localBrainProvider = normalizeLocalBrainProvider(process.env.LOCAL_BRAIN_PROVIDER);
const localBrainModel = process.env.LOCAL_BRAIN_MODEL || defaultLocalBrainModel(localBrainProvider);
const localBrainServer = createLocalBrainServerFromEnv(process.env, serverLog);
const localBrainRequireLocalNetwork = process.env.LOCAL_BRAIN_REQUIRE_LOCAL_NETWORK === "true";
const geminiLiveConfig = getGeminiLiveEnv(process.env);
const geminiLiveRelay = createGeminiLiveRelay({
  env: process.env,
  logger: geminiLog
});
const serveFrontend = process.env.SERVE_FRONTEND !== "false";
// DISABLED_ROBOFLOW_FOLLOW: const roboflowWebrtcConfig = getRoboflowWebrtcEnv(process.env);

// Only public, browser-safe config lives here.
const PUBLIC_CONFIG = {
  backendBaseUrl: String(process.env.PUBLIC_BACKEND_BASE_URL || "").trim(),
  bodyTransport: "web_bluetooth",
  esp32ConnectionMode: "web_bluetooth",
  maxSpeed: 0.4,
  maxDurationMs: 1000,
  localFirstMode: true,
  localBrainMaxThoughtsPerMinute: Number(process.env.LOCAL_BRAIN_MAX_THOUGHTS_PER_MINUTE || 12),
  localBrainServerEnabled: process.env.LOCAL_BRAIN_ENABLED !== "false",
  localBrainProvider,
  localBrainModel,
  geminiLiveEnabled: geminiLiveConfig.enabled,
  geminiLiveConfigured: geminiLiveConfig.configured,
  geminiLiveModel: geminiLiveConfig.model,
  geminiLiveVoice: geminiLiveConfig.voice,
  geminiLiveThinkingLevel: geminiLiveConfig.thinkingLevel,
  geminiLiveTransport: "server_relay",
  geminiLiveContextCompression: geminiLiveConfig.contextCompression,
  geminiLiveSessionResumption: geminiLiveConfig.sessionResumption,
  geminiLiveSlidingWindowTokens: geminiLiveConfig.slidingWindowTokens,
  // DISABLED_ROBOFLOW_FOLLOW: Roboflow public config is intentionally hidden.
  // roboflowWebrtc: publicRoboflowWebrtcConfig(roboflowWebrtcConfig),
  // roboflowWebrtcProxyUrl: "/api/init-webrtc",
  // roboflowWebrtcTurnConfigUrl: "/api/roboflow-webrtc/turn-config",
  // roboflowWebrtcTerminateUrl: "/api/roboflow-webrtc/terminate",
  geminiVisionAssistDefault: true,
  geminiVisionAssistIntervalMs: 1500,
  // DISABLED_ROBOFLOW_FOLLOW: object detection/follow tuning config is intentionally hidden.
  // objectDetectionProvider: "roboflow_webrtc",
  // objectDetectorMaxResults: 12,
  // objectDetectorModuleUrl: "/vendor/roboflow-inference-sdk/index.es.js",
  // followLostTimeoutMs: 3000,
  // followTargetCenterX: 0.5,
  // followCenterDeadband: 0.14,
  // maxObjectFollowSpeed: 0.2,
  // followCommandDurationMs: 300,
  // followCommandRefreshMs: 100,
  // followMaxDetectionAgeMs: 300,
  localBrainEventTimeoutMs: Number(process.env.LOCAL_BRAIN_EVENT_TIMEOUT_MS || 12000),
  attentionWindowMs: Number(process.env.LOOI_ATTENTION_WINDOW_MS || 20000),
  conversationWindowMs: Number(process.env.LOOI_CONVERSATION_WINDOW_MS || 30000),
  localBrainEventCooldownMs: Number(process.env.LOCAL_BRAIN_EVENT_COOLDOWN_MS || 800),
  performanceMonitorEnabledDefault: true,
  cameraObservationPostMs: 3000,
  cameraSnapshotMaxWidth: 320
};

app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(apiTraceMiddleware);
// DISABLED_ROBOFLOW_FOLLOW: keep the dependency installed, but do not serve the browser SDK.
// app.use(
//   "/vendor/roboflow-inference-sdk",
//   express.static(path.join(__dirname, "node_modules", "@roboflow", "inference-sdk", "dist"))
// );
if (serveFrontend) {
  app.use(express.static(path.join(__dirname, "..", "frontend")));
}

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

// DISABLED_ROBOFLOW_FOLLOW: Roboflow WebRTC routes are intentionally not registered.
// app.get("/api/roboflow-webrtc/status", requireRoboflowWebrtcAccess, (_req, res) => {});
// app.get("/api/roboflow-webrtc/turn-config", requireRoboflowWebrtcAccess, async (_req, res) => {});
// app.post("/api/init-webrtc", requireRoboflowWebrtcAccess, async (req, res) => {});
// app.post("/api/roboflow-webrtc/terminate", requireRoboflowWebrtcAccess, async (req, res) => {});

app.post("/api/gemini-live/session", requireGeminiLiveAccess, async (req, res) => {
  const startedAt = Date.now();

  if (!geminiLiveConfig.enabled) {
    res.status(404).json({
      ok: false,
      error: "Agent is disabled."
    });
    return;
  }

  geminiLog("RELAY SESSION request");

  try {
    const session = buildGeminiLiveRelaySession({
      request: req,
      env: process.env,
      path: geminiLiveRelay.path
    });
    geminiLog(`RELAY SESSION ok latency=${Date.now() - startedAt}ms`);
    res.json(session);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    geminiLog(`RELAY SESSION failed status=${statusCode} error="${shortServerLogText(error.message)}"`, "warn");
    res.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/api/gemini-live/token", requireGeminiLiveAccess, async (req, res) => {
  if (!geminiLiveConfig.enabled) {
    res.status(404).json({
      ok: false,
      error: "Agent is disabled."
    });
    return;
  }

  const session = buildGeminiLiveRelaySession({
    request: req,
    env: process.env,
    path: geminiLiveRelay.path
  });
  res.json(session);
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
  const startedAt = Date.now();
  serverLog(
    `HTTP THINK request reason=${req.body?.reason ?? "manual"} trigger=${req.body?.triggerEvent?.type ?? "none"} text="${shortServerLogText(req.body?.triggerEvent?.payload?.text ?? req.body?.triggerEvent?.text ?? "")}"`
  );
  const response = await localBrainServer.think({
    reason: req.body?.reason ?? "manual",
    triggerEvent: req.body?.triggerEvent ?? null,
    context: req.body?.context ?? {}
  });

  serverLog(
    `HTTP THINK response ok=${response.ok !== false} provider=${response.provider} model=${response.model} latency=${Date.now() - startedAt}ms action=${response.action?.type || "none"} reason="${shortServerLogText(response.reason)}"`,
    response.ok === false ? "warn" : "info"
  );
  res.status(response.ok === false ? 502 : 200).json(response);
});

app.post("/api/local-brain/chat", requireLocalBrainAccess, async (req, res) => {
  const startedAt = Date.now();
  serverLog(
    `HTTP CHAT request reason=${req.body?.reason ?? "manual"} message="${shortServerLogText(req.body?.message ?? "")}"`
  );
  const response = await localBrainServer.chat({
    message: req.body?.message ?? "",
    context: req.body?.context ?? {},
    reason: req.body?.reason ?? "manual"
  });

  serverLog(
    `HTTP CHAT response ok=${response.ok !== false} provider=${response.provider} model=${response.model} latency=${Date.now() - startedAt}ms action=${response.action?.type || "none"} reason="${shortServerLogText(response.reason)}"`,
    response.ok === false ? "warn" : "info"
  );
  res.status(response.ok === false ? 502 : 200).json(response);
});

function apiTraceMiddleware(req, res, next) {
  if (!serverTraceEnabled || !req.path.startsWith("/api/")) {
    next();
    return;
  }

  const traceId = createApiTraceId();
  const startedAt = Date.now();
  const requestPath = req.originalUrl || req.url || req.path;
  const pollEndpoint = isHighFrequencyApiPath(req.path);

  res.locals.apiTraceId = traceId;

  if (serverTraceResponseBodies) {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      res.locals.apiTraceResponse = summarizeApiResponseBody(req, body);
      return originalJson(body);
    };
  }

  if (!pollEndpoint || serverTracePollEndpoints) {
    apiLog(
      `${traceId} REQUEST ${req.method} ${requestPath} client=${getClientIp(req) || "unknown"} body=${safeJson(summarizeApiRequestBody(req))}`
    );
  }

  res.on("finish", () => {
    const statusCode = res.statusCode;

    if (pollEndpoint && !serverTracePollEndpoints && statusCode < 400) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    const responseSummary =
      serverTraceResponseBodies && res.locals.apiTraceResponse !== undefined
        ? ` response=${safeJson(res.locals.apiTraceResponse)}`
        : "";

    apiLog(
      `${traceId} RESPONSE ${req.method} ${requestPath} status=${statusCode} duration=${durationMs}ms${responseSummary}`,
      level
    );
  });

  next();
}

function summarizeApiRequestBody(req) {
  if (!serverTraceRequestBodies) {
    return "[request_body_logging_disabled]";
  }

  const body = req.body ?? null;

  if (!body || typeof body !== "object") {
    return body;
  }

  if (req.path === "/api/local-brain/think") {
    return {
      reason: body.reason ?? "manual",
      triggerEvent: summarizeTriggerEvent(body.triggerEvent),
      context: summarizeRuntimeContext(body.context)
    };
  }

  if (req.path === "/api/local-brain/chat") {
    return {
      reason: body.reason ?? "manual",
      message: shortServerLogText(body.message, 240),
      context: summarizeRuntimeContext(body.context)
    };
  }

  // DISABLED_ROBOFLOW_FOLLOW: Roboflow request-body tracing is disabled with the routes.
  // if (req.path === "/api/init-webrtc") {}
  // if (req.path === "/api/roboflow-webrtc/terminate") {}

  return redactAndCompact(body);
}

function summarizeApiResponseBody(req, body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  if (req.path.startsWith("/api/local-brain/")) {
    return {
      ok: body.ok,
      provider: body.provider ?? body.brain?.provider ?? null,
      model: body.model ?? body.brain?.model ?? null,
      available: body.brain?.available,
      latencyMs: body.latencyMs,
      action: body.action
        ? {
            type: body.action?.type,
            args: redactAndCompact(body.action?.args)
          }
        : undefined,
      reason: shortServerLogText(body.reason, 160),
      error: body.error ? shortServerLogText(body.error, 240) : undefined
    };
  }

  if (req.path === "/api/config") {
    return {
      localFirstMode: body.localFirstMode,
      localBrainProvider: body.localBrainProvider,
      localBrainModel: body.localBrainModel,
      geminiLiveEnabled: body.geminiLiveEnabled,
      geminiLiveConfigured: body.geminiLiveConfigured,
      // DISABLED_ROBOFLOW_FOLLOW: Roboflow config is not public while disabled.
      // roboflowWebrtcEnabled: body.roboflowWebrtc?.enabled,
      // roboflowWebrtcConfigured: body.roboflowWebrtc?.configured,
      // objectDetectionProvider: body.objectDetectionProvider,
      esp32ConnectionMode: body.esp32ConnectionMode
    };
  }

  // DISABLED_ROBOFLOW_FOLLOW: Roboflow response tracing is disabled with the routes.
  // if (req.path === "/api/init-webrtc" || req.path.startsWith("/api/roboflow-webrtc/")) {}

  if (req.path === "/api/gemini-live/session" || req.path === "/api/gemini-live/token") {
    return {
      ok: body.ok,
      transport: body.transport,
      websocketUrl: body.websocketUrl ? geminiLiveRelay.path : undefined,
      error: body.error ? shortServerLogText(body.error, 240) : undefined
    };
  }

  return redactAndCompact(body);
}

function summarizeTriggerEvent(event = null) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};

  return {
    type: event.type ?? null,
    text: shortServerLogText(payload.text ?? event.text ?? "", 240),
    shouldImmediateStop: event.shouldImmediateStop ?? payload.shouldImmediateStop
  };
}

function summarizeRuntimeContext(context = null) {
  if (!context || typeof context !== "object") {
    return null;
  }

  return {
    lifeState: context.lifeState
      ? {
          mood: context.lifeState.mood,
          energy: context.lifeState.energy,
          userVisible: context.lifeState.userVisible,
          userPosition: context.lifeState.userPosition,
          userDistance: context.lifeState.userDistance
        }
      : null
  };
}

function summarizeTelemetry(telemetry = null) {
  if (!telemetry || typeof telemetry !== "object") {
    return telemetry ?? null;
  }

  return {
    type: telemetry.type,
    battery: telemetry.battery,
    rssi: telemetry.rssi,
    motor_state: telemetry.motor_state
  };
}

function summarizeWebrtcParams(wrtcParams = null) {
  if (!wrtcParams || typeof wrtcParams !== "object") {
    return null;
  }

  return {
    hasWorkflowSpec: Boolean(wrtcParams.workflowSpec),
    workspaceName: shortServerLogText(wrtcParams.workspaceName, 100),
    workflowId: shortServerLogText(wrtcParams.workflowId, 100),
    imageInputName: wrtcParams.imageInputName,
    streamOutputNames: Array.isArray(wrtcParams.streamOutputNames)
      ? wrtcParams.streamOutputNames.slice(0, 12)
      : undefined,
    dataOutputNames: Array.isArray(wrtcParams.dataOutputNames)
      ? wrtcParams.dataOutputNames.slice(0, 12)
      : undefined,
    threadPoolWorkers: wrtcParams.threadPoolWorkers,
    processingTimeout: wrtcParams.processingTimeout,
    requestedPlan: wrtcParams.requestedPlan,
    requestedRegion: wrtcParams.requestedRegion,
    iceServers: Array.isArray(wrtcParams.iceServers) ? wrtcParams.iceServers.length : undefined
  };
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

function requireGeminiLiveAccess(req, res, next) {
  if (isGeminiLiveRequestAllowed(req)) {
    next();
    return;
  }

  res.status(403).json({
      ok: false,
      error:
      "Agent endpoint requires localhost, private LAN, or public relay access for temporary public testing."
  });
}

function isGeminiLiveRequestAllowed(req) {
  return (
    isLocalRequest(req) ||
    isPrivateLanRequest(req) ||
    process.env.GEMINI_LIVE_ALLOW_PUBLIC_RELAY === "true" ||
    process.env.GEMINI_LIVE_ALLOW_PUBLIC_TOKEN === "true"
  );
}

// DISABLED_ROBOFLOW_FOLLOW: kept as comment for restoring Roboflow route auth later.
// function requireRoboflowWebrtcAccess(req, res, next) {}

function isLocalRequest(req) {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "";
  const forwardedFor = String(getRequestHeader(req, "x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const host = req.hostname ?? String(getRequestHeader(req, "host") ?? "").split(":")[0];

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
  const forwardedFor = String(getRequestHeader(req, "x-forwarded-for") ?? "")
    .split(",")[0]
    .trim();
  const rawIp = forwardedFor || req.ip || req.socket?.remoteAddress || "";

  return String(rawIp)
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");
}

function getRequestHeader(req, name) {
  if (typeof req?.get === "function") {
    return req.get(name);
  }

  return req?.headers?.[String(name).toLowerCase()];
}

// DISABLED_ROBOFLOW_FOLLOW: kept as comment for restoring Roboflow route errors later.
// function sendRoboflowWebrtcError(res, error, action = "request") {}

function normalizeLocalBrainProvider(value) {
  const provider = String(value || "mock").trim().toLowerCase();
  return ["mock", "rule", "ollama", "groq", "fireworks", "openai-compatible"].includes(provider)
    ? provider
    : "mock";
}

function defaultLocalBrainModel(provider) {
  return {
    mock: "mock",
    rule: "rule",
    ollama: "",
    groq: "llama-3.1-8b-instant",
    fireworks: "accounts/fireworks/models/gpt-oss-20b",
    "openai-compatible": ""
  }[provider] ?? "mock";
}

function redactAndCompact(value, { key = "", depth = 0 } = {}) {
  if (shouldRedactKey(key)) {
    return "[REDACTED]";
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === "string") {
    if (looksLikeDataUrl(value)) {
      return `[data_url_omitted chars=${value.length}]`;
    }

    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 240 ? `${compact.slice(0, 240)}... [${compact.length} chars]` : compact;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (depth >= 4) {
    return Array.isArray(value)
      ? `[array length=${value.length}]`
      : `[object keys=${Object.keys(value).slice(0, 10).join(",")}]`;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 8).map((item) => redactAndCompact(item, { depth: depth + 1 }));
    if (value.length > items.length) {
      items.push(`[${value.length - items.length} more]`);
    }
    return items;
  }

  const result = {};
  const entries = Object.entries(value).slice(0, 24);

  for (const [entryKey, entryValue] of entries) {
    if (shouldRedactKey(entryKey)) {
      result[entryKey] = "[REDACTED]";
    } else if (shouldOmitLargeKey(entryKey)) {
      result[entryKey] = "[OMITTED]";
    } else {
      result[entryKey] = redactAndCompact(entryValue, {
        key: entryKey,
        depth: depth + 1
      });
    }
  }

  const omittedCount = Object.keys(value).length - entries.length;
  if (omittedCount > 0) {
    result.__omittedKeys = omittedCount;
  }

  return result;
}

function shouldRedactKey(key = "") {
  return /(authorization|bearer|cookie|api[_-]?key|token|secret|password|pairing)/i.test(String(key));
}

function shouldOmitLargeKey(key = "") {
  return /(dataurl|data_url|image|snapshot|base64|audio|video|blob)/i.test(String(key));
}

function looksLikeDataUrl(value = "") {
  return /^data:(image|audio|video)\//i.test(value);
}

function isHighFrequencyApiPath(pathname = "") {
  return [
    "/api/health",
    "/api/config"
  ].includes(pathname);
}

function createApiTraceId() {
  apiTraceCounter += 1;
  return `api_${Date.now()}_${apiTraceCounter}`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function apiLog(message, level = "info") {
  serverLog(message, level, "API");
}

function geminiLog(message, level = "info") {
  serverLog(message, level, "AGENT");
}

function serverLog(message, level = "info", scope = "LOCAL_BRAIN") {
  const prefix = level === "warn" ? "WARN" : level === "error" ? "ERROR" : "INFO";
  const line = `[${scope}:${prefix}] ${message}`;

  if (line === lastServerLogEntry) {
    return;
  }

  lastServerLogEntry = line;
  console.log(line);
}

function shortServerLogText(value, maxLength = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(`[BOOT] Server startup failed: ${error.message}`);
    process.exit(1);
  });
}

export { app };

async function startServer() {
  console.log(
    `[BOOT] Local brain provider=${localBrainProvider} model=${localBrainModel || "(not set)"} trace=${process.env.LOCAL_BRAIN_TRACE === "true"}`
  );
  console.log(
    `[BOOT] Agent enabled=${geminiLiveConfig.enabled} configured=${geminiLiveConfig.configured}`
  );
  // DISABLED_ROBOFLOW_FOLLOW: Roboflow boot logging is disabled with the routes.
  // console.log(`[BOOT] Roboflow WebRTC enabled=${roboflowWebrtcConfig.enabled}`);
  console.log(
    `[BOOT] Server API trace=${serverTraceEnabled} pollTrace=${serverTracePollEndpoints} bodyTransport=web_bluetooth serveFrontend=${serveFrontend}`
  );

  const httpServer = http.createServer(app);
  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname !== geminiLiveRelay.path) {
      socket.destroy();
      return;
    }

    if (!isGeminiLiveRequestAllowed(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!geminiLiveConfig.enabled || !geminiLiveConfig.configured) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    geminiLiveRelay.handleUpgrade(request, socket, head);
  });

  httpServer.listen(port, () => {
    console.log(`LOOI Life Server listening on http://localhost:${port}`);
  });
}
