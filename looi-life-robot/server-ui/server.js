import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESP32Gateway } from "./lib/esp32Gateway.js";
import { createGeminiLiveTokenFromEnv, getGeminiLiveEnv } from "./lib/gemini/geminiLiveToken.js";
import { createLocalBrainServerFromEnv } from "./lib/localBrain/localBrainServer.js";
import { LearnedPhraseStore } from "./lib/memory/learnedPhraseStore.js";
import { MemoryStore, looksLikeSecret } from "./lib/memory/memoryStore.js";
import {
  fetchRoboflowTurnConfig,
  getRoboflowWebrtcEnv,
  initializeRoboflowWebrtcWorker,
  isRoboflowWorkflowError,
  publicRoboflowWebrtcConfig,
  terminateRoboflowPipeline
} from "./lib/roboflow/webrtcProxy.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const esp32DefaultWsUrl = process.env.ESP32_DEFAULT_WS_URL || "ws://192.168.4.1:81";
const esp32ConnectOnStart = process.env.ESP32_CONNECT_ON_START === "true";
const esp32ConnectTimeoutMs = Number(process.env.ESP32_CONNECT_TIMEOUT_MS || 8000);
const serverTraceEnabled = process.env.SERVER_TRACE === "true" || process.env.API_TRACE === "true";
const serverTracePollEndpoints =
  process.env.SERVER_TRACE_POLL_ENDPOINTS === "true" ||
  process.env.API_TRACE_POLL_ENDPOINTS === "true";
const serverTraceRequestBodies = process.env.SERVER_TRACE_REQUEST_BODIES !== "false";
const serverTraceResponseBodies = process.env.SERVER_TRACE_RESPONSE_BODIES !== "false";
let apiTraceCounter = 0;
let lastServerLogEntry = null;
const esp32Gateway = new ESP32Gateway({
  connectTimeoutMs: esp32ConnectTimeoutMs,
  logger: {
    info: (message) => esp32Log(message),
    warn: (message) => esp32Log(message, "warn"),
    error: (message) => esp32Log(message, "error")
  }
});
const memoryStore = new MemoryStore();
const learnedPhraseStore = new LearnedPhraseStore();
const localBrainProvider = normalizeLocalBrainProvider(process.env.LOCAL_BRAIN_PROVIDER);
const localBrainModel = process.env.LOCAL_BRAIN_MODEL || defaultLocalBrainModel(localBrainProvider);
const localBrainServer = createLocalBrainServerFromEnv(process.env, serverLog);
const localBrainRequireLocalNetwork = process.env.LOCAL_BRAIN_REQUIRE_LOCAL_NETWORK === "true";
const geminiLiveConfig = getGeminiLiveEnv(process.env);
const roboflowWebrtcConfig = getRoboflowWebrtcEnv(process.env);

