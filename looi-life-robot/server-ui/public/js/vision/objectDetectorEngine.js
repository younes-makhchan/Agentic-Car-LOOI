import { canonicalObjectLabel, normalizeObjectLabel } from "./objectLabelUtils.js";

export const OBJECT_DETECTOR_MODEL_PRESETS = {
  efficientdet_lite2_int8: {
    label: "EfficientDet-Lite2 int8",
    quality: "stronger",
    inputShape: "448 x 448",
    quantization: "int8",
    description: "Best default for object follow: stronger than Lite0 with manageable phone cost.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/latest/efficientdet_lite2.tflite"
  },
  efficientdet_lite0_int8: {
    label: "EfficientDet-Lite0 int8",
    quality: "fast",
    inputShape: "320 x 320",
    quantization: "int8",
    description: "Fastest EfficientDet option; can miss small or low-contrast objects.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite"
  },
  efficientdet_lite0_float16: {
    label: "EfficientDet-Lite0 float16",
    quality: "balanced",
    inputShape: "320 x 320",
    quantization: "float16",
    description: "Lite0 with float16 weights; slightly heavier than int8.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/latest/efficientdet_lite0.tflite"
  },
  efficientdet_lite0_float32: {
    label: "EfficientDet-Lite0 float32",
    quality: "balanced, heavier",
    inputShape: "320 x 320",
    quantization: "float32",
    description: "Lite0 float32 model; heavier than quantized variants.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/latest/efficientdet_lite0.tflite"
  },
  efficientdet_lite2_float16: {
    label: "EfficientDet-Lite2 float16",
    quality: "stronger, heavier",
    inputShape: "448 x 448",
    quantization: "float16",
    description: "Higher-quality Lite2 model; heavier than int8.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/latest/efficientdet_lite2.tflite"
  },
  efficientdet_lite2_float32: {
    label: "EfficientDet-Lite2 float32",
    quality: "strongest, heaviest",
    inputShape: "448 x 448",
    quantization: "float32",
    description: "Highest-quality EfficientDet preset here; use if phone performance is acceptable.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float32/latest/efficientdet_lite2.tflite"
  },
  ssd_mobilenet_v2_float16: {
    label: "SSD MobileNetV2 float16",
    quality: "fast alternative",
    inputShape: "256 x 256",
    quantization: "float16",
    description: "Fast SSD alternative; lower input resolution can miss small objects.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/ssd_mobilenet_v2/float16/latest/ssd_mobilenet_v2.tflite"
  },
  ssd_mobilenet_v2_float32: {
    label: "SSD MobileNetV2 float32",
    quality: "fast alternative, heavier",
    inputShape: "256 x 256",
    quantization: "float32",
    description: "SSD float32 alternative; heavier than float16.",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/ssd_mobilenet_v2/float32/latest/ssd_mobilenet_v2.tflite"
  }
};

export const DEFAULT_OBJECT_DETECTOR_MODEL_PRESET = "efficientdet_lite2_int8";
export const DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD = 0.5;
export const DEFAULT_OBJECT_DETECTOR_MAX_RESULTS = 12;

const DEFAULT_MODEL_ASSET_PATH = OBJECT_DETECTOR_MODEL_PRESETS[DEFAULT_OBJECT_DETECTOR_MODEL_PRESET].url;
const DEFAULT_WASM_BASE_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const DEFAULT_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/+esm";

export class ObjectDetectorEngine {
  constructor({
    logger,
    videoElement = null,
    cameraInput = null,
    modelPreset = null,
    modelAssetPath = null,
    wasmBasePath = DEFAULT_WASM_BASE_PATH,
    moduleUrl = DEFAULT_MODULE_URL,
    scoreThreshold = DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD,
    maxResults = DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
    categoryAllowlist = [],
    detectionIntervalMs = 1000,
    detectorFactory = null,
    moduleLoader = null
  } = {}) {
    this.logger = logger;
    this.videoElement = videoElement;
    this.cameraInput = cameraInput;
    const resolvedModel = resolveModelPreset({ modelPreset, modelAssetPath });
    this.modelPreset = resolvedModel.modelPreset;
    this.modelName = resolvedModel.modelName;
    this.modelAssetPath = resolvedModel.modelAssetPath;
    this.wasmBasePath = wasmBasePath;
    this.moduleUrl = moduleUrl;
    this.scoreThreshold = clampNumber(scoreThreshold, 0.05, 0.99, DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD);
    this.maxResults = clampInteger(maxResults, 1, 30, DEFAULT_OBJECT_DETECTOR_MAX_RESULTS);
    this.categoryAllowlist = normalizeAllowlist(categoryAllowlist);
    this.detectionIntervalMs = clampInteger(detectionIntervalMs, 200, 5000, 1000);
    this.detectorFactory = detectorFactory;
    this.moduleLoader = moduleLoader;
    this.supported = typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined";
    this.ready = false;
    this.running = false;
    this.detector = null;
    this.timer = null;
    this.detecting = false;
    this.lastDetectionAt = null;
    this.lastResult = null;
    this.lastError = null;
    this.callbacks = {
      onDetections: new Set(),
      onStatus: new Set(),
      onError: new Set()
    };
  }

