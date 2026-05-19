import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_VOICE = "Kore";
const DEFAULT_THINKING_LEVEL = "minimal";
const DEFAULT_NEW_SESSION_TTL_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;

export function getGeminiLiveEnv(env = process.env) {
  const model = String(env.GEMINI_LIVE_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const voice = String(env.GEMINI_LIVE_VOICE || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const thinkingLevel =
    String(env.GEMINI_LIVE_THINKING_LEVEL || DEFAULT_THINKING_LEVEL).trim().toLowerCase() ||
    DEFAULT_THINKING_LEVEL;

  return {
    enabled: env.GEMINI_LIVE_ENABLED === "true",
    configured: Boolean(String(env.GEMINI_API_KEY || "").trim()),
    model,
    voice,
    thinkingLevel
  };
}

export async function createGeminiLiveTokenFromEnv(env = process.env) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();

  if (!apiKey) {
    throw Object.assign(new Error("GEMINI_API_KEY is not configured."), {
      statusCode: 503
    });
  }

  const config = getGeminiLiveEnv(env);
  const now = Date.now();
  const newSessionTtlMs = clampInteger(
    env.GEMINI_LIVE_NEW_SESSION_TTL_MS,
    10_000,
    20 * 60 * 60_000,
    DEFAULT_NEW_SESSION_TTL_MS
  );
  const sessionTtlMs = clampInteger(
    env.GEMINI_LIVE_SESSION_TTL_MS,
    60_000,
    20 * 60 * 60_000,
    DEFAULT_SESSION_TTL_MS
  );

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "v1alpha"
    }
  });

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(now + newSessionTtlMs).toISOString(),
      expireTime: new Date(now + sessionTtlMs).toISOString(),
      liveConnectConstraints: {
        model: config.model,
        config: {
          responseModalities: ["AUDIO"]
        }
      },
      lockAdditionalFields: []
    }
  });

  if (!token?.name) {
    throw Object.assign(new Error("Gemini Live token response did not include a token name."), {
      statusCode: 502
    });
  }

  return {
    ok: true,
    token: token.name,
    tokenName: token.name,
    model: config.model,
    voice: config.voice,
    thinkingLevel: config.thinkingLevel,
    apiVersion: "v1alpha",
    websocketUrl:
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`,
    expiresAt: new Date(now + sessionTtlMs).toISOString(),
    newSessionExpiresAt: new Date(now + newSessionTtlMs).toISOString()
  };
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}
