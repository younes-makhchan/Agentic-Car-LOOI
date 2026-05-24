import { clampNumber } from "../core/runtimeUtils.js";

const DEFAULT_OBSERVATION = {
  timestamp: null,
  cameraRunning: false,
  facingMode: "unknown",
  detector: "none",
  userVisible: false,
  faceCount: null,
  userPosition: "unknown",
  userDistance: "unknown",
  brightness: null,
  motion: null,
  note: "Camera has not produced an observation yet."
};

export class CameraInput {
  constructor({
    logger,
    videoElement = null,
    canvasElement = null,
    defaultFacingMode = "user",
    analysisIntervalMs = 500
  } = {}) {
    this.logger = logger;
    this.videoElement = videoElement;
    this.canvasElement = canvasElement;
    this.defaultFacingMode = normalizeFacingMode(defaultFacingMode);
    this.analysisIntervalMs = clampNumber(analysisIntervalMs, 250, 5000, 500);
    this.supported = Boolean(globalThis.navigator?.mediaDevices?.getUserMedia);
    this.secureContext =
      typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : false;
    this.running = false;
    this.stream = null;
    this.facingMode = this.defaultFacingMode;
    this.deviceId = "";
    this.lastError = null;
    this.lastSnapshot = null;
    this.lastObservation = { ...DEFAULT_OBSERVATION };
    this.lastFrameAt = null;
    this.analysisTimer = null;
    this.faceDetector = null;
    this.faceDetectorChecked = false;
    this.callbacks = {
      onStatus: null,
      onObservation: null,
      onError: null,
      onSnapshot: null
    };
  }

  isSupported() {
    return this.supported;
  }

  isRunning() {
    return this.running;
  }

  async startCamera({ facingMode = this.defaultFacingMode, deviceId = "" } = {}) {
    const nextFacingMode = normalizeFacingMode(facingMode);
    const nextDeviceId = normalizeDeviceId(deviceId);

    if (!this.supported) {
      return this.fail("Camera API is unavailable in this browser.");
    }

    this.lastError = null;

    try {
      await this.stopCamera({ quiet: true });
      const stream = await globalThis.navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(nextFacingMode, nextDeviceId),
        audio: false
      });

