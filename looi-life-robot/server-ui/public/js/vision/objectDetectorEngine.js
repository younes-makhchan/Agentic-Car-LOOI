import { clampInteger, clampNumber } from "../core/runtimeUtils.js";
import { canonicalObjectLabel, normalizeObjectLabel } from "./objectLabelUtils.js";

const ROBOFLOW_MODEL_INFO = {
  label: "Roboflow WebRTC",
  quality: "realtime cloud",
  inputShape: "camera stream",
  quantization: "hosted",
  description: "Roboflow WebRTC workflow output used for object follow."
};

export const DEFAULT_OBJECT_DETECTOR_MAX_RESULTS = 12;

const DEFAULT_MODULE_URL = "/vendor/roboflow-inference-sdk/index.es.js";
const DEFAULT_PROXY_URL = "/api/init-webrtc";
const DEFAULT_TURN_CONFIG_URL = "/api/roboflow-webrtc/turn-config";
const DEFAULT_TERMINATE_URL = "/api/roboflow-webrtc/terminate";
const DEFAULT_WAIT_FOR_RESULT_MS = 3200;
const DETECTION_STATUS_EMIT_INTERVAL_MS = 500;
const DETECTION_DEBUG_LOG_INTERVAL_MS = 2500;

export class ObjectDetectorEngine {
  constructor({
    logger,
    videoElement = null,
    cameraInput = null,
    moduleUrl = DEFAULT_MODULE_URL,
    proxyUrl = DEFAULT_PROXY_URL,
    turnConfigUrl = DEFAULT_TURN_CONFIG_URL,
    terminateUrl = DEFAULT_TERMINATE_URL,
    roboflowConfig = {},
    maxResults = DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
    categoryAllowlist = [],
    waitForResultMs = DEFAULT_WAIT_FOR_RESULT_MS,
    moduleLoader = null
  } = {}) {
    this.logger = logger;
    this.videoElement = videoElement;
    this.cameraInput = cameraInput;
    this.moduleUrl = moduleUrl || DEFAULT_MODULE_URL;
    this.proxyUrl = proxyUrl || DEFAULT_PROXY_URL;
    this.turnConfigUrl = turnConfigUrl || DEFAULT_TURN_CONFIG_URL;
    this.terminateUrl = terminateUrl || DEFAULT_TERMINATE_URL;
    this.roboflowConfig = normalizeRoboflowConfig(roboflowConfig);
    this.modelName = formatRoboflowModelName(this.roboflowConfig);
    this.maxResults = clampInteger(maxResults, 1, 30, DEFAULT_OBJECT_DETECTOR_MAX_RESULTS);
    this.categoryAllowlist = normalizeAllowlist(categoryAllowlist);
    this.waitForResultMs = clampInteger(waitForResultMs, 500, 10000, DEFAULT_WAIT_FOR_RESULT_MS);
    this.moduleLoader = moduleLoader;
    this.supported = typeof globalThis !== "undefined" && typeof globalThis.document !== "undefined";
    this.ready = false;
    this.running = false;
    this.starting = false;
    this.sdk = null;
    this.connection = null;
    this.pipelineId = null;
    this.sourceStream = null;
    this.remoteStream = null;
    this.lastDetectionAt = null;
    this.lastResult = null;
    this.lastError = null;
    this.lastStatusEmitAt = 0;
    this.lastDetectionLogAt = 0;
    this.resultWaiters = new Set();
    this.callbacks = {
      onDetections: new Set(),
      onStatus: new Set(),
      onError: new Set()
    };
  }

  async init() {
    if (this.ready && this.sdk) {
      return this.getStatus();
    }

    if (!this.supported) {
      this.lastError = "Roboflow WebRTC detection is only available in the browser.";
      this.emitStatus();
      return this.getStatus();
    }

    if (!this.roboflowConfig.configured) {
      this.lastError = "Roboflow WebRTC is not configured. Set ROBOFLOW_API_KEY, ROBOFLOW_WORKSPACE, and ROBOFLOW_WORKFLOW_ID.";
      this.emitStatus();
      return this.getStatus();
    }

    try {
      this.sdk = await this.loadRoboflowModule();
      this.ready = Boolean(this.sdk?.connectors && this.sdk?.webrtc);
      this.lastError = this.ready ? null : "Roboflow WebRTC SDK did not expose connectors/webrtc.";
      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      this.ready = false;
      this.sdk = null;
      this.lastError = error.message;
      this.emitError(error);
      this.emitStatus();
      return this.getStatus();
    }
  }