  async init() {
    if (this.ready && this.detector) {
      return this.getStatus();
    }

    if (!this.supported && !this.detectorFactory) {
      this.lastError = "Object detection is only available in the browser.";
      this.emitStatus();
      return this.getStatus();
    }

    try {
      if (typeof this.detectorFactory === "function") {
        this.detector = await this.detectorFactory(this.buildDetectorOptions());
      } else {
        const { FilesetResolver, ObjectDetector } = await this.loadMediaPipeModule();
        const vision = await FilesetResolver.forVisionTasks(this.wasmBasePath);
        this.detector = await ObjectDetector.createFromOptions(vision, this.buildDetectorOptions());
      }

      this.ready = Boolean(this.detector);
      this.lastError = null;
      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      this.ready = false;
      this.detector = null;
      this.lastError = error.message;
      this.emitError(error);
      this.emitStatus();
      return this.getStatus();
    }
  }

  async start() {
    if (!this.ready) {
      await this.init();
    }

    if (!this.ready) {
      return this.getStatus();
    }

    this.running = true;
    this.emitStatus();
    this.scheduleNextDetection(0);
    return this.getStatus();
  }

  stop() {
    this.running = false;
    this.clearTimer();
    this.emitStatus();
    return this.getStatus();
  }

  isRunning() {
    return Boolean(this.running);
  }

  isReady() {
    return Boolean(this.ready);
  }

  setDetectionIntervalMs(ms) {
    this.detectionIntervalMs = clampInteger(ms, 200, 5000, this.detectionIntervalMs);
    this.emitStatus();
    return this.detectionIntervalMs;
  }

  setScoreThreshold(value) {
    this.scoreThreshold = clampNumber(value, 0.05, 0.99, this.scoreThreshold);
    this.detector?.setOptions?.({ scoreThreshold: this.scoreThreshold });
    this.emitStatus();
    return this.scoreThreshold;
  }

  setMaxResults(value) {
    this.maxResults = clampInteger(value, 1, 30, this.maxResults);
    this.detector?.setOptions?.({ maxResults: this.maxResults });
    this.emitStatus();
    return this.maxResults;
  }

  setCategoryAllowlist(list) {
    this.categoryAllowlist = normalizeAllowlist(list);
    this.detector?.setOptions?.({
      categoryAllowlist: this.categoryAllowlist.length ? this.categoryAllowlist : undefined
    });
    this.emitStatus();
    return [...this.categoryAllowlist];
  }

  async setModelAssetPath(modelAssetPath, { modelPreset = "custom", modelName = "" } = {}) {
    const nextPath = String(modelAssetPath ?? "").trim();

    if (!nextPath || nextPath === this.modelAssetPath) {
      return this.getStatus();
    }

    const wasRunning = this.running;
    this.stop();
    this.detector?.close?.();
    this.detector = null;
    this.ready = false;
    const resolvedModel = resolveModelPreset({ modelPreset, modelAssetPath: nextPath, modelName });
    this.modelAssetPath = resolvedModel.modelAssetPath;
    this.modelPreset = resolvedModel.modelPreset;
    this.modelName = resolvedModel.modelName;
    this.lastResult = null;
    this.lastDetectionAt = null;
    this.lastError = null;
    this.emitStatus();

    if (wasRunning) {
      return this.start();
    }

    return this.init();
  }