// Only public, browser-safe config lives here.
const PUBLIC_CONFIG = {
  defaultEsp32WsUrl: esp32DefaultWsUrl,
  esp32ConnectionMode: "server_gateway",
  esp32ConnectOnStart,
  maxSpeed: 0.4,
  maxDurationMs: 1000,
  localFirstMode: true,
  localBrainDefaultEnabled: true,
  localBrainMaxThoughtsPerMinute: Number(process.env.LOCAL_BRAIN_MAX_THOUGHTS_PER_MINUTE || 12),
  localBrainServerEnabled: process.env.LOCAL_BRAIN_ENABLED !== "false",
  localBrainProvider,
  localBrainModel,
  geminiLiveEnabled: geminiLiveConfig.enabled,
  geminiLiveConfigured: geminiLiveConfig.configured,
  geminiLiveModel: geminiLiveConfig.model,
  geminiLiveVoice: geminiLiveConfig.voice,
  geminiLiveThinkingLevel: geminiLiveConfig.thinkingLevel,
  roboflowWebrtc: publicRoboflowWebrtcConfig(roboflowWebrtcConfig),
  roboflowWebrtcProxyUrl: "/api/init-webrtc",
  roboflowWebrtcTurnConfigUrl: "/api/roboflow-webrtc/turn-config",
  roboflowWebrtcTerminateUrl: "/api/roboflow-webrtc/terminate",
  geminiVisionAssistDefault: true,
  geminiVisionAssistIntervalMs: 1500,
  localVisionEnabled: true,
  objectDetectionEnabledDefault: false,
  objectDetectionProvider: "roboflow_webrtc",
  objectDetectorMaxResults: 12,
  objectDetectorModuleUrl: "/vendor/roboflow-inference-sdk/index.es.js",
  followLostTimeoutMs: 2000,
  maxObjectFollowSpeed: 0.18,
  localBrainEventTimeoutMs: Number(process.env.LOCAL_BRAIN_EVENT_TIMEOUT_MS || 12000),
  alwaysListeningDefault: false,
  audioLevelMonitorDefault: false,
  wakeNamesDefault: ["looi", "louie", "lui", "robot"],
  attentionWindowMs: Number(process.env.LOOI_ATTENTION_WINDOW_MS || 20000),
  conversationWindowMs: Number(process.env.LOOI_CONVERSATION_WINDOW_MS || 30000),
  speechGateEventCooldownMs: Number(process.env.LOOI_SPEECH_GATE_EVENT_COOLDOWN_MS || 800),
  looiModeDefault: false,
  attentionBodyTrackingDefault: false,
  keepRobotAwakeDefault: false,
  performanceMonitorEnabledDefault: true,
  cameraObservationPostMs: 3000,
  cameraSnapshotMaxWidth: 320
};

app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(apiTraceMiddleware);
app.use(
  "/vendor/roboflow-inference-sdk",
  express.static(path.join(__dirname, "node_modules", "@roboflow", "inference-sdk", "dist"))
);
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

app.get("/api/roboflow-webrtc/status", requireRoboflowWebrtcAccess, (_req, res) => {
  const config = getRoboflowWebrtcEnv(process.env);
  res.json({
    ok: true,
    ...publicRoboflowWebrtcConfig(config)
  });
});

app.get("/api/roboflow-webrtc/turn-config", requireRoboflowWebrtcAccess, async (_req, res) => {
  const startedAt = Date.now();

  try {
    const iceServers = await fetchRoboflowTurnConfig(process.env);
    serverLog(
      `ROBOFLOW_WEBRTC turn config ok latency=${Date.now() - startedAt}ms iceServers=${Array.isArray(iceServers) ? iceServers.length : 0}`,
      "info",
      "VISION"
    );
    res.json({ iceServers: iceServers ?? [] });
  } catch (error) {
    sendRoboflowWebrtcError(res, error, "turn config");
  }
});

app.post("/api/init-webrtc", requireRoboflowWebrtcAccess, async (req, res) => {
  const startedAt = Date.now();

  try {
    const answer = await initializeRoboflowWebrtcWorker(req.body, process.env);
    serverLog(
      `ROBOFLOW_WEBRTC init ok latency=${Date.now() - startedAt}ms pipeline=${answer?.context?.pipeline_id ?? "unknown"}`,
      "info",
      "VISION"
    );
    res.json(answer);
  } catch (error) {
    sendRoboflowWebrtcError(res, error, "init");
  }
});

app.post("/api/roboflow-webrtc/terminate", requireRoboflowWebrtcAccess, async (req, res) => {
  const startedAt = Date.now();

  try {
    await terminateRoboflowPipeline(req.body?.pipelineId, process.env);
    serverLog(
      `ROBOFLOW_WEBRTC terminate ok latency=${Date.now() - startedAt}ms pipeline=${shortServerLogText(req.body?.pipelineId, 80)}`,
      "info",
      "VISION"
    );
    res.json({ ok: true });
  } catch (error) {
    sendRoboflowWebrtcError(res, error, "terminate");
  }
});