  async start() {
    if (this.running || this.starting) {
      return this.getStatus();
    }

    if (!this.ready) {
      await this.init();
    }

    if (!this.ready) {
      return this.getStatus();
    }

    const inputStream = this.getInputStream();
    if (!inputStream) {
      this.lastError = this.cameraInput?.isRunning?.() ? "camera stream unavailable" : "camera_not_running";
      this.emitStatus();
      return this.getStatus();
    }

    this.starting = true;
    this.lastError = null;
    this.emitStatus();

    try {
      this.sourceStream = cloneMediaStream(inputStream);
      const proxyConnector = this.sdk.connectors.withProxyUrl(this.proxyUrl, {
        turnConfigUrl: this.turnConfigUrl
      });
      const connector = {
        ...proxyConnector,
        connectWrtc: async (offer, wrtcParams) => {
          const answer = await proxyConnector.connectWrtc(offer, wrtcParams);
          this.pipelineId = answer?.context?.pipeline_id ?? null;
          return answer;
        }
      };

      this.connection = await this.sdk.webrtc.useStream({
        source: this.sourceStream,
        connector,
        wrtcParams: this.buildWrtcParams(),
        onData: (data) => this.handleWebrtcData(data)
      });

      this.connection.remoteStream?.()
        ?.then?.((stream) => {
          this.remoteStream = stream;
        })
        ?.catch?.((error) => {
          this.log(`remote stream unavailable: ${error.message}`, "warn");
        });

      this.running = true;
      this.log(
        `detector started workflow=${this.roboflowConfig.workspace || "inline"}/${this.roboflowConfig.workflowId || "spec"} region=${this.roboflowConfig.requestedRegion || "default"}`
      );
    } catch (error) {
      await this.cleanupConnection({ terminate: true, quiet: true });
      this.lastError = error.message;
      this.emitError(error);
    } finally {
      this.starting = false;
      this.emitStatus();
    }

    return this.getStatus();
  }

  stop() {
    this.running = false;
    this.starting = false;
    this.resolveWaiters(this.emptyResult("detector_stopped", { emitStatus: false }));
    this.cleanupConnection({ terminate: true, quiet: true }).catch((error) => {
      this.log(`cleanup failed: ${error.message}`, "warn");
    });
    this.log("detector stopped");
    this.emitStatus();
    return this.getStatus();
  }

  isRunning() {
    return Boolean(this.running);
  }

  setMaxResults(value) {
    this.maxResults = clampInteger(value, 1, 30, this.maxResults);
    this.log(`maxResults set ${this.maxResults}`);
    this.emitStatus();
    return this.maxResults;
  }

  setCategoryAllowlist(list) {
    this.categoryAllowlist = normalizeAllowlist(list);
    this.log(`allowlist set ${this.categoryAllowlist.length ? this.categoryAllowlist.join(",") : "all"}`);
    this.emitStatus();
    return [...this.categoryAllowlist];
  }

  async setRequestedPlan(value, { restart = false } = {}) {
    const requestedPlan = normalizeRequestedPlan(value, this.roboflowConfig.requestedPlan);
    if (!requestedPlan || requestedPlan === this.roboflowConfig.requestedPlan) {
      return {
        ...this.getStatus(),
        restartRequired: false
      };
    }

    const restartRequired = Boolean(this.running || this.starting);
    this.roboflowConfig = {
      ...this.roboflowConfig,
      requestedPlan
    };
    this.log(`gpu plan set ${requestedPlan}${restartRequired ? " restart_required=true" : ""}`, restartRequired ? "warn" : "info");
    this.emitStatus();

    if (restart && restartRequired) {
      return this.restart(`gpu_plan:${requestedPlan}`);
    }

    return {
      ...this.getStatus(),
      restartRequired
    };
  }