  async detectOnce() {
    if (!this.ready) {
      await this.init();
    }

    if (!this.ready || !this.detector) {
      return this.emptyResult("detector_unavailable");
    }

    if (!this.isVideoReady()) {
      return this.emptyResult(this.cameraInput?.isRunning?.() ? "video_not_ready" : "camera_not_running");
    }

    try {
      const now = performanceNow();
      const rawResult = typeof this.detector.detectForVideo === "function"
        ? this.detector.detectForVideo(this.videoElement, now)
        : this.detector.detect(this.videoElement);
      const result = this.normalizeDetections(rawResult);
      this.lastDetectionAt = Date.now();
      this.lastResult = result;
      this.lastError = null;
      this.emitDetections(result);
      this.emitStatus();
      return result;
    } catch (error) {
      this.lastError = error.message;
      this.emitError(error);
      this.emitStatus();
      return this.emptyResult("detection_failed");
    }
  }

  normalizeDetections(rawResult = {}) {
    const frameWidth = Math.max(
      1,
      Number(rawResult.frameWidth || this.videoElement?.videoWidth || this.videoElement?.clientWidth || 1)
    );
    const frameHeight = Math.max(
      1,
      Number(rawResult.frameHeight || this.videoElement?.videoHeight || this.videoElement?.clientHeight || 1)
    );
    const detections = Array.isArray(rawResult.detections) ? rawResult.detections : [];

    return {
      timestamp: new Date().toISOString(),
      frameWidth,
      frameHeight,
      detections: detections
        .map((detection) => normalizeDetection(detection, frameWidth, frameHeight))
        .filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.maxResults)
    };
  }

  getStatus() {
    return {
      supported: this.supported,
      ready: this.ready,
      running: this.running,
      modelPreset: this.modelPreset,
      modelName: this.modelName,
      modelAssetPath: this.modelAssetPath,
      modelQuality: OBJECT_DETECTOR_MODEL_PRESETS[this.modelPreset]?.quality ?? "custom",
      modelInputShape: OBJECT_DETECTOR_MODEL_PRESETS[this.modelPreset]?.inputShape ?? "custom",
      modelQuantization: OBJECT_DETECTOR_MODEL_PRESETS[this.modelPreset]?.quantization ?? "custom",
      modelDescription: OBJECT_DETECTOR_MODEL_PRESETS[this.modelPreset]?.description ?? "",
      wasmBasePath: this.wasmBasePath,
      scoreThreshold: this.scoreThreshold,
      maxResults: this.maxResults,
      categoryAllowlist: [...this.categoryAllowlist],
      detectionIntervalMs: this.detectionIntervalMs,
      lastDetectionAt: this.lastDetectionAt,
      lastError: this.lastError,
      detections: this.lastResult?.detections?.length ?? 0
    };
  }

  onDetections(callback) {
    return addCallback(this.callbacks.onDetections, callback);
  }

  onStatus(callback) {
    return addCallback(this.callbacks.onStatus, callback);
  }

  onError(callback) {
    return addCallback(this.callbacks.onError, callback);
  }

  buildDetectorOptions() {
    return {
      baseOptions: {
        modelAssetPath: this.modelAssetPath
      },
      runningMode: "VIDEO",
      scoreThreshold: this.scoreThreshold,
      maxResults: this.maxResults,
      ...(this.categoryAllowlist.length ? { categoryAllowlist: this.categoryAllowlist } : {})
    };
  }

  async loadMediaPipeModule() {
    if (typeof this.moduleLoader === "function") {
      return this.moduleLoader();
    }

    return import(this.moduleUrl);
  }

  scheduleNextDetection(delayMs = this.detectionIntervalMs) {
    this.clearTimer();

    if (!this.running) {
      return;
    }

    this.timer = globalThis.setTimeout(async () => {
      if (!this.running || this.detecting) {
        this.scheduleNextDetection();
        return;
      }

      this.detecting = true;
      try {
        await this.detectOnce();
      } finally {
        this.detecting = false;
        this.scheduleNextDetection();
      }
    }, Math.max(0, Number(delayMs) || 0));
  }

  clearTimer() {
    if (this.timer) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isVideoReady() {
    const cameraRunning = this.cameraInput?.isRunning?.() ?? Boolean(this.videoElement?.srcObject);
    return Boolean(
      cameraRunning &&
      this.videoElement &&
      Number(this.videoElement.readyState ?? 0) >= 2 &&
      Number(this.videoElement.videoWidth || this.videoElement.clientWidth || 0) > 0 &&
      Number(this.videoElement.videoHeight || this.videoElement.clientHeight || 0) > 0
    );
  }

  emptyResult(reason) {
    const result = {
      timestamp: new Date().toISOString(),
      frameWidth: Number(this.videoElement?.videoWidth || this.videoElement?.clientWidth || 0),
      frameHeight: Number(this.videoElement?.videoHeight || this.videoElement?.clientHeight || 0),
      detections: [],
      reason
    };
    this.lastResult = result;
    this.emitStatus();
    return result;
  }

  emitDetections(result) {
    this.callbacks.onDetections.forEach((callback) => callback(result));
  }

  emitStatus() {
    const status = this.getStatus();
    this.callbacks.onStatus.forEach((callback) => callback(status));
  }

  emitError(error) {
    const message = error?.message ?? String(error);
    this.lastError = message;
    this.callbacks.onError.forEach((callback) => callback(message));
    this.log(message, "warn");
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`Object detector: ${message}`, level);
    }
  }
}

