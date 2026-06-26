import { WebSocket, WebSocketServer } from "ws";
import { getGeminiLiveEnv } from "./geminiLiveToken.js";

const DEFAULT_API_VERSION = "v1beta";
const DEFAULT_WEBSOCKET_BASE_URL = "wss://generativelanguage.googleapis.com";
const DEFAULT_RELAY_PATH = "/api/gemini-live/relay";
const MAX_RELAY_PAYLOAD_BYTES = 8 * 1024 * 1024;

let relayCounter = 0;

export function createGeminiLiveRelay({
  env = process.env,
  path = DEFAULT_RELAY_PATH,
  logger = () => {}
} = {}) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_RELAY_PAYLOAD_BYTES
  });

  wss.on("connection", (browserSocket, request) => {
    const relayId = ++relayCounter;
    const config = getGeminiLiveEnv(env);

    if (!config.enabled || !config.configured) {
      browserSocket.close(1011, "Agent relay is not configured.");
      return;
    }

    const upstreamUrl = buildGeminiLiveServerWebSocketUrl(env);
    const upstreamSocket = new WebSocket(upstreamUrl, {
      perMessageDeflate: false,
      maxPayload: MAX_RELAY_PAYLOAD_BYTES
    });
    const queuedClientMessages = [];
    let upstreamOpen = false;
    let closed = false;

    logger(
      `RELAY ${relayId} open client=${request.socket?.remoteAddress ?? "unknown"} model=${config.model}`
    );

    upstreamSocket.on("open", () => {
      upstreamOpen = true;
      logger(`RELAY ${relayId} upstream open queued=${queuedClientMessages.length}`, "debug");

      while (queuedClientMessages.length && upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(queuedClientMessages.shift());
      }
    });

    upstreamSocket.on("message", (data, isBinary) => {
      if (browserSocket.readyState === WebSocket.OPEN) {
        browserSocket.send(data, { binary: isBinary });
      }
    });

    upstreamSocket.on("error", (error) => {
      logger(`RELAY ${relayId} upstream error="${shortLogText(error.message)}"`, "warn");
      closePair(1011, "Agent upstream error.");
    });

    upstreamSocket.on("close", (code, reason) => {
      logger(`RELAY ${relayId} upstream close code=${code} reason="${shortLogText(reason)}"`, "debug");
      closePair(code || 1000, normalizeCloseReason(reason) || "Agent upstream closed.");
    });

    browserSocket.on("message", (data, isBinary) => {
      const payload = normalizePayload(data, isBinary);

      if (upstreamOpen && upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(payload, { binary: isBinary });
        return;
      }

      if (queuedClientMessages.length > 256) {
        logger(`RELAY ${relayId} client queue overflow`, "warn");
        closePair(1009, "Agent relay queue overflow.");
        return;
      }

      queuedClientMessages.push(payload);
    });

    browserSocket.on("error", (error) => {
      logger(`RELAY ${relayId} client error="${shortLogText(error.message)}"`, "debug");
      closePair(1011, "Agent relay client error.");
    });

    browserSocket.on("close", (code, reason) => {
      logger(`RELAY ${relayId} client close code=${code} reason="${shortLogText(reason)}"`, "debug");
      closePair(code || 1000, normalizeCloseReason(reason) || "Agent client closed.");
    });

    function closePair(code = 1000, reason = "Agent relay closed.") {
      if (closed) {
        return;
      }
      closed = true;
      safeClose(browserSocket, code, reason);
      safeClose(upstreamSocket, code, reason);
      queuedClientMessages.length = 0;
      logger(`RELAY ${relayId} closed code=${code} reason="${shortLogText(reason)}"`, "debug");
    }
  });

  return {
    path,
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (websocket) => {
        wss.emit("connection", websocket, request);
      });
    },
    close(callback) {
      wss.close(callback);
    }
  };
}

export function buildGeminiLiveRelaySession({
  request,
  env = process.env,
  path = DEFAULT_RELAY_PATH
} = {}) {
  const config = getGeminiLiveEnv(env);

  return {
    ok: true,
    transport: "server_relay",
    websocketUrl: buildSameOriginWebSocketUrl(request, path),
    model: config.model,
    voice: config.voice,
    thinkingLevel: config.thinkingLevel,
    contextCompression: config.contextCompression,
    sessionResumption: config.sessionResumption,
    slidingWindowTokens: config.slidingWindowTokens,
    apiVersion: String(env.GEMINI_LIVE_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION
  };
}

export function buildGeminiLiveServerWebSocketUrl(env = process.env) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    throw Object.assign(new Error("Agent API key is not configured."), {
      statusCode: 503
    });
  }

  const apiVersion = String(env.GEMINI_LIVE_API_VERSION || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;
  const baseUrl = String(env.GEMINI_LIVE_WEBSOCKET_BASE_URL || DEFAULT_WEBSOCKET_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const method = "BidiGenerateContent";

  return `${baseUrl}/ws/google.ai.generativelanguage.${encodeURIComponent(apiVersion)}.GenerativeService.${method}?key=${encodeURIComponent(apiKey)}`;
}

function buildSameOriginWebSocketUrl(request, path) {
  const proto = String(request?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() ||
    (request?.socket?.encrypted ? "https" : "http");
  const host = request?.headers?.["x-forwarded-host"] || request?.headers?.host || "localhost";
  const wsProto = proto === "https" ? "wss" : "ws";

  return `${wsProto}://${host}${path}`;
}

function normalizePayload(data, isBinary) {
  if (isBinary) {
    return data;
  }

  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return data;
}

function safeClose(socket, code, reason) {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return;
  }

  try {
    socket.close(normalizeCloseCode(code), String(reason || "closed").slice(0, 120));
  } catch (_error) {
    try {
      socket.terminate?.();
    } catch (_terminateError) {
      // Best-effort relay cleanup only.
    }
  }
}

function normalizeCloseCode(code) {
  const numeric = Number(code);

  if (numeric === 1000 || (numeric >= 3000 && numeric <= 4999)) {
    return numeric;
  }

  return 1011;
}

function normalizeCloseReason(reason) {
  if (!reason) {
    return "";
  }

  if (Buffer.isBuffer(reason)) {
    return reason.toString("utf8");
  }

  return String(reason);
}

function shortLogText(value, maxLength = 180) {
  return normalizeCloseReason(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}
