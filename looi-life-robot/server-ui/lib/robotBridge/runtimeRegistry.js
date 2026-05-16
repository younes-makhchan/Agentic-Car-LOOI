import crypto from "node:crypto";

const DEFAULT_TTL_MS = 86_400_000;
const DEFAULT_STALE_MS = 5_000;

export class RuntimeRegistry {
  constructor({ tokenTtlMs = DEFAULT_TTL_MS, staleMs = DEFAULT_STALE_MS } = {}) {
    this.tokenTtlMs = normalizePositiveNumber(tokenTtlMs, DEFAULT_TTL_MS);
    this.staleMs = normalizePositiveNumber(staleMs, DEFAULT_STALE_MS);
    this.runtimes = new Map();
  }

  createRuntime({ name = "phone-browser" } = {}) {
    this.pruneExpiredRuntimes();

    const now = Date.now();
    const runtimeId = `runtime_${now}_${crypto.randomUUID()}`;
    const runtimeToken = crypto.randomBytes(32).toString("base64url");
    const runtime = {
      runtimeId,
      name: sanitizeString(name, 80) || "phone-browser",
      tokenHash: hashToken(runtimeToken),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: null,
      expiresAt: new Date(now + this.tokenTtlMs).toISOString(),
      status: {}
    };

    this.runtimes.set(runtimeId, runtime);

    return {
      runtimeId,
      runtimeToken,
      expiresAt: runtime.expiresAt
    };
  }

  verifyRuntimeToken(token) {
    if (typeof token !== "string" || !token.trim()) {
      return null;
    }

    this.pruneExpiredRuntimes();

    const tokenHash = hashToken(token);

    for (const runtime of this.runtimes.values()) {
      if (runtime.tokenHash === tokenHash) {
        return copyRuntime(runtime);
      }
    }

    return null;
  }

  updateHeartbeat({ runtimeId, runtimeToken, status } = {}) {
    this.pruneExpiredRuntimes();

    const runtime = this.runtimes.get(runtimeId);

    if (!runtime || runtime.tokenHash !== hashToken(runtimeToken)) {
      return null;
    }

    runtime.lastSeenAt = new Date().toISOString();
    runtime.status = compactStatus(status);

    return copyRuntime(runtime);
  }

  getLatestRuntime() {
    this.pruneExpiredRuntimes();

    return [...this.runtimes.values()]
      .sort((a, b) => String(b.lastSeenAt ?? b.createdAt).localeCompare(String(a.lastSeenAt ?? a.createdAt)))
      .map(copyRuntime)[0] ?? null;
  }

  getRuntime(runtimeId) {
    this.pruneExpiredRuntimes();
    const runtime = this.runtimes.get(runtimeId);
    return runtime ? copyRuntime(runtime) : null;
  }

