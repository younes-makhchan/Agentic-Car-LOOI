import { clampNumber } from "../core/runtimeUtils.js";
import { CameraInput } from "./camera.js";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_FRAME_INTERVAL_MS = 1500;

export class BackCameraProbe {
  constructor({
    logger,
    frameSender,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    frameIntervalMs = DEFAULT_FRAME_INTERVAL_MS,
    getDeviceId,
    onStop
  } = {}) {
    this.logger = logger;
    this.frameSender = frameSender;
    this.timeoutMs = clampNumber(timeoutMs, 5000, 120000, DEFAULT_TIMEOUT_MS);
    this.frameIntervalMs = clampNumber(frameIntervalMs, 1000, 5000, DEFAULT_FRAME_INTERVAL_MS);
    this.getDeviceId = getDeviceId;
    this.onStop = onStop;
    this.cameraInput = null;
    this.running = false;
    this.starting = false;
    this.sending = false;
    this.targetLabel = "";
    this.reason = "";
    this.startedAt = null;
    this.stoppedAt = null;
    this.lastFrameSentAt = null;
    this.lastError = null;
    this.timeoutTimer = 0;
    this.frameTimer = 0;
  }

  async start({ targetLabel = "", reason = "front_target_lost" } = {}) {
    const cleanTarget = String(targetLabel ?? "").trim();
    const cleanReason = String(reason ?? "").trim() || "front_target_lost";

    this.targetLabel = cleanTarget || this.targetLabel;
    this.reason = cleanReason;
    this.lastError = null;

    if (this.running) {
      this.scheduleTimeout();
      this.scheduleFrameLoop();
      return { ok: true, status: this.getStatus() };
    }

    if (this.starting) {
      return { ok: true, status: this.getStatus() };
    }

    this.starting = true;
    this.stoppedAt = null;

    try {
      const camera = this.ensureCameraInput();
      const deviceId = typeof this.getDeviceId === "function" ? this.getDeviceId() : "";
      const result = await camera.startCamera({ facingMode: "environment", deviceId });

      if (!result?.ok) {
        this.lastError = result?.error ?? "back_camera_unavailable";
        this.log(`probe failed target=${this.targetLabel || "object"} error=${this.lastError}`, "warn");
        return { ok: false, error: this.lastError, status: this.getStatus() };
      }

      this.running = true;
      this.startedAt = new Date().toISOString();
      this.log(`probe started target=${this.targetLabel || "object"} reason=${this.reason} device=${deviceId ? shortDeviceId(deviceId) : "auto"} timeout=${Math.round(this.timeoutMs)}ms`);
      this.scheduleTimeout();
      this.scheduleFrameLoop({ sendNow: true });
      return { ok: true, status: this.getStatus() };
    } catch (error) {
      this.lastError = error.message;
      this.log(`probe failed target=${this.targetLabel || "object"} error=${error.message}`, "warn");
      return { ok: false, error: error.message, status: this.getStatus() };
    } finally {
      this.starting = false;
    }
  }

  async stop(reason = "back_camera_probe_stop") {
    const wasRunning = this.running || this.starting;
    this.running = false;
    this.starting = false;
    this.clearTimers();

    if (this.cameraInput) {
      await this.cameraInput.stopCamera({ quiet: true }).catch((error) => {
        this.lastError = error.message;
        this.log(`probe stop failed reason=${reason} error=${error.message}`, "warn");
      });
    }

    this.stoppedAt = new Date().toISOString();
    if (wasRunning) {
      this.log(`probe stopped reason=${reason}`);
      this.onStop?.({
        reason,
        status: this.getStatus()
      });
    }

    return { ok: true, status: this.getStatus() };
  }

  async captureSnapshot({
    includeDataUrl = true,
    maxWidth = 640,
    quality = 0.72,
    targetLabel = "",
    reason = "back_camera_capture"
  } = {}) {
    if (!this.running) {
      const startResult = await this.start({
        targetLabel,
        reason
      });

      if (!startResult?.ok) {
        return {
          ok: false,
          error: startResult?.error ?? "back_camera_unavailable",
          status: this.getCameraStatus(),
          snapshot: null
        };
      }
    }

    const result = await this.cameraInput.captureSnapshot({
      includeDataUrl,
      maxWidth,
      quality
    });

    if (result?.snapshot) {
      result.snapshot = {
        ...result.snapshot,
        source: "back_camera_probe",
        facingMode: "environment",
        note: "back camera probe thumbnail"
      };
    }

    return result;
  }