app.post("/api/gemini-live/token", requireGeminiLiveAccess, async (_req, res) => {
  const startedAt = Date.now();

  if (!geminiLiveConfig.enabled) {
    res.status(404).json({
      ok: false,
      error: "Gemini Live is disabled."
    });
    return;
  }

  geminiLog(
    `TOKEN request model=${geminiLiveConfig.model} voice=${geminiLiveConfig.voice} thinking=${geminiLiveConfig.thinkingLevel}`
  );

  try {
    const token = await createGeminiLiveTokenFromEnv(process.env);
    geminiLog(`TOKEN ok latency=${Date.now() - startedAt}ms expires=${token.expiresAt}`);
    res.json(token);
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    geminiLog(`TOKEN failed status=${statusCode} error="${shortServerLogText(error.message)}"`, "warn");
    res.status(statusCode).json({
      ok: false,
      error: error.message
    });
  }
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

// Local-first runtime uses the ESP32 gateway and memory endpoints below.
app.get("/api/esp32/events", requireEsp32GatewayAccess, (req, res) => {
  const since = req.get("last-event-id") || req.query.since;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": esp32 gateway event stream\n\n");

  sendEsp32Sse(res, "snapshot", {
    ok: true,
    ...esp32Gateway.getSnapshot({
      since
    })
  });

  const unsubscribe = esp32Gateway.onUpdate((snapshot) => {
    sendEsp32Sse(res, "snapshot", {
      ok: true,
      ...snapshot
    });
  });
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

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
  const targetUrl = typeof req.body?.url === "string" ? req.body.url : esp32DefaultWsUrl;
  esp32Log(`CONNECT start url=${safeLogUrl(targetUrl)} timeout=${esp32ConnectTimeoutMs}ms`);

  try {
    const status = await esp32Gateway.connect(targetUrl, {
      timeoutMs: esp32ConnectTimeoutMs
    });

    esp32Log(`CONNECT ok state=${status.state} connected=${status.connected}`);
    res.json({
      ok: true,
      status,
      telemetry: esp32Gateway.latestTelemetry,
      config: esp32Gateway.latestConfig
    });
  } catch (error) {
    esp32Log(
      `CONNECT failed url=${safeLogUrl(targetUrl)} error="${shortServerLogText(error.message)}"`,
      "warn"
    );
    res.status(502).json({
      ok: false,
      error: error.message,
      status: esp32Gateway.getStatus()
    });
  }
});

app.post("/api/esp32/disconnect", requireEsp32GatewayAccess, (req, res) => {
  const reason = req.body?.reason ?? "ui_disconnect";
  esp32Log(`DISCONNECT reason=${shortServerLogText(reason, 80)}`);
  const status = esp32Gateway.disconnect({
    reason
  });

  esp32Log(`DISCONNECT ok state=${status.state}`);
  res.json({
    ok: true,
    status
  });
});

app.post("/api/esp32/send", requireEsp32GatewayAccess, (req, res) => {
  try {
    const payload = req.body?.payload;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      esp32Log("SEND rejected payload must be an object", "warn");
      res.status(400).json({
        ok: false,
        error: "payload must be an object"
      });
      return;
    }

    esp32Log(`SEND start payload=${safeJson(summarizeEsp32Payload(payload))}`);
    const id = esp32Gateway.sendJson(payload);
    esp32Log(`SEND queued id=${id} state=${esp32Gateway.getStatus().state}`);

    res.json({
      ok: true,
      id,
      status: esp32Gateway.getStatus()
    });
  } catch (error) {
    esp32Log(`SEND failed error="${shortServerLogText(error.message)}"`, "warn");
    res.status(409).json({
      ok: false,
      error: error.message,
      status: esp32Gateway.getStatus()
    });
  }
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

  if (req.path === "/api/esp32/connect") {
    return {
      url: safeLogUrl(body.url || esp32DefaultWsUrl)
    };
  }

  if (req.path === "/api/esp32/disconnect") {
    return {
      reason: shortServerLogText(body.reason ?? "ui_disconnect", 100)
    };
  }

  if (req.path === "/api/esp32/send") {
    return {
      payload: summarizeEsp32Payload(body.payload)
    };
  }

  if (req.path === "/api/init-webrtc") {
    return {
      offer: {
        type: body.offer?.type,
        sdpChars: typeof body.offer?.sdp === "string" ? body.offer.sdp.length : 0
      },
      wrtcParams: summarizeWebrtcParams(body.wrtcParams)
    };
  }

  if (req.path === "/api/roboflow-webrtc/terminate") {
    return {
      pipelineId: shortServerLogText(body.pipelineId, 100)
    };
  }

  if (req.path === "/api/memory/write") {
    return {
      type: body.type ?? null,
      textChars: typeof body.text === "string" ? body.text.length : 0,
      textPreview: shortServerLogText(body.text, 160),
      metadata: redactAndCompact(body.metadata)
    };
  }

  if (req.path.includes("/learned-phrases")) {
    return {
      phrase: shortServerLogText(body.phrase, 120),
      meaning: shortServerLogText(body.meaning, 160),
      action: body.action ?? null,
      confidence: body.confidence ?? null,
      args: redactAndCompact(body.args)
    };
  }

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

  if (req.path.startsWith("/api/esp32/")) {
    return {
      ok: body.ok,
      id: body.id,
      connected: body.status?.connected,
      connecting: body.status?.connecting,
      state: body.status?.state,
      lastError: body.status?.lastError ? shortServerLogText(body.status.lastError, 200) : undefined,
      telemetry: summarizeTelemetry(body.telemetry),
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
      geminiLiveModel: body.geminiLiveModel,
      roboflowWebrtcEnabled: body.roboflowWebrtc?.enabled,
      roboflowWebrtcConfigured: body.roboflowWebrtc?.configured,
      objectDetectionProvider: body.objectDetectionProvider,
      esp32ConnectionMode: body.esp32ConnectionMode
    };
  }

  if (req.path === "/api/init-webrtc" || req.path.startsWith("/api/roboflow-webrtc/")) {
    return {
      ok: body.ok,
      enabled: body.enabled,
      configured: body.configured,
      status: body.status,
      type: body.type,
      sdpChars: typeof body.sdp === "string" ? body.sdp.length : undefined,
      pipelineId: body.context?.pipeline_id,
      iceServers: Array.isArray(body.iceServers) ? body.iceServers.length : undefined,
      error: body.error ? shortServerLogText(body.error, 240) : undefined,
      message: body.message ? shortServerLogText(body.message, 240) : undefined,
      error_type: body.error_type
    };
  }

  if (req.path === "/api/gemini-live/token") {
    return {
      ok: body.ok,
      model: body.model,
      voice: body.voice,
      thinkingLevel: body.thinkingLevel,
      token: body.token ? "[REDACTED]" : undefined,
      expiresAt: body.expiresAt,
      error: body.error ? shortServerLogText(body.error, 240) : undefined
    };
  }

  if (req.path.includes("/memory/")) {
    return {
      ok: body.ok,
      memoryId: body.memory?.id,
      phraseId: body.phrase?.id,
      count: Array.isArray(body.phrases) ? body.phrases.length : undefined,
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
    motor_state: telemetry.motor_state,
    simulated: telemetry.simulated
  };
}

function summarizeEsp32Payload(payload = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload === undefined ? null : typeof payload;
  }

  const summary = {};
  const allowedKeys = [
    "id",
    "type",
    "cmd",
    "label",
    "source",
    "reason",
    "duration_ms",
    "durationMs",
    "linear",
    "angular",
    "speed",
    "left_speed",
    "right_speed",
    "current_left_speed",
    "current_right_speed"
  ];

  for (const key of allowedKeys) {
    if (payload[key] !== undefined) {
      summary[key] = redactAndCompact(payload[key], { key });
    }
  }

  if (payload.config && typeof payload.config === "object") {
    summary.configKeys = Object.keys(payload.config).slice(0, 20);
  }

  const omittedKeys = Object.keys(payload).filter((key) => !allowedKeys.includes(key) && key !== "config");

  if (omittedKeys.length) {
    summary.omittedKeys = omittedKeys.slice(0, 20);
  }

  return summary;
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

function requireMemoryAccess(req, res, next) {
  if (isLocalRequest(req) || isPrivateLanRequest(req)) {
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

function requireGeminiLiveAccess(req, res, next) {
  if (
    isLocalRequest(req) ||
    isPrivateLanRequest(req) ||
    process.env.GEMINI_LIVE_ALLOW_PUBLIC_TOKEN === "true"
  ) {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    error:
      "Gemini Live token endpoint requires localhost, private LAN, or GEMINI_LIVE_ALLOW_PUBLIC_TOKEN=true for temporary public testing."
  });
}

function requireRoboflowWebrtcAccess(req, res, next) {
  if (
    isLocalRequest(req) ||
    isPrivateLanRequest(req) ||
    process.env.ROBOFLOW_WEBRTC_ALLOW_PUBLIC === "true"
  ) {
    next();
    return;
  }

  res.status(403).json({
    ok: false,
    error:
      "Roboflow WebRTC endpoint requires localhost, private LAN, or ROBOFLOW_WEBRTC_ALLOW_PUBLIC=true for temporary public testing."
  });
}

function requireEsp32GatewayAccess(req, res, next) {
  if (
    isLocalRequest(req) ||
    isPrivateLanRequest(req) ||
    process.env.ROBOT_ESP32_GATEWAY_ALLOW_PUBLIC === "true"
  ) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error:
      "Unauthorized ESP32 gateway request. Use local/LAN access or ROBOT_ESP32_GATEWAY_ALLOW_PUBLIC=true."
  });
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

function sendMemoryError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;

  res.status(statusCode).json({
    ok: false,
    error: statusCode === 500 ? "Memory request failed" : error.message
  });
}

function sendRoboflowWebrtcError(res, error, action = "request") {
  if (isRoboflowWorkflowError(error)) {
    serverLog(
      `ROBOFLOW_WEBRTC ${action} failed status=${error.statusCode} error=${shortServerLogText(error.message, 240)}`,
      "warn",
      "VISION"
    );
    res.status(error.statusCode).json(error.errorData);
    return;
  }

  const statusCode = Number(error?.statusCode) || 502;
  serverLog(
    `ROBOFLOW_WEBRTC ${action} failed status=${statusCode} error=${shortServerLogText(error.message, 240)}`,
    "warn",
    "VISION"
  );
  res.status(statusCode).json({
    ok: false,
    error: error.message || "Roboflow WebRTC request failed."
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
    "/api/config",
    "/api/esp32/events",
    "/api/esp32/status",
    "/api/esp32/messages"
  ].includes(pathname);
}

function createApiTraceId() {
  apiTraceCounter += 1;
  return `api_${Date.now()}_${apiTraceCounter}`;
}

function safeLogUrl(value) {
  try {
    const url = new URL(String(value || ""));

    if (url.username) {
      url.username = "[REDACTED]";
    }

    if (url.password) {
      url.password = "[REDACTED]";
    }

    for (const key of [...url.searchParams.keys()]) {
      if (shouldRedactKey(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return url.toString();
  } catch (_error) {
    return shortServerLogText(value, 180);
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function sendEsp32Sse(res, event, payload) {
  if (Number.isFinite(Number(payload?.latestSeq))) {
    res.write(`id: ${Number(payload.latestSeq)}\n`);
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${safeJson(payload)}\n\n`);
}

function apiLog(message, level = "info") {
  serverLog(message, level, "API");
}

function esp32Log(message, level = "info") {
  serverLog(message, level, "ESP32");
}

function geminiLog(message, level = "info") {
  serverLog(message, level, "GEMINI_LIVE");
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
    `[BOOT] Gemini Live enabled=${geminiLiveConfig.enabled} configured=${geminiLiveConfig.configured} model=${geminiLiveConfig.model} voice=${geminiLiveConfig.voice}`
  );
  console.log(
    `[BOOT] Roboflow WebRTC enabled=${roboflowWebrtcConfig.enabled} configured=${roboflowWebrtcConfig.configured} workspace=${roboflowWebrtcConfig.workspace || "(not set)"} workflow=${roboflowWebrtcConfig.workflowId || "(not set)"} region=${roboflowWebrtcConfig.requestedRegion || "(default)"}`
  );
  console.log(
    `[BOOT] Server API trace=${serverTraceEnabled} pollTrace=${serverTracePollEndpoints} esp32Gateway=${esp32DefaultWsUrl}`
  );

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