  getPublicStatus() {
    const runtime = this.getLatestRuntime();

    if (!runtime) {
      return {
        online: false,
        runtimeId: null,
        lastSeenAt: null,
        staleMs: null,
        cloudMotionArmed: false,
        cloudCameraAllowed: false,
        simulatorMode: false,
        bridgePolling: false,
        robotConnected: false,
        connectionState: "offline",
        mood: "unknown",
        currentBehavior: "unknown",
        motorState: "unknown",
        battery: null,
        obstacle: false,
        userVisible: false,
        userPosition: "unknown",
        userDistance: "unknown",
        cameraRunning: false,
        cameraFacingMode: "unknown",
        cameraLastSnapshotAt: null,
        speechListening: false,
        speechSupported: false,
        voiceOutputSupported: false,
        voiceMuted: false,
        isSpeaking: false
      };
    }

    const staleMs = runtime.lastSeenAt ? Date.now() - Date.parse(runtime.lastSeenAt) : null;
    const online = Number.isFinite(staleMs) && staleMs <= this.staleMs;
    const lifeState = runtime.status?.lifeState ?? {};
    const telemetry = runtime.status?.telemetry ?? {};
    const voice = runtime.status?.voice ?? {};
    const camera = runtime.status?.camera ?? {};
    const cameraObservation = camera.latestObservation ?? camera.observation ?? {};

    return {
      online,
      runtimeId: runtime.runtimeId,
      lastSeenAt: runtime.lastSeenAt,
      staleMs,
      cloudMotionArmed: Boolean(runtime.status?.cloudMotionArmed),
      cloudCameraAllowed: Boolean(runtime.status?.cloudCameraAllowed),
      simulatorMode: Boolean(runtime.status?.simulatorMode),
      bridgePolling: Boolean(runtime.status?.bridgePolling),
      robotConnected: Boolean(runtime.status?.robotConnected),
      connectionState: runtime.status?.connectionState ?? lifeState.connectionState ?? "unknown",
      mood: lifeState.mood ?? "unknown",
      currentBehavior: lifeState.currentBehavior ?? "unknown",
      motorState: telemetry.motor_state ?? lifeState.robotMotorState ?? "unknown",
      battery: telemetry.battery ?? lifeState.battery ?? null,
      obstacle: Boolean(lifeState.obstacle),
      userVisible: Boolean(lifeState.userVisible || cameraObservation.userVisible),
      userPosition: lifeState.userPosition ?? cameraObservation.userPosition ?? "unknown",
      userDistance: lifeState.userDistance ?? cameraObservation.userDistance ?? "unknown",
      cameraRunning: Boolean(camera.running),
      cameraFacingMode: camera.facingMode ?? "unknown",
      cameraLastSnapshotAt: camera.lastSnapshotAt ?? null,
      speechListening: Boolean(voice.speechListening),
      speechSupported: Boolean(voice.speechSupported),
      voiceOutputSupported: Boolean(voice.voiceOutputSupported),
      voiceMuted: Boolean(voice.voiceMuted),
      isSpeaking: Boolean(voice.isSpeaking)
    };
  }

  pruneExpiredRuntimes() {
    const now = Date.now();

    for (const [runtimeId, runtime] of this.runtimes.entries()) {
      if (Date.parse(runtime.expiresAt) <= now) {
        this.runtimes.delete(runtimeId);
      }
    }
  }

  isRuntimeOnline() {
    return this.getPublicStatus().online;
  }

  clear() {
    const cleared = this.runtimes.size;
    this.runtimes.clear();
    return cleared;
  }
}