  async setWorkflowId(value, { restart = false } = {}) {
    const workflowId = normalizeWorkflowId(value, this.roboflowConfig.workflowId);
    if (!workflowId || workflowId === this.roboflowConfig.workflowId) {
      return {
        ...this.getStatus(),
        restartRequired: false
      };
    }

    const restartRequired = Boolean(this.running || this.starting);
    this.roboflowConfig = {
      ...this.roboflowConfig,
      workflowId,
      workflowOptions: uniqueStrings([workflowId, ...this.roboflowConfig.workflowOptions]),
      hasWorkflowSpec: false
    };
    this.modelName = formatRoboflowModelName(this.roboflowConfig);
    this.log(`workflow set ${workflowId}${restartRequired ? " restart_required=true" : ""}`, restartRequired ? "warn" : "info");
    this.emitStatus();

    if (restart && restartRequired) {
      return this.restart(`workflow:${workflowId}`);
    }

    return {
      ...this.getStatus(),
      restartRequired
    };
  }

  async restart(reason = "detector_restart") {
    const shouldStart = Boolean(this.running || this.starting);
    this.running = false;
    this.starting = false;
    this.resolveWaiters(this.emptyResult(reason, { emitStatus: false }));
    await this.cleanupConnection({ terminate: true, quiet: true });
    this.emitStatus();

    return shouldStart ? this.start() : this.getStatus();
  }

  async detectOnce() {
    if (this.lastResult?.timestamp) {
      const ageMs = Date.now() - Date.parse(this.lastResult.timestamp);
      if (Number.isFinite(ageMs) && ageMs < 1000) {
        return this.lastResult;
      }
    }

    if (!this.running) {
      const status = await this.start();
      if (!status.running) {
        return this.emptyResult("detector_unavailable");
      }
    }

    return this.waitForNextResult(this.waitForResultMs);
  }