  getCameraStatus() {
    return this.cameraInput?.getCameraStatus?.() ?? {
      supported: Boolean(globalThis.navigator?.mediaDevices?.getUserMedia),
      secureContext: typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : false,
      running: false,
      facingMode: "environment",
      deviceId: "",
      hasStream: false,
      lastError: this.lastError,
      lastFrameAt: null,
      lastSnapshotAt: null,
      visionSupported: { faceDetector: false },
      observation: null
    };
  }

  getStatus() {
    return {
      running: this.running,
      starting: this.starting,
      sending: this.sending,
      targetLabel: this.targetLabel,
      reason: this.reason,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastFrameSentAt: this.lastFrameSentAt,
      lastError: this.lastError,
      timeoutMs: this.timeoutMs,
      frameIntervalMs: this.frameIntervalMs,
      cameraStatus: this.getCameraStatus()
    };
  }

  ensureCameraInput() {
    if (this.cameraInput) {
      return this.cameraInput;
    }

    const videoElement = createHiddenVideoElement();
    const canvasElement = createHiddenCanvasElement();
    this.cameraInput = new CameraInput({
      videoElement,
      canvasElement,
      defaultFacingMode: "environment",
      analysisIntervalMs: 1000,
      logger: (message, level = "info") => this.log(`camera ${message}`, level)
    });
    return this.cameraInput;
  }

  scheduleTimeout() {
    if (this.timeoutTimer) {
      globalThis.clearTimeout(this.timeoutTimer);
    }

    this.timeoutTimer = globalThis.setTimeout(() => {
      this.stop("timeout").catch((error) => {
        this.log(`probe timeout stop failed: ${error.message}`, "warn");
      });
    }, this.timeoutMs);
  }

  scheduleFrameLoop({ sendNow = false } = {}) {
    if (this.frameTimer) {
      return;
    }

    if (sendNow) {
      this.sendFrame("start").catch((error) => {
        this.log(`frame send failed reason=start error=${error.message}`, "warn");
      });
    }

    this.frameTimer = globalThis.setInterval(() => {
      this.sendFrame("interval").catch((error) => {
        this.log(`frame send failed reason=interval error=${error.message}`, "warn");
      });
    }, this.frameIntervalMs);
  }

  async sendFrame(trigger = "interval") {
    if (!this.running || this.sending || typeof this.frameSender !== "function") {
      return false;
    }

    this.sending = true;
    try {
      const sent = await this.frameSender({
        cameraInput: this.cameraInput,
        targetLabel: this.targetLabel,
        reason: this.reason,
        trigger
      });

      if (sent) {
        this.lastFrameSentAt = new Date().toISOString();
      }

      return Boolean(sent);
    } finally {
      this.sending = false;
    }
  }

  clearTimers() {
    if (this.timeoutTimer) {
      globalThis.clearTimeout(this.timeoutTimer);
      this.timeoutTimer = 0;
    }
    if (this.frameTimer) {
      globalThis.clearInterval(this.frameTimer);
      this.frameTimer = 0;
    }
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`[back-camera] ${message}`, level);
    }
  }
}

function createHiddenVideoElement() {
  const video = globalThis.document?.createElement?.("video");
  if (!video) {
    return null;
  }

  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  video.style.position = "fixed";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  video.style.left = "-10px";
  video.style.top = "-10px";
  globalThis.document?.body?.append?.(video);
  return video;
}

function createHiddenCanvasElement() {
  const canvas = globalThis.document?.createElement?.("canvas");
  if (!canvas) {
    return null;
  }

  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  globalThis.document?.body?.append?.(canvas);
  return canvas;
}

function shortDeviceId(deviceId) {
  return String(deviceId || "").slice(0, 8);
}