      this.stream = stream;
      this.running = true;
      this.facingMode = nextFacingMode;
      this.deviceId = nextDeviceId || stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || "";
      this.lastFrameAt = Date.now();

      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        await this.videoElement.play?.().catch((error) => {
          this.log(`Camera preview play failed: ${error.message}`, "warn");
        });
      }

      this.startAnalysis();
      await this.analyzeFrame();
      this.emitStatus();

      return {
        ok: true,
        status: this.getCameraStatus()
      };
    } catch (error) {
      await this.stopCamera({ quiet: true });
      return this.fail(cameraErrorMessage(error));
    }
  }

  async stopCamera({ quiet = false } = {}) {
    this.stopAnalysis();

    if (this.stream) {
      this.stream.getTracks?.().forEach((track) => {
        try {
          track.stop();
        } catch (_error) {
          // Track stop failures are non-actionable in the browser UI.
        }
      });
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.stream = null;
    this.running = false;
    this.lastFrameAt = null;
    this.lastObservation = {
      ...this.lastObservation,
      timestamp: new Date().toISOString(),
      cameraRunning: false,
      facingMode: this.facingMode,
      detector: this.getFaceDetectorSupported() ? "face_detector" : "none",
      note: "Camera stopped."
    };

    if (!quiet) {
      this.emitObservation(this.lastObservation);
      this.emitStatus();
    }

    return {
      ok: true,
      status: this.getCameraStatus()
    };
  }

  async switchCamera() {
    const nextFacingMode = this.facingMode === "user" ? "environment" : "user";
    return this.startCamera({ facingMode: nextFacingMode });
  }

  async captureSnapshot({
    maxWidth = 320,
    quality = 0.65,
    includeDataUrl = true,
    emit = true,
    record = true
  } = {}) {
    if (!this.running || !this.videoElement) {
      return {
        ok: false,
        error: "Camera is not running.",
        snapshot: null,
        status: this.getCameraStatus()
      };
    }

    const videoWidth = Number(this.videoElement.videoWidth || this.videoElement.clientWidth || 0);
    const videoHeight = Number(this.videoElement.videoHeight || this.videoElement.clientHeight || 0);

    if (videoWidth <= 0 || videoHeight <= 0) {
      return {
        ok: false,
        error: "Camera frame is not ready yet.",
        snapshot: null,
        status: this.getCameraStatus()
      };
    }

    const canvas = this.ensureCanvas();

    if (!canvas?.getContext) {
      return {
        ok: false,
        error: "Snapshot canvas is unavailable.",
        snapshot: null,
        status: this.getCameraStatus()
      };
    }

    const safeMaxWidth = clampNumber(maxWidth, 160, 640, 320);
    const scale = Math.min(1, safeMaxWidth / videoWidth);
    const width = Math.max(1, Math.round(videoWidth * scale));
    const height = Math.max(1, Math.round(videoHeight * scale));
    const safeQuality = clampNumber(quality, 0.3, 0.8, 0.65);

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: false });
    context.drawImage(this.videoElement, 0, 0, width, height);

    const rawDataUrl = canvas.toDataURL("image/jpeg", safeQuality);
    const snapshot = {
      timestamp: new Date().toISOString(),
      facingMode: this.facingMode,
      width,
      height,
      dataUrl: includeDataUrl ? rawDataUrl : null,
      bytesApprox: estimateDataUrlBytes(rawDataUrl),
      note: "small local thumbnail"
    };

    if (record) {
      this.lastSnapshot = snapshot;
    }
    if (emit) {
      this.emitSnapshot(snapshot);
      this.emitStatus();
    }

    return {
      ok: true,
      snapshot,
      status: this.getCameraStatus()
    };
  }

  getCameraStatus() {
    return {
      supported: this.supported,
      secureContext: this.secureContext,
      running: this.running,
      facingMode: this.running ? this.facingMode : this.facingMode || "unknown",
      deviceId: this.deviceId,
      hasStream: Boolean(this.stream),
      lastError: this.lastError,
      lastFrameAt: this.lastFrameAt,
      lastSnapshotAt: this.lastSnapshot?.timestamp ?? null,
      visionSupported: {
        faceDetector: this.getFaceDetectorSupported()
      },
      observation: this.getLatestObservation()
    };
  }

  getLatestObservation() {
    return {
      ...DEFAULT_OBSERVATION,
      ...this.lastObservation
    };
  }

  onStatus(callback) {
    this.callbacks.onStatus = callback;
    return this;
  }

  onObservation(callback) {
    this.callbacks.onObservation = callback;
    return this;
  }

  onError(callback) {
    this.callbacks.onError = callback;
    return this;
  }

  onSnapshot(callback) {
    this.callbacks.onSnapshot = callback;
    return this;
  }

  startAnalysis() {
    if (this.analysisTimer || !this.running) {
      return;
    }

    this.analysisTimer = globalThis.setInterval(() => {
      this.analyzeFrame().catch((error) => {
        this.lastError = error.message;
        this.emitError(error.message);
      });
    }, this.analysisIntervalMs);
  }

  stopAnalysis() {
    if (this.analysisTimer) {
      globalThis.clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  async analyzeFrame() {
    const timestamp = new Date().toISOString();

    if (!this.running || !this.videoElement) {
      const observation = {
        ...DEFAULT_OBSERVATION,
        timestamp,
        cameraRunning: false,
        facingMode: this.facingMode,
        detector: this.getFaceDetectorSupported() ? "face_detector" : "none",
        note: this.supported ? "Camera is stopped." : "Camera API is unavailable."
      };
      this.lastObservation = observation;
      this.emitObservation(observation);
      return observation;
    }

    if (this.videoElement.readyState < 2) {
      const observation = {
        ...DEFAULT_OBSERVATION,
        timestamp,
        cameraRunning: true,
        facingMode: this.facingMode,
        detector: this.getFaceDetectorSupported() ? "face_detector" : "none",
        note: "Camera frame is not ready yet."
      };
      this.lastObservation = observation;
      this.emitObservation(observation);
      return observation;
    }

    this.lastFrameAt = Date.now();

    if (this.getFaceDetectorSupported()) {
      try {
        const detector = this.getFaceDetector();
        const faces = detector ? await detector.detect(this.videoElement) : [];
        const observation = this.observationFromFaces(faces, timestamp);
        this.lastObservation = observation;
        this.emitObservation(observation);
        this.emitStatus();
        return observation;
      } catch (error) {
        this.lastError = `Face detection failed: ${error.message}`;
        this.emitError(this.lastError);
      }
    }

    const observation = {
      ...DEFAULT_OBSERVATION,
      timestamp,
      cameraRunning: true,
      facingMode: this.facingMode,
      detector: "none",
      brightness: this.estimateBrightness(),
      note: this.getFaceDetectorSupported()
        ? "Face detection returned no usable result."
        : "FaceDetector not supported"
    };

    this.lastObservation = observation;
    this.emitObservation(observation);
    this.emitStatus();
    return observation;
  }

  observationFromFaces(faces, timestamp) {
    const normalizedFaces = Array.isArray(faces) ? faces : [];
    const videoWidth = Number(this.videoElement?.videoWidth || this.videoElement?.clientWidth || 1);
    const videoHeight = Number(this.videoElement?.videoHeight || this.videoElement?.clientHeight || 1);
    const largestFace = normalizedFaces
      .map((face) => face.boundingBox)
      .filter(Boolean)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (!largestFace) {
      return {
        ...DEFAULT_OBSERVATION,
        timestamp,
        cameraRunning: true,
        facingMode: this.facingMode,
        detector: "face_detector",
        userVisible: false,
        faceCount: normalizedFaces.length,
        brightness: this.estimateBrightness(),
        note: "No face visible."
      };
    }

    const centerX = largestFace.x + largestFace.width / 2;
    const faceRatio = Math.max(
      largestFace.width / Math.max(1, videoWidth),
      largestFace.height / Math.max(1, videoHeight)
    );

    return {
      ...DEFAULT_OBSERVATION,
      timestamp,
      cameraRunning: true,
      facingMode: this.facingMode,
      detector: "face_detector",
      userVisible: true,
      faceCount: normalizedFaces.length,
      userPosition: positionFromCenter(centerX / Math.max(1, videoWidth)),
      userDistance: distanceFromFaceRatio(faceRatio),
      brightness: this.estimateBrightness(),
      note: "Face detected locally in browser."
    };
  }

  estimateBrightness() {
    if (!this.running || !this.videoElement) {
      return null;
    }

    const canvas = this.ensureCanvas();

    if (!canvas?.getContext) {
      return null;
    }

    const width = 16;
    const height = 12;

    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(this.videoElement, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      let total = 0;

      for (let index = 0; index < data.length; index += 4) {
        total += (data[index] + data[index + 1] + data[index + 2]) / 3;
      }

      return Math.round((total / (data.length / 4) / 255) * 100) / 100;
    } catch (_error) {
      return null;
    }
  }

  getFaceDetectorSupported() {
    return Boolean(globalThis.FaceDetector);
  }

  getFaceDetector() {
    if (!this.getFaceDetectorSupported()) {
      return null;
    }

    if (this.faceDetector || this.faceDetectorChecked) {
      return this.faceDetector;
    }

    this.faceDetectorChecked = true;

    try {
      this.faceDetector = new globalThis.FaceDetector({
        fastMode: true,
        maxDetectedFaces: 3
      });
    } catch (error) {
      this.lastError = `FaceDetector unavailable: ${error.message}`;
      this.faceDetector = null;
    }

    return this.faceDetector;
  }

  ensureCanvas() {
    if (this.canvasElement) {
      return this.canvasElement;
    }

    if (globalThis.document?.createElement) {
      this.canvasElement = globalThis.document.createElement("canvas");
    }

    return this.canvasElement;
  }

  fail(message) {
    this.lastError = message;
    this.emitError(message);
    this.emitStatus();

    return {
      ok: false,
      error: message,
      status: this.getCameraStatus()
    };
  }

  emitStatus() {
    if (typeof this.callbacks.onStatus === "function") {
      this.callbacks.onStatus(this.getCameraStatus());
    }
  }

  emitObservation(observation) {
    if (typeof this.callbacks.onObservation === "function") {
      this.callbacks.onObservation(observation);
    }
  }

  emitError(message) {
    if (typeof this.callbacks.onError === "function") {
      this.callbacks.onError(message);
    }
  }

  emitSnapshot(snapshot) {
    if (typeof this.callbacks.onSnapshot === "function") {
      this.callbacks.onSnapshot(snapshot);
    }
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const logMethod = typeof this.logger[level] === "function" ? level : "log";
    this.logger[logMethod](message);
  }
}

function normalizeFacingMode(facingMode) {
  return facingMode === "environment" ? "environment" : "user";
}

function normalizeDeviceId(deviceId) {
  return typeof deviceId === "string" ? deviceId.trim() : "";
}

function buildVideoConstraints(facingMode, deviceId) {
  const base = {
    width: { ideal: 640 },
    height: { ideal: 480 }
  };

  if (deviceId) {
    return {
      ...base,
      deviceId: { exact: deviceId }
    };
  }

  return {
    ...base,
    facingMode: { ideal: facingMode }
  };
}

function positionFromCenter(centerRatio) {
  if (centerRatio < 0.4) {
    return "left";
  }

  if (centerRatio > 0.6) {
    return "right";
  }

  return "center";
}

function distanceFromFaceRatio(faceRatio) {
  if (faceRatio >= 0.35) {
    return "near";
  }

  if (faceRatio >= 0.18) {
    return "medium";
  }

  return "far";
}

function cameraErrorMessage(error) {
  if (!error) {
    return "Camera failed.";
  }

  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "Camera permission was denied.";
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No matching camera was found.";
  }

  if (error.name === "NotReadableError") {
    return "Camera is already in use or not readable.";
  }

  return error.message || "Camera failed.";
}

function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== "string") {
    return 0;
  }

  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
}