  getStatus() {
    return {
      supported: this.supported,
      ready: this.ready,
      running: this.running,
      starting: this.starting,
      modelName: this.modelName,
      modelQuality: ROBOFLOW_MODEL_INFO.quality,
      modelInputShape: ROBOFLOW_MODEL_INFO.inputShape,
      modelQuantization: ROBOFLOW_MODEL_INFO.quantization,
      modelDescription: ROBOFLOW_MODEL_INFO.description,
      maxResults: this.maxResults,
      categoryAllowlist: [...this.categoryAllowlist],
      provider: "roboflow_webrtc",
      configured: Boolean(this.roboflowConfig.configured),
      workspace: this.roboflowConfig.workspace,
      workflowId: this.roboflowConfig.workflowId,
      workflowOptions: [...this.roboflowConfig.workflowOptions],
      hasWorkflowSpec: Boolean(this.roboflowConfig.hasWorkflowSpec),
      requestedPlan: this.roboflowConfig.requestedPlan,
      requestedRegion: this.roboflowConfig.requestedRegion,
      pipelineId: this.pipelineId,
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

  buildWrtcParams() {
    const params = {
      imageInputName: this.roboflowConfig.imageInputName || "image",
      streamOutputNames: this.roboflowConfig.streamOutputNames,
      dataOutputNames: this.roboflowConfig.dataOutputNames,
      realtimeProcessing: true,
      realtime_processing: true
    };

    if (!this.roboflowConfig.hasWorkflowSpec) {
      params.workspaceName = this.roboflowConfig.workspace;
      params.workflowId = this.roboflowConfig.workflowId;
    }
    if (Number.isFinite(Number(this.roboflowConfig.threadPoolWorkers))) {
      params.threadPoolWorkers = Number(this.roboflowConfig.threadPoolWorkers);
    }
    if (Number.isFinite(Number(this.roboflowConfig.processingTimeout))) {
      params.processingTimeout = Number(this.roboflowConfig.processingTimeout);
    }
    if (this.roboflowConfig.requestedPlan) {
      params.requestedPlan = this.roboflowConfig.requestedPlan;
    }
    if (this.roboflowConfig.requestedRegion) {
      params.requestedRegion = this.roboflowConfig.requestedRegion;
    }

    return params;
  }

  async loadRoboflowModule() {
    if (typeof this.moduleLoader === "function") {
      return this.moduleLoader();
    }

    return import(this.moduleUrl);
  }

  getInputStream() {
    const stream = this.cameraInput?.stream ?? this.videoElement?.srcObject;
    return stream && typeof stream.getVideoTracks === "function" && stream.getVideoTracks().length
      ? stream
      : null;
  }

  handleWebrtcData(data) {
    const result = this.normalizeRoboflowData(data);
    if (this.isOutOfOrderResult(result)) {
      this.log(
        `dropped out-of-order frame frame=${result.videoMetadata?.frame_id ?? "unknown"} ageMs=${formatAgeMs(result.frameAgeMs)}`,
        "debug"
      );
      return;
    }

    const now = Date.now();
    this.lastDetectionAt = now;
    this.lastResult = result;
    this.lastError = Array.isArray(data?.errors) && data.errors.length ? data.errors.join("; ") : null;
    if (now - this.lastDetectionLogAt >= DETECTION_DEBUG_LOG_INTERVAL_MS) {
      this.lastDetectionLogAt = now;
      this.log(`detected count=${result.detections.length} objects=${summarizeDetectionsForLog(result.detections)}`, "debug");
    }
    this.emitDetections(result);
    this.emitStatus({ throttleMs: DETECTION_STATUS_EMIT_INTERVAL_MS, now });
    this.resolveWaiters(result);
  }

  normalizeRoboflowData(data = {}) {
    const root = data?.serialized_output_data && typeof data.serialized_output_data === "object"
      ? data.serialized_output_data
      : data;
    const predictionSource = extractPredictionSource(root);
    const videoMetadata = extractVideoMetadata(data, root, predictionSource.root);
    const timestamp = normalizeFrameTimestamp(videoMetadata) ?? new Date().toISOString();
    const predictions = predictionSource.predictions
      .map((prediction) => normalizeRoboflowPrediction(prediction, predictionSource.root, this.videoElement))
      .filter(Boolean)
      .filter((detection) => !this.categoryAllowlist.length || this.categoryAllowlist.includes(detection.label));
    const frameSize = extractFrameSize(predictionSource.root, predictions, this.videoElement);

    const detections = predictions
      .map((detection) => finalizeDetection(detection, frameSize.width, frameSize.height))
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence);

    return {
      timestamp,
      receivedAt: new Date().toISOString(),
      frameReceivedAtMs: Date.parse(timestamp),
      frameAgeMs: computeFrameAgeMs(timestamp),
      videoMetadata,
      frameWidth: frameSize.width,
      frameHeight: frameSize.height,
      provider: "roboflow_webrtc",
      detections: suppressDuplicateDetections(detections).slice(0, this.maxResults)
    };
  }

  isOutOfOrderResult(result = {}) {
    const nextFrameId = Number(result.videoMetadata?.frame_id);
    const previousFrameId = Number(this.lastResult?.videoMetadata?.frame_id);
    if (Number.isFinite(nextFrameId) && Number.isFinite(previousFrameId)) {
      return nextFrameId < previousFrameId;
    }

    const nextFrameMs = Number(result.frameReceivedAtMs);
    const previousFrameMs = Number(this.lastResult?.frameReceivedAtMs);
    if (!Number.isFinite(nextFrameMs) || !Number.isFinite(previousFrameMs)) {
      return false;
    }

    return nextFrameMs < previousFrameMs;
  }

  waitForNextResult(timeoutMs) {
    return new Promise((resolve) => {
      const timeout = globalThis.setTimeout(() => {
        this.resultWaiters.delete(waiter);
        resolve(this.lastResult ?? this.emptyResult("detection_timeout"));
      }, Math.max(1, Number(timeoutMs) || DEFAULT_WAIT_FOR_RESULT_MS));
      const waiter = (result) => {
        globalThis.clearTimeout(timeout);
        resolve(result);
      };
      this.resultWaiters.add(waiter);
    });
  }

  resolveWaiters(result) {
    const waiters = [...this.resultWaiters];
    this.resultWaiters.clear();
    waiters.forEach((resolve) => resolve(result));
  }

  async cleanupConnection({ terminate = false, quiet = false } = {}) {
    const connection = this.connection;
    const pipelineId = this.pipelineId;
    const sourceStream = this.sourceStream;

    this.connection = null;
    this.pipelineId = null;
    this.sourceStream = null;
    this.remoteStream = null;

    await connection?.cleanup?.();
    stopStreamTracks(sourceStream);

    if (terminate && pipelineId) {
      await postJson(this.terminateUrl, { pipelineId }).catch((error) => {
        if (!quiet) {
          this.log(`pipeline terminate failed: ${error.message}`, "warn");
        }
      });
    }
  }

  emptyResult(reason, { emitStatus = true } = {}) {
    const result = {
      timestamp: new Date().toISOString(),
      frameWidth: Number(this.videoElement?.videoWidth || this.videoElement?.clientWidth || 0),
      frameHeight: Number(this.videoElement?.videoHeight || this.videoElement?.clientHeight || 0),
      provider: "roboflow_webrtc",
      detections: [],
      reason
    };
    this.lastResult = result;
    if (emitStatus) {
      this.emitStatus();
    }
    return result;
  }

  emitDetections(result) {
    this.callbacks.onDetections.forEach((callback) => callback(result));
  }

  emitStatus({ throttleMs = 0, now = Date.now() } = {}) {
    if (throttleMs > 0 && now - this.lastStatusEmitAt < throttleMs) {
      return;
    }

    this.lastStatusEmitAt = now;
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
      this.logger(`[roboflow] ${message}`, level);
    }
  }
}