function normalizeDetection(detection, frameWidth, frameHeight) {
  const categories = Array.isArray(detection?.categories) ? detection.categories : [];
  const category = categories
    .slice()
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0] ?? {};
  const rawLabel = category.categoryName || category.displayName || detection?.label || "";
  const label = canonicalObjectLabel(rawLabel);

  if (!label) {
    return null;
  }

  const bboxSource = detection.boundingBox ?? detection.bbox ?? {};
  const bbox = {
    x: clampNumber(bboxSource.originX ?? bboxSource.x, 0, frameWidth, 0),
    y: clampNumber(bboxSource.originY ?? bboxSource.y, 0, frameHeight, 0),
    width: clampNumber(bboxSource.width, 0, frameWidth, 0),
    height: clampNumber(bboxSource.height, 0, frameHeight, 0)
  };
  const centerX = clampNumber((bbox.x + bbox.width / 2) / frameWidth, 0, 1, 0.5);
  const centerY = clampNumber((bbox.y + bbox.height / 2) / frameHeight, 0, 1, 0.5);
  const areaRatio = clampNumber((bbox.width * bbox.height) / (frameWidth * frameHeight), 0, 1, 0);

  return {
    label,
    displayName: normalizeObjectLabel(rawLabel) || label,
    confidence: clampNumber(category.score ?? detection.confidence, 0, 1, 0),
    bbox,
    centerX,
    centerY,
    areaRatio,
    position: centerX < 0.4 ? "left" : centerX > 0.6 ? "right" : "center",
    verticalPosition: centerY < 0.4 ? "top" : centerY > 0.6 ? "bottom" : "middle",
    distance: areaRatio > 0.18 ? "near" : areaRatio < 0.05 ? "far" : "medium",
    rawCategoryIndex: Number.isFinite(Number(category.index)) ? Number(category.index) : null
  };
}

function normalizeAllowlist(list) {
  if (typeof list === "string") {
    return list.split(",").map(canonicalObjectLabel).filter(Boolean);
  }

  return Array.isArray(list)
    ? list.map(canonicalObjectLabel).filter(Boolean)
    : [];
}

function resolveModelPreset({ modelPreset = null, modelAssetPath = null, modelName = "" } = {}) {
  const explicitPath = String(modelAssetPath ?? "").trim();
  const presetFromPath = findModelPresetByUrl(explicitPath);
  const presetKey = OBJECT_DETECTOR_MODEL_PRESETS[modelPreset]
    ? modelPreset
    : presetFromPath ?? DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;
  const isCustom = explicitPath && !presetFromPath && !OBJECT_DETECTOR_MODEL_PRESETS[modelPreset];
  const resolvedPresetKey = isCustom ? "custom" : presetKey;
  const preset = OBJECT_DETECTOR_MODEL_PRESETS[resolvedPresetKey];

  return {
    modelPreset: resolvedPresetKey,
    modelName: modelName || preset?.label || "Custom object detector",
    modelAssetPath: explicitPath || preset?.url || DEFAULT_MODEL_ASSET_PATH
  };
}

function findModelPresetByUrl(url) {
  const normalizedUrl = String(url ?? "").trim();

  if (!normalizedUrl) {
    return null;
  }

  return Object.entries(OBJECT_DETECTOR_MODEL_PRESETS)
    .find(([, preset]) => preset.url === normalizedUrl)?.[0] ?? null;
}

function addCallback(set, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  set.add(callback);
  return () => set.delete(callback);
}

function performanceNow() {
  return Number(globalThis.performance?.now?.() ?? Date.now());
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