function compactStatus(status = {}) {
  const lifeState = status.lifeState ?? {};
  const telemetry = status.telemetry ?? {};
  const latestAction = status.latestAction ?? {};

  return {
    cloudMotionArmed: Boolean(status.cloudMotionArmed),
    cloudCameraAllowed: Boolean(status.cloudCameraAllowed),
    simulatorMode: Boolean(status.simulatorMode),
    bridgePolling: Boolean(status.bridgePolling),
    robotConnected: Boolean(status.robotConnected),
    connectionState: sanitizeString(status.connectionState, 80) || "unknown",
    lifeState: {
      mood: sanitizeString(lifeState.mood, 40) || "unknown",
      energy: finiteOrNull(lifeState.energy),
      boredom: finiteOrNull(lifeState.boredom),
      fear: finiteOrNull(lifeState.fear),
      curiosity: finiteOrNull(lifeState.curiosity),
      affection: finiteOrNull(lifeState.affection),
      attentionTarget: sanitizeString(lifeState.attentionTarget, 80) || "none",
      userVisible: Boolean(lifeState.userVisible),
      userDistance: sanitizeString(lifeState.userDistance, 80) || "unknown",
      userPosition: sanitizeString(lifeState.userPosition, 80) || "unknown",
      isSpeaking: Boolean(lifeState.isSpeaking),
      isListening: Boolean(lifeState.isListening),
      battery: lifeState.battery ?? null,
      obstacle: Boolean(lifeState.obstacle),
      currentBehavior: sanitizeString(lifeState.currentBehavior, 80) || "unknown",
      connectionState: sanitizeString(lifeState.connectionState, 80) || "unknown",
      robotMotorState: sanitizeString(lifeState.robotMotorState, 80) || "unknown"
    },
    telemetry: {
      rssi: finiteOrNull(telemetry.rssi),
      clients: finiteOrNull(telemetry.clients),
      battery: telemetry.battery ?? null,
      motor_state: sanitizeString(telemetry.motor_state, 80) || "unknown",
      left_speed: finiteOrNull(telemetry.left_speed),
      right_speed: finiteOrNull(telemetry.right_speed),
      motion_remaining_ms: finiteOrNull(telemetry.motion_remaining_ms),
      last_command_age_ms: finiteOrNull(telemetry.last_command_age_ms),
      simulated: Boolean(telemetry.simulated)
    },
    latestAction: {
      actionId: sanitizeString(latestAction.actionId, 120) || null,
      type: sanitizeString(latestAction.type, 80) || null,
      status: sanitizeString(latestAction.status, 40) || null,
      executed: Boolean(latestAction.executed),
      physical: Boolean(latestAction.physical),
      message: sanitizeString(latestAction.message, 240) || null,
      timestamp: sanitizeString(latestAction.timestamp, 80) || null
    },
    voice: {
      speechListening: Boolean(status.voice?.speechListening),
      speechSupported: Boolean(status.voice?.speechSupported),
      voiceOutputSupported: Boolean(status.voice?.voiceOutputSupported),
      voiceMuted: Boolean(status.voice?.voiceMuted),
      isSpeaking: Boolean(status.voice?.isSpeaking),
      lastTranscript: status.voice?.lastTranscript
        ? {
            text: sanitizeString(status.voice.lastTranscript.text, 240) || "",
            confidence: finiteOrNull(status.voice.lastTranscript.confidence),
            language: sanitizeString(status.voice.lastTranscript.language, 40) || "",
            timestamp: sanitizeString(status.voice.lastTranscript.timestamp, 80) || ""
          }
        : null
    },
    camera: compactCameraStatus(status.camera),
    browserTime: sanitizeString(status.browserTime, 80) || null
  };
}

function compactCameraStatus(camera = {}) {
  const observation = camera?.latestObservation ?? camera?.observation ?? null;

  return {
    supported: Boolean(camera?.supported),
    secureContext: Boolean(camera?.secureContext),
    running: Boolean(camera?.running),
    facingMode: sanitizeString(camera?.facingMode, 40) || "unknown",
    lastError: sanitizeString(camera?.lastError, 160) || null,
    lastFrameAt: finiteOrNull(camera?.lastFrameAt),
    lastSnapshotAt: sanitizeString(camera?.lastSnapshotAt, 80) || null,
    visionSupported: {
      faceDetector: Boolean(camera?.visionSupported?.faceDetector)
    },
    latestObservation: observation
      ? {
          timestamp: sanitizeString(observation.timestamp, 80) || null,
          cameraRunning: Boolean(observation.cameraRunning),
          facingMode: sanitizeString(observation.facingMode, 40) || "unknown",
          detector: sanitizeString(observation.detector, 40) || "none",
          userVisible: Boolean(observation.userVisible),
          faceCount: finiteOrNull(observation.faceCount),
          userPosition: sanitizeString(observation.userPosition, 40) || "unknown",
          userDistance: sanitizeString(observation.userDistance, 40) || "unknown",
          brightness: finiteOrNull(observation.brightness),
          motion: observation.motion ?? null,
          note: sanitizeString(observation.note, 160) || ""
        }
      : null
  };
}

function copyRuntime(runtime) {
  return {
    ...runtime,
    status: structuredCloneSafe(runtime.status)
  };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function finiteOrNull(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizePositiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}