function extractPredictionSource(root = {}) {
  const containers = collectPredictionContainers(root);
  for (const container of containers) {
    const predictions = extractPredictionList(container);
    if (predictions.length) {
      return { root: container, predictions };
    }
  }

  return { root, predictions: [] };
}

function extractVideoMetadata(...candidates) {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const metadata = candidate.video_metadata ?? candidate.videoMetadata;
    if (metadata && typeof metadata === "object") {
      return { ...metadata };
    }
  }

  return null;
}

function collectPredictionContainers(value, containers = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return containers;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPredictionContainers(entry, containers, seen));
    return containers;
  }

  containers.push(value);

  if (value.predictions && typeof value.predictions === "object") {
    collectPredictionContainers(value.predictions, containers, seen);
  }
  if (value.output && typeof value.output === "object") {
    collectPredictionContainers(value.output, containers, seen);
  }
  if (value.result && typeof value.result === "object") {
    collectPredictionContainers(value.result, containers, seen);
  }

  return containers;
}

function extractPredictionList(root = {}) {
  const candidates = [
    root.predictions,
    root.predictions?.predictions,
    root.output?.predictions,
    root.result?.predictions,
    root.detections,
    root.objects
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  for (const value of Object.values(root || {})) {
    if (Array.isArray(value)) {
      const hasBoxes = value.some((entry) => entry && typeof entry === "object" && hasBoxShape(entry));
      if (hasBoxes) {
        return value;
      }
    }
    if (value && typeof value === "object" && Array.isArray(value.predictions)) {
      return value.predictions;
    }
  }

  return [];
}

function normalizeRoboflowPrediction(prediction, root, videoElement) {
  if (!prediction || typeof prediction !== "object") {
    return null;
  }

  const rawLabel = prediction.class || prediction.class_name || prediction.label || prediction.name || "";
  const label = canonicalObjectLabel(rawLabel);
  if (!label) {
    return null;
  }

  const frameSize = extractFrameSize(root, [], videoElement);
  const box = normalizeBox(prediction, frameSize.width, frameSize.height);
  if (!box) {
    return null;
  }

  return {
    label,
    displayName: normalizeObjectLabel(rawLabel) || label,
    confidence: clampNumber(prediction.confidence ?? prediction.score ?? prediction.probability, 0, 1, 0),
    bbox: box,
    rawCategoryIndex: Number.isFinite(Number(prediction.class_id ?? prediction.classId))
      ? Number(prediction.class_id ?? prediction.classId)
      : null,
    source: "roboflow_webrtc"
  };
}

function normalizeBox(prediction, frameWidth, frameHeight) {
  const bbox = prediction.bbox || prediction.box || prediction.bounding_box;
  if (bbox && typeof bbox === "object") {
    const width = numberOrNull(bbox.width ?? bbox.w);
    const height = numberOrNull(bbox.height ?? bbox.h);
    const left = numberOrNull(bbox.left ?? bbox.x1 ?? bbox.x_min);
    const top = numberOrNull(bbox.top ?? bbox.y1 ?? bbox.y_min);
    const x = numberOrNull(bbox.x);
    const y = numberOrNull(bbox.y);

    if (left !== null && top !== null && width !== null && height !== null) {
      return scaleBox({ x: left, y: top, width, height }, frameWidth, frameHeight, false);
    }
    if (x !== null && y !== null && width !== null && height !== null) {
      return scaleBox({ x, y, width, height }, frameWidth, frameHeight, true);
    }
  }

  const x1 = numberOrNull(prediction.x1 ?? prediction.left ?? prediction.x_min);
  const y1 = numberOrNull(prediction.y1 ?? prediction.top ?? prediction.y_min);
  const x2 = numberOrNull(prediction.x2 ?? prediction.right ?? prediction.x_max);
  const y2 = numberOrNull(prediction.y2 ?? prediction.bottom ?? prediction.y_max);
  if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
    return scaleBox({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, frameWidth, frameHeight, false);
  }

  const x = numberOrNull(prediction.x);
  const y = numberOrNull(prediction.y);
  const width = numberOrNull(prediction.width ?? prediction.w);
  const height = numberOrNull(prediction.height ?? prediction.h);
  if (x !== null && y !== null && width !== null && height !== null) {
    return scaleBox({ x, y, width, height }, frameWidth, frameHeight, true);
  }

  return null;
}

function scaleBox(box, frameWidth, frameHeight, centerBased) {
  const normalized = Math.max(Math.abs(box.x), Math.abs(box.y), Math.abs(box.width), Math.abs(box.height)) <= 1.5;
  const scaled = {
    x: box.x * (normalized ? frameWidth : 1),
    y: box.y * (normalized ? frameHeight : 1),
    width: box.width * (normalized ? frameWidth : 1),
    height: box.height * (normalized ? frameHeight : 1)
  };
  const x = centerBased ? scaled.x - scaled.width / 2 : scaled.x;
  const y = centerBased ? scaled.y - scaled.height / 2 : scaled.y;

  return {
    x: clampNumber(x, 0, frameWidth, 0),
    y: clampNumber(y, 0, frameHeight, 0),
    width: clampNumber(scaled.width, 0, frameWidth, 0),
    height: clampNumber(scaled.height, 0, frameHeight, 0)
  };
}

function finalizeDetection(detection, frameWidth, frameHeight) {
  const bbox = detection.bbox;
  const centerX = clampNumber((bbox.x + bbox.width / 2) / frameWidth, 0, 1, 0.5);
  const centerY = clampNumber((bbox.y + bbox.height / 2) / frameHeight, 0, 1, 0.5);
  const areaRatio = clampNumber((bbox.width * bbox.height) / (frameWidth * frameHeight), 0, 1, 0);

  return {
    ...detection,
    bbox,
    centerX,
    centerY,
    areaRatio,
    position: centerX < 0.4 ? "left" : centerX > 0.6 ? "right" : "center",
    verticalPosition: centerY < 0.4 ? "top" : centerY > 0.6 ? "bottom" : "middle",
    distance: areaRatio > 0.18 ? "near" : areaRatio < 0.05 ? "far" : "medium"
  };
}

function suppressDuplicateDetections(detections = []) {
  const kept = [];

  detections.forEach((detection) => {
    const duplicate = kept.some((existing) => {
      if (existing.label !== detection.label) {
        return false;
      }

      const overlap = measureBoxOverlap(existing.bbox, detection.bbox);
      return overlap.iou >= 0.55 || overlap.smallerOverlap >= 0.8;
    });

    if (!duplicate) {
      kept.push(detection);
    }
  });

  return kept;
}

function measureBoxOverlap(a = {}, b = {}) {
  const ax1 = Number(a.x ?? 0);
  const ay1 = Number(a.y ?? 0);
  const ax2 = ax1 + Number(a.width ?? 0);
  const ay2 = ay1 + Number(a.height ?? 0);
  const bx1 = Number(b.x ?? 0);
  const by1 = Number(b.y ?? 0);
  const bx2 = bx1 + Number(b.width ?? 0);
  const by2 = by1 + Number(b.height ?? 0);
  const intersectionWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const intersectionHeight = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - intersection;
  const smaller = Math.min(areaA, areaB);

  return {
    iou: union > 0 ? intersection / union : 0,
    smallerOverlap: smaller > 0 ? intersection / smaller : 0
  };
}

function normalizeFrameTimestamp(videoMetadata) {
  const receivedAt = videoMetadata?.received_at ?? videoMetadata?.receivedAt;
  const time = Date.parse(receivedAt);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function computeFrameAgeMs(timestamp) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? Math.max(0, Date.now() - time) : null;
}

function formatAgeMs(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "unknown";
}

function extractFrameSize(root = {}, detections = [], videoElement = null) {
  const image = root.image || root.input_image || root.predictions?.image || root.output?.image || {};
  const width = numberOrNull(image.width ?? root.image_width ?? root.width);
  const height = numberOrNull(image.height ?? root.image_height ?? root.height);

  if (width && height) {
    return { width, height };
  }

  const maxX = Math.max(0, ...detections.map((detection) => detection.bbox.x + detection.bbox.width));
  const maxY = Math.max(0, ...detections.map((detection) => detection.bbox.y + detection.bbox.height));

  return {
    width: Math.max(1, Number(videoElement?.videoWidth || videoElement?.clientWidth || maxX || 640)),
    height: Math.max(1, Number(videoElement?.videoHeight || videoElement?.clientHeight || maxY || 480))
  };
}

function hasBoxShape(value) {
  return Boolean(
    value?.bbox ||
    value?.box ||
    value?.bounding_box ||
    (value?.x !== undefined && value?.y !== undefined && (value?.width !== undefined || value?.w !== undefined)) ||
    (value?.x1 !== undefined && value?.y1 !== undefined && value?.x2 !== undefined && value?.y2 !== undefined)
  );
}

function normalizeAllowlist(list) {
  if (typeof list === "string") {
    return list.split(",").map(canonicalObjectLabel).filter(Boolean);
  }

  return Array.isArray(list)
    ? list.map(canonicalObjectLabel).filter(Boolean)
    : [];
}

function normalizeRoboflowConfig(config = {}) {
  const streamOutputNames = normalizeNameList(config.streamOutputNames, []);
  const dataOutputNames = normalizeNameList(config.dataOutputNames, ["predictions"]);
  const workflowId = String(config.workflowId || "").trim();
  const workflowOptions = uniqueStrings([workflowId, ...normalizeNameList(config.workflowOptions, ["rf-detr", "rf-detr-2"])]);

  return {
    enabled: config.enabled !== false,
    configured: Boolean(config.configured),
    workspace: String(config.workspace || "").trim(),
    workflowId,
    workflowOptions,
    hasWorkflowSpec: Boolean(config.hasWorkflowSpec),
    imageInputName: String(config.imageInputName || "image").trim() || "image",
    streamOutputNames,
    dataOutputNames,
    threadPoolWorkers: config.threadPoolWorkers,
    processingTimeout: config.processingTimeout,
    requestedPlan: String(config.requestedPlan || "").trim(),
    requestedRegion: String(config.requestedRegion || "").trim()
  };
}

function normalizeRequestedPlan(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeWorkflowId(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function formatRoboflowModelName(config = {}) {
  return config.workflowId
    ? `${ROBOFLOW_MODEL_INFO.label} (${config.workflowId})`
    : ROBOFLOW_MODEL_INFO.label;
}

function normalizeNameList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function cloneMediaStream(stream) {
  const tracks = stream.getVideoTracks?.().map((track) => track.clone()) ?? [];
  return new MediaStream(tracks);
}

function stopStreamTracks(stream) {
  stream?.getTracks?.().forEach((track) => {
    try {
      track.stop();
    } catch (_error) {
      // Track stop failures are non-actionable cleanup noise.
    }
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

function addCallback(set, callback) {
  if (typeof callback !== "function") {
    return () => {};
  }

  set.add(callback);
  return () => set.delete(callback);
}

function summarizeDetectionsForLog(detections = []) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return "none";
  }

  return detections
    .slice(0, 6)
    .map((detection) => {
      const confidence = Number(detection.confidence);
      const confidenceText = Number.isFinite(confidence) ? confidence.toFixed(2) : "n/a";
      const centerX = Number.isFinite(Number(detection.centerX)) ? Number(detection.centerX).toFixed(2) : "n/a";
      const centerY = Number.isFinite(Number(detection.centerY)) ? Number(detection.centerY).toFixed(2) : "n/a";
      const bbox = detection.bbox ?? {};
      const bboxText = [
        Math.round(Number(bbox.x || 0)),
        Math.round(Number(bbox.y || 0)),
        Math.round(Number(bbox.width || 0)),
        Math.round(Number(bbox.height || 0))
      ].join("/");
      return `${detection.label}:${confidenceText}:${detection.position ?? "unknown"}:${detection.distance ?? "unknown"}:center=${centerX}/${centerY}:bbox=${bboxText}`;
    })
    .join(",");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
