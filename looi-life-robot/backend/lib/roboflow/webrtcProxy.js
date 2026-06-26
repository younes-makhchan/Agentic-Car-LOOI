import { InferenceHTTPClient, WorkflowError } from "@roboflow/inference-sdk";

const DEFAULT_SERVER_URL = "https://serverless.roboflow.com";
const DEFAULT_API_BASE_URL = "https://api.roboflow.com";
const DEFAULT_WORKFLOW_IDS = ["rf-detr", "rf-detr-2"];

export function getRoboflowWebrtcEnv(env = process.env) {
  const apiKey = String(env.ROBOFLOW_API_KEY || "").trim();
  const workspace = String(env.ROBOFLOW_WORKSPACE || "").trim();
  const workflowId = String(env.ROBOFLOW_WORKFLOW_ID || "").trim();
  const workflowOptions = uniqueStrings([
    workflowId,
    ...parseCsv(env.ROBOFLOW_WORKFLOW_IDS || env.ROBOFLOW_WORKFLOW_OPTIONS || DEFAULT_WORKFLOW_IDS.join(","))
  ]);
  const workflowSpec = parseJsonObject(env.ROBOFLOW_WORKFLOW_SPEC);

  return {
    enabled: env.ROBOFLOW_WEBRTC_ENABLED !== "false" && env.ROBOFLOW_ENABLED !== "false",
    configured: Boolean(apiKey && (workflowSpec || (workspace && workflowId))),
    apiKey,
    workspace,
    workflowId,
    workflowOptions,
    workflowSpec,
    imageInputName: optionalString(env.ROBOFLOW_IMAGE_INPUT_NAME) || "image",
    streamOutputNames: parseCsv(env.ROBOFLOW_STREAM_OUTPUT_NAMES || ""),
    dataOutputNames: parseCsv(env.ROBOFLOW_DATA_OUTPUT_NAMES || "predictions"),
    threadPoolWorkers: optionalNumber(env.ROBOFLOW_THREAD_POOL_WORKERS),
    processingTimeout: optionalNumber(env.ROBOFLOW_PROCESSING_TIMEOUT_SECONDS) ?? 3600,
    requestedPlan: optionalString(env.ROBOFLOW_REQUESTED_PLAN) || "webrtc-gpu-medium",
    requestedRegion: optionalString(env.ROBOFLOW_REQUESTED_REGION) || "eu",
    serverUrl: optionalString(env.ROBOFLOW_SERVER_URL) || DEFAULT_SERVER_URL,
    apiBaseUrl: optionalString(env.ROBOFLOW_API_BASE_URL) || DEFAULT_API_BASE_URL
  };
}

export function publicRoboflowWebrtcConfig(config = getRoboflowWebrtcEnv()) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    workspace: config.workspace,
    workflowId: config.workflowId,
    workflowOptions: config.workflowOptions,
    hasWorkflowSpec: Boolean(config.workflowSpec),
    imageInputName: config.imageInputName,
    streamOutputNames: config.streamOutputNames,
    dataOutputNames: config.dataOutputNames,
    threadPoolWorkers: config.threadPoolWorkers,
    processingTimeout: config.processingTimeout,
    requestedPlan: config.requestedPlan,
    requestedRegion: config.requestedRegion
  };
}

export async function initializeRoboflowWebrtcWorker(body = {}, env = process.env) {
  const config = getRoboflowWebrtcEnv(env);
  assertRoboflowReady(config, { requireWorkflow: false });

  const wrtcParams = body.wrtcParams && typeof body.wrtcParams === "object" ? body.wrtcParams : {};
  const workflowSpec = normalizeObject(wrtcParams.workflowSpec) || config.workflowSpec || undefined;
  const workspaceName = workflowSpec ? undefined : optionalString(wrtcParams.workspaceName) || config.workspace;
  const workflowId = workflowSpec ? undefined : optionalString(wrtcParams.workflowId) || config.workflowId;

  if (!workflowSpec && (!workspaceName || !workflowId)) {
    throw Object.assign(
      new Error("Provide workspaceName and workflowId in wrtcParams, or configure ROBOFLOW_WORKSPACE and ROBOFLOW_WORKFLOW_ID."),
      { statusCode: 400 }
    );
  }

  const client = createRoboflowClient(config);
  return client.initializeWebrtcWorker({
    offer: body.offer,
    workflowSpec,
    workspaceName,
    workflowId,
    config: {
      imageInputName: optionalString(wrtcParams.imageInputName) || config.imageInputName,
      streamOutputNames: normalizeNameList(wrtcParams.streamOutputNames, config.streamOutputNames),
      dataOutputNames: normalizeNameList(wrtcParams.dataOutputNames, config.dataOutputNames),
      threadPoolWorkers: optionalNumber(wrtcParams.threadPoolWorkers) ?? config.threadPoolWorkers,
      workflowsParameters: normalizeObject(wrtcParams.workflowsParameters) || {},
      iceServers: Array.isArray(wrtcParams.iceServers) ? wrtcParams.iceServers : undefined,
      processingTimeout: optionalNumber(wrtcParams.processingTimeout) ?? config.processingTimeout,
      requestedPlan: optionalString(wrtcParams.requestedPlan) || config.requestedPlan,
      requestedRegion: optionalString(wrtcParams.requestedRegion) || config.requestedRegion,
      realtimeProcessing:
        typeof wrtcParams.realtime_processing === "boolean"
          ? wrtcParams.realtime_processing
          : typeof wrtcParams.realtimeProcessing === "boolean"
            ? wrtcParams.realtimeProcessing
            : true
    }
  });
}

export async function fetchRoboflowTurnConfig(env = process.env) {
  const config = getRoboflowWebrtcEnv(env);
  assertRoboflowReady(config, { requireWorkflow: false });
  const client = createRoboflowClient(config);
  return client.fetchTurnConfig();
}

export async function terminateRoboflowPipeline(pipelineId, env = process.env) {
  const config = getRoboflowWebrtcEnv(env);
  assertRoboflowReady(config, { requireWorkflow: false });
  const id = optionalString(pipelineId);
  if (!id) {
    throw Object.assign(new Error("pipelineId is required"), { statusCode: 400 });
  }

  const client = createRoboflowClient(config);
  await client.terminatePipeline({ pipelineId: id });
}

export function isRoboflowWorkflowError(error) {
  return error instanceof WorkflowError;
}

function createRoboflowClient(config) {
  return InferenceHTTPClient.init({
    apiKey: config.apiKey,
    serverUrl: config.serverUrl,
    apiBaseUrl: config.apiBaseUrl
  });
}

function assertRoboflowReady(config, { requireWorkflow = true } = {}) {
  if (!config.enabled) {
    throw Object.assign(new Error("Roboflow WebRTC is disabled."), { statusCode: 404 });
  }

  if (!config.apiKey) {
    throw Object.assign(new Error("ROBOFLOW_API_KEY is not configured."), { statusCode: 400 });
  }

  if (requireWorkflow && !config.workflowSpec && (!config.workspace || !config.workflowId)) {
    throw Object.assign(
      new Error("Configure ROBOFLOW_WORKSPACE and ROBOFLOW_WORKFLOW_ID, or ROBOFLOW_WORKFLOW_SPEC."),
      { statusCode: 400 }
    );
  }
}

function normalizeNameList(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return parseCsv(value);
  }

  return Array.isArray(fallback) ? fallback : [];
}

function parseCsv(value = "") {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return normalizeObject(parsed);
  } catch (_error) {
    return null;
  }
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalString(value) {
  const text = String(value || "").trim();
  return text || undefined;
}
