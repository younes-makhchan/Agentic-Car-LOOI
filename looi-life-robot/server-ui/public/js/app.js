import { PUBLIC_CONFIG } from "./config.js";
import { LocalEventBus } from "./core/localEventBus.js";
import { clampNumber } from "./core/runtimeUtils.js";
import { EmbodiedActionRouter } from "./embodiment/embodiedActionRouter.js";
import { ScenarioFrameSequencer } from "./embodiment/scenarioFrameSequencer.js";
import { PriorityScheduler } from "./embodiment/priorityScheduler.js";
import { GeminiLiveRuntime } from "./gemini/geminiLiveRuntime.js";
import { LifeEngine } from "./life/lifeEngine.js";
import { LocalBrainEngine } from "./localBrain/localBrainEngine.js";
import { LocalServerBrainAdapter } from "./localBrain/localServerBrainAdapter.js";
import { MockBrainAdapter } from "./localBrain/mockBrainAdapter.js";
import { RuleBrainFallback } from "./localBrain/ruleBrainFallback.js";
import { AttentionSystem } from "./localBrain/attentionSystem.js";
import { BrainLatencyBudget } from "./localBrain/brainLatencyBudget.js";
import { clampBrainPolicy, createDefaultBrainPolicy } from "./localBrain/brainPolicy.js";
import { CameraInput } from "./perception/camera.js";
import { LifeEventEmitter } from "./personality/lifeEvents.js";
import { describePersonalityForRuntime } from "./personality/personalityProfile.js";
import { PersonalityTuning } from "./personality/personalityTuning.js";
import { BodyCalibration } from "./robot/bodyCalibration.js";
import { CommandQueue } from "./robot/commandQueue.js";
import { ESP32Client } from "./robot/esp32Client.js";
import { ToolExecutor } from "./robot/toolExecutor.js";
import { PerformanceMonitor } from "./runtime/performanceMonitor.js";
import { ReliabilityManager } from "./runtime/reliabilityManager.js";
import { WakeLockManager } from "./runtime/wakeLockManager.js";
import { createFaceController } from "./ui/faceCanvas.js";
import {
  DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
  ObjectDetectorEngine
} from "./vision/objectDetectorEngine.js";
import { ObjectTracker } from "./vision/objectTracker.js";
import { VisionState } from "./vision/visionState.js";
import { buildVisionContext, findMentionedObjectLabels } from "./vision/visionMetadataBuilder.js";
import { FollowTargetController } from "./vision/followTargetController.js";
import { VisionScenarioManager } from "./vision/visionScenarioManager.js";

const DEFAULT_SPEED = 0.2;
const DEFAULT_DURATION_MS = 400;
const LOCAL_VISION_SIZE_STORAGE_KEY = "looi.localVisionWidgetSizePx.v2";
const FRONT_CAMERA_DEVICE_STORAGE_KEY = "looi.frontCameraDeviceId.v1";
const BACK_CAMERA_DEVICE_STORAGE_KEY = "looi.backCameraDeviceId.v1";
const DEFAULT_FRONT_CAMERA_INDEX = 1;
const DEFAULT_BACK_CAMERA_INDEX = 0;
const FOLLOW_TUNING_STORAGE_KEY = "looi.followTuning.v3";
const FOLLOW_TUNING_PRESETS = Object.freeze({
  case1: Object.freeze({
    label: "Case 1",
    maxObjectFollowSpeed: 0.2,
    followCommandDurationMs: 300,
    followCommandRefreshMs: 100,
    followCenterDeadband: 0.14,
    followMaxDetectionAgeMs: 300
  }),
  case2: Object.freeze({
    label: "Case 2",
    maxObjectFollowSpeed: 0.036,
    followCommandDurationMs: 20,
    followCommandRefreshMs: 90,
    followCenterDeadband: 0.115,
    followMaxDetectionAgeMs: 300
  }),
  case3: Object.freeze({
    label: "Case 3",
    maxObjectFollowSpeed: 0.032,
    followCommandDurationMs: 10,
    followCommandRefreshMs: 60,
    followCenterDeadband: 0.135,
    followMaxDetectionAgeMs: 300
  }),
  case4: Object.freeze({
    label: "Case 4",
    maxObjectFollowSpeed: 0.03,
    followCommandDurationMs: 10,
    followCommandRefreshMs: 80,
    followCenterDeadband: 0.105,
    followMaxDetectionAgeMs: 300
  })
});
const DEFAULT_FOLLOW_TUNING_PRESET = "case1";
const LOCAL_VISION_SIZE_MIN = 70;
const LOCAL_VISION_SIZE_MAX = 220;
const LOCAL_VISION_SIZE_STEP = 10;
const LOOI_ACTIVITY_SLOT_X = Object.freeze([-18, -9, 0, 9, 18]);
const LOOI_ACTIVITY_TRIPLET_SEQUENCE = Object.freeze([0, 1, 2, 1]);
const LOOI_ACTIVITY_STEP_MS = 1050;
const LOOI_ACTIVITY_ORBIT_RADIUS = 9;
const GEMINI_VISION_RESUME_AFTER_SPEECH_MS = 300;

const ui = {
  canvas: document.getElementById("faceCanvas"),
  runtimeGate: document.getElementById("runtimeGate"),
  productionStartButton: document.getElementById("productionStartButton"),
  productionStopButton: document.getElementById("productionStopButton"),
  localBrainQuickButton: document.getElementById("localBrainQuickButton"),
  looiActivityIndicator: document.getElementById("looiActivityIndicator"),
  looiActivityLabel: document.getElementById("looiActivityLabel"),
  settingsToggleButton: document.getElementById("settingsToggleButton"),
  settingsCloseButton: document.getElementById("settingsCloseButton"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsPanel: document.getElementById("settingsPanel"),
  localVisionPreview: document.getElementById("localVisionPreview"),
  localVisionState: document.getElementById("localVisionState"),
  localVisionDetail: document.getElementById("localVisionDetail"),
  localVisionSizeSlider: document.getElementById("localVisionSizeSlider"),
  localVisionSizeValue: document.getElementById("localVisionSizeValue"),
  esp32Status: document.getElementById("esp32Status"),
  moodValue: document.getElementById("moodValue"),
  energyValue: document.getElementById("energyValue"),
  boredomValue: document.getElementById("boredomValue"),
  fearValue: document.getElementById("fearValue"),
  curiosityValue: document.getElementById("curiosityValue"),
  currentBehavior: document.getElementById("currentBehavior"),
  attentionTarget: document.getElementById("attentionTarget"),
  obstacleState: document.getElementById("obstacleState"),
  listeningState: document.getElementById("listeningState"),
  speakingState: document.getElementById("speakingState"),
  userInput: document.getElementById("userInput"),
  sendButton: document.getElementById("sendButton"),
  happyButton: document.getElementById("happyButton"),
  curiousButton: document.getElementById("curiousButton"),
  wiggleButton: document.getElementById("wiggleButton"),
  logPanel: document.getElementById("logPanel"),
  cameraSupportState: document.getElementById("cameraSupportState"),
  cameraSecureWarning: document.getElementById("cameraSecureWarning"),
  cameraRunningState: document.getElementById("cameraRunningState"),
  cameraFacingMode: document.getElementById("cameraFacingMode"),
  cameraLastError: document.getElementById("cameraLastError"),
  refreshCameraDevicesButton: document.getElementById("refreshCameraDevicesButton"),
  frontCameraDeviceSelect: document.getElementById("frontCameraDeviceSelect"),
  backCameraDeviceSelect: document.getElementById("backCameraDeviceSelect"),
  cameraVisionSupport: document.getElementById("cameraVisionSupport"),
  geminiVisionAssistToggle: document.getElementById("geminiVisionAssistToggle"),
  geminiVisionAssistIntervalSlider: document.getElementById("geminiVisionAssistIntervalSlider"),
  geminiVisionAssistIntervalValue: document.getElementById("geminiVisionAssistIntervalValue"),
  geminiVisionAssistState: document.getElementById("geminiVisionAssistState"),
  geminiVisionAssistLastFrame: document.getElementById("geminiVisionAssistLastFrame"),
  startFrontCameraButton: document.getElementById("startFrontCameraButton"),
  startBackCameraButton: document.getElementById("startBackCameraButton"),
  switchCameraButton: document.getElementById("switchCameraButton"),
  stopCameraButton: document.getElementById("stopCameraButton"),
  captureSnapshotButton: document.getElementById("captureSnapshotButton"),
  cameraPreview: document.getElementById("cameraPreview"),
  objectDetectionOverlay: document.getElementById("objectDetectionOverlay"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  snapshotPreview: document.getElementById("snapshotPreview"),
  cameraUserVisible: document.getElementById("cameraUserVisible"),
  cameraUserPosition: document.getElementById("cameraUserPosition"),
  cameraUserDistance: document.getElementById("cameraUserDistance"),
  cameraFaceCount: document.getElementById("cameraFaceCount"),
  cameraLastObservation: document.getElementById("cameraLastObservation"),
  startObjectDetectionButton: document.getElementById("startObjectDetectionButton"),
  stopObjectDetectionButton: document.getElementById("stopObjectDetectionButton"),
  objectRoboflowWorkflowSelect: document.getElementById("objectRoboflowWorkflowSelect"),
  objectRoboflowGpuPlanSelect: document.getElementById("objectRoboflowGpuPlanSelect"),
  objectMaxResultsInput: document.getElementById("objectMaxResultsInput"),
  objectCategoryAllowlistInput: document.getElementById("objectCategoryAllowlistInput"),
  followTuningPresetSelect: document.getElementById("followTuningPresetSelect"),
  objectDetectorState: document.getElementById("objectDetectorState"),
  objectDetectorModel: document.getElementById("objectDetectorModel"),
  objectDetectorWorkflow: document.getElementById("objectDetectorWorkflow"),
  objectDetectorQuality: document.getElementById("objectDetectorQuality"),
  objectDetectorGpuPlan: document.getElementById("objectDetectorGpuPlan"),
  objectDetectorParams: document.getElementById("objectDetectorParams"),
  objectDetectionLastRun: document.getElementById("objectDetectionLastRun"),
  objectDetectionMetadataCount: document.getElementById("objectDetectionMetadataCount"),
  objectDetectionError: document.getElementById("objectDetectionError"),
  objectDetectionList: document.getElementById("objectDetectionList"),
  visibleObjectLabels: document.getElementById("visibleObjectLabels"),
  followTargetLabelInput: document.getElementById("followTargetLabelInput"),
  setFollowTargetButton: document.getElementById("setFollowTargetButton"),
  stopFollowingButton: document.getElementById("stopFollowingButton"),
  activeFollowTarget: document.getElementById("activeFollowTarget"),
  followScenarioState: document.getElementById("followScenarioState"),
  followControllerState: document.getElementById("followControllerState"),
  followCurrentErrorX: document.getElementById("followCurrentErrorX"),
  followSteeringState: document.getElementById("followSteeringState"),
  localBrainState: document.getElementById("localBrainState"),
  localBrainAdapterState: document.getElementById("localBrainAdapterState"),
  localBrainServerStatus: document.getElementById("localBrainServerStatus"),
  localBrainProvider: document.getElementById("localBrainProvider"),
  localBrainModel: document.getElementById("localBrainModel"),
  localBrainLatency: document.getElementById("localBrainLatency"),
  localBrainLastThought: document.getElementById("localBrainLastThought"),
  geminiLiveState: document.getElementById("geminiLiveState"),
  geminiLiveMicState: document.getElementById("geminiLiveMicState"),
  geminiLiveAudioState: document.getElementById("geminiLiveAudioState"),
  geminiLiveOutputState: document.getElementById("geminiLiveOutputState"),
  geminiLiveFrameState: document.getElementById("geminiLiveFrameState"),
  geminiLiveInputTranscript: document.getElementById("geminiLiveInputTranscript"),
  geminiLiveOutputTranscript: document.getElementById("geminiLiveOutputTranscript"),
  geminiLiveLastToolCall: document.getElementById("geminiLiveLastToolCall"),
  geminiLiveLatency: document.getElementById("geminiLiveLatency"),
  localBrainThoughtList: document.getElementById("localBrainThoughtList"),
  localMotionArmedToggle: document.getElementById("localMotionArmedToggle"),
  startLocalBrainButton: document.getElementById("startLocalBrainButton"),
  stopLocalBrainButton: document.getElementById("stopLocalBrainButton"),
  thinkNowButton: document.getElementById("thinkNowButton"),
  refreshLocalBrainServerStatusButton: document.getElementById("refreshLocalBrainServerStatusButton"),
  localEventList: document.getElementById("localEventList"),
  clearLocalEventsButton: document.getElementById("clearLocalEventsButton"),
  esp32UrlInput: document.getElementById("esp32UrlInput"),
  connectEsp32Button: document.getElementById("connectEsp32Button"),
  disconnectEsp32Button: document.getElementById("disconnectEsp32Button"),
  pingButton: document.getElementById("pingButton"),
  stopButton: document.getElementById("stopButton"),
  moveForwardButton: document.getElementById("moveForwardButton"),
  moveBackwardButton: document.getElementById("moveBackwardButton"),
  rotateLeftButton: document.getElementById("rotateLeftButton"),
  rotateRightButton: document.getElementById("rotateRightButton"),
  manualStopButton: document.getElementById("manualStopButton"),
  speedSlider: document.getElementById("speedSlider"),
  durationSlider: document.getElementById("durationSlider"),
  speedValue: document.getElementById("speedValue"),
  durationValue: document.getElementById("durationValue"),
  lifeEngineToggle: document.getElementById("lifeEngineToggle"),
  personalityNameInput: document.getElementById("personalityNameInput"),
  personalityIdentityInput: document.getElementById("personalityIdentityInput"),
  personalityPronounsInput: document.getElementById("personalityPronounsInput"),
  traitCuriosity: document.getElementById("traitCuriosity"),
  traitGentleness: document.getElementById("traitGentleness"),
  traitPlayfulness: document.getElementById("traitPlayfulness"),
  traitShyness: document.getElementById("traitShyness"),
  traitAffection: document.getElementById("traitAffection"),
  traitIndependence: document.getElementById("traitIndependence"),
  traitTalkativeness: document.getElementById("traitTalkativeness"),
  traitCaution: document.getElementById("traitCaution"),
  behaviorMovementSoftness: document.getElementById("behaviorMovementSoftness"),
  behaviorReactionSpeed: document.getElementById("behaviorReactionSpeed"),
  behaviorIdleActivity: document.getElementById("behaviorIdleActivity"),
  behaviorEmotionalExpressiveness: document.getElementById("behaviorEmotionalExpressiveness"),
  behaviorHesitation: document.getElementById("behaviorHesitation"),
  behaviorPersonalSpaceRespect: document.getElementById("behaviorPersonalSpaceRespect"),
  savePersonalityButton: document.getElementById("savePersonalityButton"),
  resetPersonalityButton: document.getElementById("resetPersonalityButton"),
  exportPersonalityButton: document.getElementById("exportPersonalityButton"),
  importPersonalityButton: document.getElementById("importPersonalityButton"),
  memoryTextInput: document.getElementById("memoryTextInput"),
  memoryTypeSelect: document.getElementById("memoryTypeSelect"),
  saveMemoryButton: document.getElementById("saveMemoryButton"),
  refreshMemoryButton: document.getElementById("refreshMemoryButton"),
  memoryDisplay: document.getElementById("memoryDisplay"),
  learnedPhraseInput: document.getElementById("learnedPhraseInput"),
  learnedMeaningInput: document.getElementById("learnedMeaningInput"),
  learnedActionSelect: document.getElementById("learnedActionSelect"),
  learnedArgsInput: document.getElementById("learnedArgsInput"),
  learnedConfidenceSelect: document.getElementById("learnedConfidenceSelect"),
  saveLearnedPhraseButton: document.getElementById("saveLearnedPhraseButton"),
  refreshLearnedPhrasesButton: document.getElementById("refreshLearnedPhrasesButton"),
  learnedPhraseList: document.getElementById("learnedPhraseList"),
  lifeEventsToggle: document.getElementById("lifeEventsToggle"),
  lifeEventsState: document.getElementById("lifeEventsState"),
  lastLifeEventDisplay: document.getElementById("lastLifeEventDisplay"),
  scenarioComeHereButton: document.getElementById("scenarioComeHereButton"),
  scenarioGiveMeSpaceButton: document.getElementById("scenarioGiveMeSpaceButton"),
  scenarioLookAroundButton: document.getElementById("scenarioLookAroundButton"),
  scenarioBoredButton: document.getElementById("scenarioBoredButton"),
  scenarioLowEnergyButton: document.getElementById("scenarioLowEnergyButton"),
  scenarioObstacleButton: document.getElementById("scenarioObstacleButton"),
  scenarioClearObstacleButton: document.getElementById("scenarioClearObstacleButton"),
  scenarioStopButton: document.getElementById("scenarioStopButton")
};

let face = null;
let robotClient = null;
let commandQueue = null;
let lifeEngine = null;
let localEventBus = null;
let localBrainEngine = null;
let localServerBrainAdapter = null;
let attentionSystem = null;
let brainLatencyBudget = null;
let scenarioFrameSequencer = null;
let priorityScheduler = null;
let embodiedActionRouter = null;
let wakeLockManager = null;
let performanceMonitor = null;
let reliabilityManager = null;
let geminiLiveRuntime = null;
let cameraInput = null;
let objectDetectorEngine = null;
let objectTracker = null;
let visionState = null;
let followTargetController = null;
let visionScenarioManager = null;
let bodyCalibration = null;
let personalityTuning = null;
let lifeEventEmitter = null;
let toolExecutor = null;
let activeConfig = { ...PUBLIC_CONFIG };
let brainPolicy = createDefaultBrainPolicy();
let latestActionResult = null;
let lastObservationEventAt = 0;
let lastObservationSignature = "";
let recentObjectReference = null;
let geminiVisionAssistEnabled = true;
let geminiVisionAssistIntervalMs = 1500;
let geminiVisionAssistTimer = null;
let geminiVisionAssistLastFrameAt = 0;
let geminiVisionAssistSending = false;
let cameraDevices = [];
let frontCameraDeviceId = "";
let backCameraDeviceId = "";
let learnedPhraseCache = [];
let lifeEventsEnabled = false;
let settingsOpen = false;
let poseScenarioLastRun = new Map();
let localVisionWidgetSizePx = loadLocalVisionWidgetSize();
let lastLogSignature = "";
let lastOverlayDebugAt = 0;
let roboflowDetectorStartPromise = null;
let roboflowDetectorWanted = false;
let pendingFollowVisionContextReason = "";
let geminiAudioWasPlaying = false;
let geminiVisionResumeTimer = null;
let geminiAudioEndedAt = 0;
let looiActivityRaf = 0;
let looiActivitySlotForDot = [0, 1, 2, 3, 4];
let looiActivityActiveStep = 0;
let looiActivityStepStart = 0;
let looiActivityState = "listening";

face = createFaceController(ui.canvas);
applyLocalVisionWidgetSize(localVisionWidgetSizePx, { persist: false });
updateSliderLabels();
updateLocalBrainUi();
updateOutputAudioUi();
updateAttentionUi();
updateCameraUi();
updatePersonalityUi();
updateLifeEventsUi();
updateProductionChrome();

ui.productionStartButton.addEventListener("click", () => {
  startProductionRuntime().catch((error) => {
    log(`Local runtime start failed: ${error.message}`, "error");
    requestPoseScenario("pose_scared");
  });
});

ui.localBrainQuickButton.addEventListener("click", () => {
  startLocalBrainProductionMode().catch((error) => {
    log(`Local Brain start failed: ${error.message}`, "error");
    requestPoseScenario("pose_scared");
  });
});

ui.productionStopButton.addEventListener("click", async () => {
  await immediateStop("production_top_stop", "Immediate stop sent from production controls.", "warn");
});

ui.settingsToggleButton.addEventListener("click", () => {
  setSettingsOpen(!settingsOpen);
});

ui.settingsCloseButton.addEventListener("click", () => {
  setSettingsOpen(false);
});

ui.settingsBackdrop.addEventListener("click", () => {
  setSettingsOpen(false);
});

ui.sendButton.addEventListener("click", () => {
  handleSend().catch((error) => {
    log(`Typed input handling failed: ${error.message}`, "error");
  });
});
ui.userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleSend().catch((error) => {
      log(`Typed input handling failed: ${error.message}`, "error");
    });
  }
});

bindPersonalityText(ui.personalityNameInput, "name");
bindPersonalityText(ui.personalityIdentityInput, "identity");
bindPersonalityText(ui.personalityPronounsInput, "pronouns");
bindPersonalityTrait(ui.traitCuriosity, "curiosity");
bindPersonalityTrait(ui.traitGentleness, "gentleness");
bindPersonalityTrait(ui.traitPlayfulness, "playfulness");
bindPersonalityTrait(ui.traitShyness, "shyness");
bindPersonalityTrait(ui.traitAffection, "affection");
bindPersonalityTrait(ui.traitIndependence, "independence");
bindPersonalityTrait(ui.traitTalkativeness, "talkativeness");
bindPersonalityTrait(ui.traitCaution, "caution");
bindPersonalityBehavior(ui.behaviorMovementSoftness, "movementSoftness");
bindPersonalityBehavior(ui.behaviorReactionSpeed, "reactionSpeed");
bindPersonalityBehavior(ui.behaviorIdleActivity, "idleActivity");
bindPersonalityBehavior(ui.behaviorEmotionalExpressiveness, "emotionalExpressiveness");
bindPersonalityBehavior(ui.behaviorHesitation, "hesitation");
bindPersonalityBehavior(ui.behaviorPersonalSpaceRespect, "personalSpaceRespect");

ui.savePersonalityButton.addEventListener("click", () => {
  personalityTuning?.save?.();
  log("Personality saved locally.");
});

ui.resetPersonalityButton.addEventListener("click", () => {
  personalityTuning?.resetDefaults?.();
  personalityTuning?.save?.();
  log("Personality reset to defaults.");
});

ui.exportPersonalityButton.addEventListener("click", () => {
  const json = personalityTuning?.exportJson?.() ?? "{}";
  ui.memoryDisplay.textContent = json;
  log("Personality JSON exported into the memory display.");
});

ui.importPersonalityButton.addEventListener("click", () => {
  const raw = globalThis.prompt?.("Paste personality JSON");
  if (!raw) {
    return;
  }

  try {
    personalityTuning?.importJson?.(raw);
    personalityTuning?.save?.();
    log("Personality imported.");
  } catch (error) {
    log(`Personality import failed: ${error.message}`, "warn");
  }
});

ui.saveMemoryButton.addEventListener("click", () => {
  saveMemoryFromUi().catch((error) => {
    log(`Memory save failed: ${error.message}`, "warn");
  });
});

ui.refreshMemoryButton.addEventListener("click", () => {
  refreshMemoryContext().catch((error) => {
    log(`Memory refresh failed: ${error.message}`, "warn");
  });
});

ui.saveLearnedPhraseButton.addEventListener("click", () => {
  saveLearnedPhraseFromUi().catch((error) => {
    log(`Learned phrase save failed: ${error.message}`, "warn");
  });
});

ui.refreshLearnedPhrasesButton.addEventListener("click", () => {
  refreshLearnedPhrases().catch((error) => {
    log(`Learned phrase refresh failed: ${error.message}`, "warn");
  });
});

ui.lifeEventsToggle.addEventListener("change", () => {
  lifeEventsEnabled = ui.lifeEventsToggle.checked;
  globalThis.localStorage?.setItem?.("looi.lifeEventsEnabled.v1", String(lifeEventsEnabled));

  if (lifeEventsEnabled) {
    lifeEventEmitter?.start?.();
  } else {
    lifeEventEmitter?.stop?.();
  }

  updateLifeEventsUi();
});

ui.localMotionArmedToggle.addEventListener("change", () => {
  patchBrainPolicy({ localMotionArmed: ui.localMotionArmedToggle.checked });
  log(
    brainPolicy.localMotionArmed
      ? "Local Motion armed. Supervise the robot and keep Emergency Stop ready."
      : "Local Motion disarmed. Local Brain physical actions will be rejected.",
    brainPolicy.localMotionArmed ? "warn" : "info"
  );
});

ui.geminiVisionAssistToggle?.addEventListener("change", () => {
  geminiVisionAssistEnabled = Boolean(ui.geminiVisionAssistToggle.checked);
  syncGeminiVisionAssist("toggle");
  log(
    geminiVisionAssistEnabled
      ? "Gemini Live Vision enabled. Roboflow follow runs separately for tracking."
      : "Gemini Live Vision disabled.",
    geminiVisionAssistEnabled ? "warn" : "info"
  );
});

ui.geminiVisionAssistIntervalSlider?.addEventListener("input", () => {
  geminiVisionAssistIntervalMs = clampNumber(
    ui.geminiVisionAssistIntervalSlider.value,
    1000,
    5000,
    1500
  );
  if (ui.geminiVisionAssistIntervalValue) {
    ui.geminiVisionAssistIntervalValue.textContent = `${Math.round(geminiVisionAssistIntervalMs)} ms`;
  }
  stopGeminiVisionAssist("interval_change");
  syncGeminiVisionAssist("interval_change");
});

ui.startLocalBrainButton.addEventListener("click", () => {
  primeLiveInputsFromUserGesture();
  startLocalBrainProductionMode().catch((error) => {
    log(`Local Brain live startup failed: ${error.message}`, "error");
    requestPoseScenario("pose_scared");
  });
});

ui.stopLocalBrainButton.addEventListener("click", () => {
  stopGeminiVisionAssist("ui_stop_local_brain");
  clearPendingGeminiVisionAfterSpeech();
  stopLooiRoboflowRuntime("ui_stop_local_brain");
  geminiLiveRuntime?.stop?.("ui_stop_local_brain");
  localBrainEngine?.stop?.();
  updateLocalBrainUi();
  updateGeminiLiveUi();
});

ui.thinkNowButton.addEventListener("click", () => {
  localBrainEngine?.thinkNow?.("manual").then(updateLocalBrainUi).catch((error) => {
    log(`Local Brain thought failed: ${error.message}`, "warn");
  });
});

ui.refreshLocalBrainServerStatusButton.addEventListener("click", () => {
  refreshLocalBrainServerStatus().catch((error) => {
    log(`Local Brain server status failed: ${error.message}`, "warn");
    updateLocalBrainUi();
  });
});

ui.clearLocalEventsButton.addEventListener("click", () => {
  const cleared = localEventBus?.clear?.() ?? 0;
  renderLocalEvents();
  log(`Cleared ${cleared} local events.`);
});

ui.refreshCameraDevicesButton?.addEventListener("click", () => {
  refreshCameraDevices().catch((error) => {
    log(`Camera device refresh failed: ${error.message}`, "warn");
  });
});

ui.frontCameraDeviceSelect?.addEventListener("change", () => {
  frontCameraDeviceId = normalizeCameraDeviceId(ui.frontCameraDeviceSelect.value);
  saveCameraDeviceId("front", frontCameraDeviceId);
  log(`Front camera device set to ${formatCameraDeviceForLog(getFrontCameraDeviceId(), "front")}.`);
});

ui.backCameraDeviceSelect?.addEventListener("change", () => {
  backCameraDeviceId = normalizeCameraDeviceId(ui.backCameraDeviceSelect.value);
  saveCameraDeviceId("back", backCameraDeviceId);
  log(`Back camera device set to ${formatCameraDeviceForLog(getBackCameraDeviceId(), "back")}.`);
});

ui.startFrontCameraButton.addEventListener("click", () => {
  openCameraFromUi("user").catch((error) => {
    log(`Front camera failed: ${error.message}`, "error");
  });
});

ui.startBackCameraButton.addEventListener("click", () => {
  openCameraFromUi("environment").catch((error) => {
    log(`Back camera failed: ${error.message}`, "error");
  });
});

ui.switchCameraButton.addEventListener("click", () => {
  const currentFacingMode = cameraInput?.getCameraStatus?.().facingMode;
  const nextFacingMode = currentFacingMode === "environment" ? "user" : "environment";
  openCameraFromUi(nextFacingMode).catch((error) => {
    log(`Camera switch failed: ${error.message}`, "error");
  });
});

ui.stopCameraButton.addEventListener("click", () => {
  cameraInput?.stopCamera?.().then(handleCameraCommandResult).catch((error) => {
    log(`Camera stop failed: ${error.message}`, "error");
  });
});

ui.captureSnapshotButton.addEventListener("click", () => {
  captureSnapshotFromUi().catch((error) => {
    log(`Snapshot failed: ${error.message}`, "error");
  });
});

ui.connectEsp32Button.addEventListener("click", async () => {
  if (!robotClient) {
    log("Robot client is still initializing.", "warn");
    return;
  }

  const nextUrl = ui.esp32UrlInput.value.trim() || activeConfig.defaultEsp32WsUrl;

  try {
    await robotClient.connect(nextUrl);
    ui.esp32UrlInput.value = nextUrl;
    await applyCalibrationToRobot({ quiet: true });
  } catch (error) {
    log(`Robot connection failed: ${error.message}`, "error");
    requestPoseScenario("pose_scared");
  }
});

ui.disconnectEsp32Button.addEventListener("click", async () => {
  if (!robotClient) {
    log("Robot client is still initializing.", "warn");
    return;
  }

  if (commandQueue) {
    await commandQueue.stopMotion?.("ui_disconnect");
  }

  robotClient.disconnect();
  lifeEngine?.setConnectionState("disconnected");
  log("ESP32 disconnect requested.");
});

ui.pingButton.addEventListener("click", () => {
  if (!robotClient) {
    log("Robot client is still initializing.", "warn");
    return;
  }

  if (!ensureConnected("Ping skipped because no robot client is connected.")) {
    return;
  }

  try {
    robotClient.ping();
    log("Ping sent to ESP32.");
  } catch (error) {
    log(`Ping failed: ${error.message}`, "error");
  }
});

ui.stopButton.addEventListener("click", async () => {
  await immediateStop("ui_stop", "Immediate stop sent. Verify motors stopped.", "warn");
});

ui.manualStopButton.addEventListener("click", async () => {
  await immediateStop("manual_stop", "Manual stop sent.", "info");
});

ui.moveForwardButton.addEventListener("click", () => {
  runScenarioFromUi("come_closer").catch((error) => log(`Scenario come_closer failed: ${error.message}`, "warn"));
});

ui.moveBackwardButton.addEventListener("click", () => {
  runScenarioFromUi("back_up").catch((error) => log(`Scenario back_up failed: ${error.message}`, "warn"));
});

ui.rotateLeftButton.addEventListener("click", () => {
  runScenarioFromUi("look_left").catch((error) => log(`Scenario look_left failed: ${error.message}`, "warn"));
});

ui.rotateRightButton.addEventListener("click", () => {
  runScenarioFromUi("look_right").catch((error) => log(`Scenario look_right failed: ${error.message}`, "warn"));
});

ui.happyButton.addEventListener("click", () => {
  runScenarioFromUi("ack_yes").catch((error) => log(`Scenario ack_yes failed: ${error.message}`, "warn"));
});

ui.curiousButton.addEventListener("click", () => {
  runScenarioFromUi("look_left").catch((error) => log(`Scenario look_left failed: ${error.message}`, "warn"));
});

ui.wiggleButton.addEventListener("click", () => {
  runScenarioFromUi("body_talking").catch((error) => log(`Scenario body_talking failed: ${error.message}`, "warn"));
});

ui.lifeEngineToggle.addEventListener("click", () => {
  if (!lifeEngine) {
    log("Life Engine is still initializing.", "warn");
    return;
  }

  if (lifeEngine.running) {
    lifeEngine.stop();
  } else {
    lifeEngine.start();
  }

  updateLifeEngineToggle();
});

ui.scenarioComeHereButton.addEventListener("click", () => {
  log("Scenario: Come Here");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "come here"
  });
  runScenarioFromUi("come_closer").catch((error) => log(`Scenario come_closer failed: ${error.message}`, "warn"));
});

ui.scenarioGiveMeSpaceButton.addEventListener("click", () => {
  log("Scenario: Give Me Space");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "give me space"
  });
  runScenarioFromUi("back_up").catch((error) => log(`Scenario back_up failed: ${error.message}`, "warn"));
});

ui.scenarioLookAroundButton.addEventListener("click", () => {
  log("Scenario: Look Around");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "look around"
  });
  runScenarioFromUi("look_left").catch((error) => log(`Scenario look_left failed: ${error.message}`, "warn"));
});

ui.scenarioStopButton.addEventListener("click", async () => {
  log("Scenario: Stop / Freeze");
  await immediateStop("scenario_stop", "Scenario stop sent.", "warn");
});

ui.scenarioBoredButton.addEventListener("click", () => {
  log("Scenario: Ignored / Bored");
  lifeEngine?.patchState?.({ boredom: 0.9, curiosity: 0.85, mood: "curious" }, "ui_scenario_bored_state");
  requestPoseScenario("pose_curious");
});

ui.scenarioLowEnergyButton.addEventListener("click", () => {
  log("Scenario: Low Energy");
  lifeEngine?.patchState?.({ energy: 0.15, mood: "sleepy" }, "ui_scenario_low_energy_state");
  requestPoseScenario("pose_sleepy");
});

ui.scenarioObstacleButton.addEventListener("click", () => {
  log("Scenario: Obstacle", "warn");
  lifeEngine?.receiveEvent({
    type: "obstacle",
    value: true
  });
});

ui.scenarioClearObstacleButton.addEventListener("click", () => {
  log("Scenario: Clear Obstacle");
  lifeEngine?.receiveEvent({
    type: "obstacle",
    value: false
  });
});

ui.speedSlider.addEventListener("input", updateSliderLabels);
ui.durationSlider.addEventListener("input", updateSliderLabels);
ui.localVisionSizeSlider?.addEventListener("input", () => {
  applyLocalVisionWidgetSize(ui.localVisionSizeSlider.value);
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult ?? { detections: [] });
});
globalThis.addEventListener?.("resize", () => {
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult ?? { detections: [] });
});
ui.startObjectDetectionButton?.addEventListener("click", () => {
  startObjectDetectionFromUi().catch((error) => log(`Object detector start failed: ${error.message}`, "warn"));
});
ui.stopObjectDetectionButton?.addEventListener("click", () => {
  stopLooiRoboflowRuntime("manual_object_detector_stop");
  updateVisionUi();
});
ui.objectRoboflowWorkflowSelect?.addEventListener("change", () => {
  setRoboflowWorkflowFromUi().catch((error) => {
    log(`Roboflow workflow switch failed: ${error.message}`, "warn");
    updateVisionUi();
  });
});
ui.objectRoboflowGpuPlanSelect?.addEventListener("change", () => {
  setRoboflowGpuPlanFromUi().catch((error) => {
    log(`Roboflow GPU plan switch failed: ${error.message}`, "warn");
    updateVisionUi();
  });
});
ui.objectMaxResultsInput?.addEventListener("change", () => {
  objectDetectorEngine?.setMaxResults?.(Number(ui.objectMaxResultsInput.value));
  updateVisionUi();
});
ui.objectCategoryAllowlistInput?.addEventListener("change", () => {
  objectDetectorEngine?.setCategoryAllowlist?.(ui.objectCategoryAllowlistInput.value);
  updateVisionUi();
});
ui.followTuningPresetSelect?.addEventListener("change", () => {
  applyFollowPresetFromUi();
});
ui.setFollowTargetButton?.addEventListener("click", () => {
  const label = ui.followTargetLabelInput?.value?.trim();
  if (!label) {
    log("Follow target requires a label.", "warn");
    return;
  }
  visionScenarioManager?.startFollowTarget?.({ label, mode: "gentle" })
    ?.then?.((result) => {
      log(result.message, result.executed ? "info" : "warn");
      updateVisionUi();
    });
});
ui.stopFollowingButton?.addEventListener("click", () => {
  visionScenarioManager?.stopFollowing?.("manual_stop_following");
  updateVisionUi();
});

init();

async function init() {
  activeConfig = await loadPublicConfig();
  const savedFollowTuning = loadFollowTuningSettings();
  brainPolicy = clampBrainPolicy({
    ...createDefaultBrainPolicy(),
    maxThoughtsPerMinute:
      activeConfig.localBrainMaxThoughtsPerMinute ??
      PUBLIC_CONFIG.localBrainMaxThoughtsPerMinute ??
      12,
    followLostTimeoutMs:
      activeConfig.followLostTimeoutMs ??
      PUBLIC_CONFIG.followLostTimeoutMs ??
      3000,
    followTargetCenterX:
      activeConfig.followTargetCenterX ??
      PUBLIC_CONFIG.followTargetCenterX ??
      0.5,
    followCenterDeadband:
      activeConfig.followCenterDeadband ??
      PUBLIC_CONFIG.followCenterDeadband ??
      FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCenterDeadband,
    followSteerGain:
      activeConfig.followSteerGain ??
      PUBLIC_CONFIG.followSteerGain ??
      0.9,
    maxObjectFollowSpeed:
      activeConfig.maxObjectFollowSpeed ??
      PUBLIC_CONFIG.maxObjectFollowSpeed ??
      FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].maxObjectFollowSpeed,
    followCommandDurationMs:
      activeConfig.followCommandDurationMs ??
      PUBLIC_CONFIG.followCommandDurationMs ??
      FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCommandDurationMs,
    followCommandRefreshMs:
      activeConfig.followCommandRefreshMs ??
      PUBLIC_CONFIG.followCommandRefreshMs ??
      FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCommandRefreshMs,
    followMaxDetectionAgeMs:
      activeConfig.followMaxDetectionAgeMs ??
      PUBLIC_CONFIG.followMaxDetectionAgeMs ??
      FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followMaxDetectionAgeMs,
    ...savedFollowTuning,
    eventThoughtCooldownMs:
      activeConfig.localBrainEventCooldownMs ??
      PUBLIC_CONFIG.localBrainEventCooldownMs ??
      createDefaultBrainPolicy().eventThoughtCooldownMs
  });
  geminiVisionAssistEnabled = activeConfig.geminiVisionAssistDefault ?? PUBLIC_CONFIG.geminiVisionAssistDefault ?? true;
  geminiVisionAssistIntervalMs = clampNumber(
    activeConfig.geminiVisionAssistIntervalMs ?? PUBLIC_CONFIG.geminiVisionAssistIntervalMs,
    1000,
    5000,
    1500
  );
  if (ui.geminiVisionAssistToggle) {
    ui.geminiVisionAssistToggle.checked = geminiVisionAssistEnabled;
  }
  if (ui.geminiVisionAssistIntervalSlider) {
    ui.geminiVisionAssistIntervalSlider.value = String(geminiVisionAssistIntervalMs);
  }
  if (ui.geminiVisionAssistIntervalValue) {
    ui.geminiVisionAssistIntervalValue.textContent = `${Math.round(geminiVisionAssistIntervalMs)} ms`;
  }
  frontCameraDeviceId = loadCameraDeviceId("front");
  backCameraDeviceId = loadCameraDeviceId("back");
  syncCameraDeviceSelects();

  localEventBus = new LocalEventBus({
    logger: (message, level = "info") => log(message, level)
  });
  localEventBus.subscribeAll(() => {
    renderLocalEvents();
  });
  localEventBus.subscribe("brain_thought_result", () => {
    updateLocalBrainUi();
  });
  localEventBus.subscribe("brain_thought_result", (event) => {
    const latencyMs = event.payload?.latencyMs ?? event.payload?.thought?.latencyMs;
    if (latencyMs) {
      performanceMonitor?.recordBrainLatency?.(latencyMs);
    }
  });
  localEventBus.subscribe("brain_thought_result", (event) => {
    const results = event.payload?.results ?? event.payload?.thought?.results ?? [];
    const lastResult = Array.isArray(results) ? results[results.length - 1] : null;

    if (lastResult) {
      latestActionResult = summarizeActionResult(lastResult);
    }
  });
  localEventBus.subscribe("brain_thought_result", traceBrainThoughtResult);
  ["sequence_started", "sequence_result", "sequence_interrupted"].forEach((type) => {
    localEventBus.subscribe(type, traceSequenceEvent);
  });

  attentionSystem = new AttentionSystem({
    logger: (message, level = "info") => log(message, level)
  });

  brainLatencyBudget = new BrainLatencyBudget({
    eventThoughtTimeoutMs: activeConfig.localBrainEventTimeoutMs ?? 12000
  });

  bodyCalibration = new BodyCalibration({
    logger: (message, level = "info") => log(message, level)
  });
  bodyCalibration.load();
  bodyCalibration.onChange((settings) => {
    lifeEngine?.setCalibration?.(bodyCalibration);
    scenarioFrameSequencer?.setCalibration?.(bodyCalibration);
    commandQueue?.setLimits?.({
      maxSpeed: settings.maxSpeed,
      maxDurationMs: activeConfig.maxDurationMs ?? PUBLIC_CONFIG.maxDurationMs
    });
  });

  personalityTuning = new PersonalityTuning({
    logger: (message, level = "info") => log(message, level)
  });
  personalityTuning.load();
  personalityTuning.onChange((profile) => {
    lifeEngine?.setPersonalityProfile?.(profile);
    updatePersonalityUi(profile);
  });
  lifeEventsEnabled =
    globalThis.localStorage?.getItem?.("looi.lifeEventsEnabled.v1") === "true";

  ui.esp32UrlInput.value =
    activeConfig.defaultEsp32WsUrl || PUBLIC_CONFIG.defaultEsp32WsUrl;
  ui.speedSlider.max = activeConfig.maxSpeed?.toFixed(2) ?? "0.40";
  ui.durationSlider.max = String(activeConfig.maxDurationMs ?? PUBLIC_CONFIG.maxDurationMs);
  updateSliderLabels();

  robotClient = new ESP32Client({
    url: ui.esp32UrlInput.value,
    minDurationMs: 0,
    logger: (message, level = "info") => log(message, level)
  });
  registerRobotClientCallbacks(robotClient);
  robotClient
    .refreshStatus?.()
    .then((status) => {
      if (status.connected) {
        log(`ESP32 server gateway already connected at ${status.url}`);
        return applyCalibrationToRobot({ quiet: true });
      }
      return null;
    })
    .catch((error) => {
      log(`ESP32 server gateway status unavailable: ${error.message}`, "warn");
    });

  commandQueue = createCommandQueue(robotClient);

  lifeEngine = new LifeEngine({
    face,
    robotClient,
    commandQueue,
    calibration: bodyCalibration,
    personalityTuning,
    personalityProfile: personalityTuning.getProfile(),
    logger: (message, level = "info") => log(message, level),
    statusCallback: updateLifeStatus
  });

  priorityScheduler = new PriorityScheduler({
    logger: (message, level = "info") => log(message, level)
  });
  scenarioFrameSequencer = new ScenarioFrameSequencer({
    face,
    commandQueue,
    lifeEngine,
    calibration: bodyCalibration,
    eventBus: localEventBus,
    logger: (message, level = "info") => log(message, level)
  });
  embodiedActionRouter = new EmbodiedActionRouter({
    frameSequencer: scenarioFrameSequencer,
    priorityScheduler,
    lifeEngine,
    logger: (message, level = "info") => log(message, level)
  });
  lifeEngine.setEmbodiedActionRouter?.(embodiedActionRouter);

  cameraInput = new CameraInput({
    videoElement: ui.cameraPreview,
    canvasElement: ui.cameraCanvas,
    analysisIntervalMs: 500,
    logger: (message, level = "info") => log(message, level)
  });
  scenarioFrameSequencer.setCameraInput?.(cameraInput);
  cameraInput.onStatus(updateCameraUi);
  cameraInput.onObservation(handleCameraObservation);
  cameraInput.onSnapshot(handleCameraSnapshot);
  await refreshCameraDevices({ quiet: true }).catch((error) => {
    log(`Camera device refresh failed: ${error.message}`, "warn");
  });

  visionState = new VisionState({
    logger: (message, level = "info") => log(message, level)
  });
  objectTracker = new ObjectTracker({
    maxLostMs: brainPolicy.followLostTimeoutMs,
    logger: (message, level = "info") => log(message, level)
  });
  objectDetectorEngine = new ObjectDetectorEngine({
    videoElement: ui.cameraPreview,
    cameraInput,
    moduleUrl:
      activeConfig.objectDetectorModuleUrl ??
      PUBLIC_CONFIG.objectDetectorModuleUrl,
    proxyUrl:
      activeConfig.roboflowWebrtcProxyUrl ??
      PUBLIC_CONFIG.roboflowWebrtcProxyUrl,
    turnConfigUrl:
      activeConfig.roboflowWebrtcTurnConfigUrl ??
      PUBLIC_CONFIG.roboflowWebrtcTurnConfigUrl,
    terminateUrl:
      activeConfig.roboflowWebrtcTerminateUrl ??
      PUBLIC_CONFIG.roboflowWebrtcTerminateUrl,
    roboflowConfig:
      activeConfig.roboflowWebrtc ??
      PUBLIC_CONFIG.roboflowWebrtc,
    maxResults:
      activeConfig.objectDetectorMaxResults ??
      PUBLIC_CONFIG.objectDetectorMaxResults ??
      DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
    logger: (message, level = "info") => log(message, level)
  });
  objectDetectorEngine.onDetections(handleObjectDetections);
  objectDetectorEngine.onStatus((status) => {
    visionState?.setDetectorStatus?.(status);
    updateVisionUi();
  });
  objectDetectorEngine.onError((message) => {
    log(`Object detector error: ${message}`, "warn");
    updateVisionUi();
  });

  toolExecutor = new ToolExecutor({
    lifeEngine,
    face,
    robotClient,
    commandQueue,
    embodiedActionRouter,
    cameraInput,
    visionScenarioManager: null,
    visionState,
    followTargetController: null,
    logger: (message, level = "info") => log(message, level),
    getRuntimeContext,
    getExecutionPolicy
  });

  followTargetController = new FollowTargetController({
    visionState,
    objectTracker,
    lifeEngine,
    commandQueue,
    eventBus: localEventBus,
    getPolicy: getExecutionPolicy,
    lostTimeoutMs: brainPolicy.followLostTimeoutMs,
    logger: (message, level = "info") => log(message, level)
  });
  visionScenarioManager = new VisionScenarioManager({
    cameraInput,
    objectDetectorEngine,
    objectTracker,
    visionState,
    followTargetController,
    face,
    eventBus: localEventBus,
    armMovement: armMovementForScenario,
    logger: (message, level = "info") => log(message, level)
  });
  toolExecutor.setVisionControllers?.({
    visionScenarioManager,
    visionState,
    followTargetController
  });

  geminiLiveRuntime = new GeminiLiveRuntime({
    toolExecutor,
    face,
    lifeEngine,
    getRuntimeContext,
    logger: (message, level = "info") => log(message, level)
  });
  geminiLiveRuntime.configure(activeConfig);
  geminiLiveRuntime.onStatus(updateGeminiLiveUi);
  [
    "vision_follow_started",
    "vision_follow_stopped",
    "vision_follow_not_found",
    "vision_target_lost",
    "vision_target_reacquired"
  ].forEach((type) => {
    localEventBus.subscribe(type, handleVisionFollowEvent);
  });

  localServerBrainAdapter = new LocalServerBrainAdapter({
    logger: (message, level = "info") => log(message, level)
  });

  localBrainEngine = new LocalBrainEngine({
    eventBus: localEventBus,
    lifeEngine,
    toolExecutor,
    attentionSystem,
    latencyBudget: brainLatencyBudget,
    getRuntimeContext,
    getPolicy,
    primaryAdapter: localServerBrainAdapter,
    adapter: new MockBrainAdapter({
      logger: (message, level = "info") => log(message, level)
    }),
    fallback: new RuleBrainFallback(),
    logger: (message, level = "info") => log(message, level)
  });

  wakeLockManager = new WakeLockManager({
    logger: (message, level = "info") => log(message, level)
  });
  performanceMonitor = new PerformanceMonitor({
    logger: (message, level = "info") => log(message, level)
  });
  reliabilityManager = new ReliabilityManager({
    performanceMonitor,
    cameraInput,
    logger: (message, level = "info") => log(message, level)
  });

  lifeEventEmitter = new LifeEventEmitter({
    lifeEngine,
    personalityTuning,
    postRobotEvent,
    logger: (message, level = "info") => log(message, level),
    minIntervalMs: 15000
  });

  lifeEngine.start();
  if (lifeEventsEnabled) {
    lifeEventEmitter.start();
  }
  if (activeConfig.performanceMonitorEnabledDefault !== false) {
    performanceMonitor.start();
  }
  updateConnectionState(robotClient.getStatus());
  updateLifeEngineToggle();
  updateLocalBrainUi();
  updateOutputAudioUi();
  updateAttentionUi();
  updateCameraUi();
  updatePersonalityUi();
  updateLifeEventsUi();
  refreshLocalBrainServerStatus().catch((error) => {
    log(`Local Brain server unavailable, fallback will be used: ${error.message}`, "warn");
  });
  ui.productionStartButton.disabled = false;
  ui.localBrainQuickButton.disabled = false;
  updateProductionChrome();
  renderLocalBrainThoughts();
  renderLocalEvents();
  globalThis.setInterval(() => {
    updateAttentionUi();
    updateGeminiVisionAssistUi();
  }, 1000);
  refreshLearnedPhrases().catch((error) => {
    log(`Learned phrase cache unavailable: ${error.message}`, "warn");
  });
  log("UI ready.");
  log("Local-first runtime active.");
  log("Local Motion is disarmed by default. Arm only while supervised.");
  log(`Default ESP32 URL: ${ui.esp32UrlInput.value}`);
  log("Safety: lift the wheels before the first movement test.", "warn");
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const serverConfig = await response.json();
    return {
      ...PUBLIC_CONFIG,
      ...serverConfig
    };
  } catch (error) {
    log(`Using local config fallback: ${error.message}`, "warn");
    return { ...PUBLIC_CONFIG };
  }
}

function registerRobotClientCallbacks(client) {
  client.onStatus((status) => {
    if (client !== robotClient) {
      return;
    }

    updateConnectionState(status);
    lifeEngine?.setConnectionState(getLifeConnectionState(status));

    if (!status.connected) {
      lifeEngine?.setConnectionState("disconnected");
    }
  });

  client.onTelemetry((telemetry) => {
    if (client !== robotClient) {
      return;
    }

    lifeEngine?.updateTelemetry(telemetry);
    localEventBus?.publish?.("telemetry", {
      telemetry,
      robotConnected: Boolean(robotClient?.isConnected?.())
    }, {
      source: "esp32",
      priority: 0
    });
  });

  client.onAck((message) => {
    if (client !== robotClient) {
      return;
    }

    const details =
      message.cmd === "motion"
        ? `label=${message.label ?? "--"} left=${formatNumber(message.left_speed)} right=${formatNumber(message.right_speed)} ramp=${message.ramp_ms ?? "--"}`
        : message.reason ?? "";
    log(`ESP32 ack: ${message.cmd}${details ? ` (${details})` : ""}`);
  });

  client.onError((message) => {
    if (client !== robotClient) {
      return;
    }

    requestPoseScenario("pose_scared");
    log(`ESP32 error: ${message.message ?? "unknown"}`, "error");
  });
}

function createCommandQueue(client) {
  const calibrationSettings = bodyCalibration?.getSettings?.() ?? {};
  const queue = new CommandQueue({
    robotClient: client,
    logger: (message, level = "info") => log(message, level),
    maxSpeed: calibrationSettings.maxSpeed ?? activeConfig.maxSpeed ?? PUBLIC_CONFIG.maxSpeed,
    minDurationMs: 0,
    maxDurationMs: activeConfig.maxDurationMs ?? PUBLIC_CONFIG.maxDurationMs
  });

  return queue;
}

function ensureConnected(message) {
  if (!robotClient?.isConnected()) {
    log(message, "warn");
    return false;
  }

  return true;
}

async function immediateStop(reason, message, level = "warn") {
  if (!commandQueue && !toolExecutor) {
    log("Robot command queue is still initializing.", "warn");
    return;
  }

  geminiLiveRuntime?.interrupt?.(reason);
  scenarioFrameSequencer?.interrupt?.(reason, 100);
  priorityScheduler?.interruptBelow?.(100, reason);
  priorityScheduler?.clear?.();

  if (toolExecutor?.immediateStop) {
    await toolExecutor.immediateStop(reason);
  } else {
    await (commandQueue?.stopMotion?.(reason) ?? commandQueue?.cancelMotion?.(reason));
    lifeEngine?.receiveEvent({ type: "motion_stop", reason });
  }

  requestPoseScenario("pose_attentive");
  log(message, level);
}

async function handleSend() {
  const text = ui.userInput.value.trim();

  if (!text) {
    log("Empty input ignored.");
    return;
  }

  log(`STEP 0 INPUT typed: "${text}"`);
  ui.userInput.value = "";
  await handleLocalTextInput({
    text,
    confidence: 1,
    language: "typed",
    timestamp: new Date().toISOString(),
    source: "typed"
  });
}

async function handleLocalTextInput(input = {}) {
  const text = String(input.text ?? "").trim();

  if (!text) {
    return null;
  }

  updateRecentObjectReferenceFromText(text);
  if (isStopFollowIntent(text)) {
    visionScenarioManager?.stopFollowing?.("user_stop_following");
  }

  const source = "typed";
  const eventType = "user_text";
  const gateResult = classifyLocalTextInput(text);
  traceLive("STEP 1 LOCAL_INPUT", {
    text,
    source,
    classification: gateResult.classification,
    accepted: gateResult.accepted,
    triggerBrain: gateResult.shouldTriggerBrain,
    immediateStop: gateResult.shouldImmediateStop,
    reason: gateResult.reason,
    suggestedIntent: gateResult.suggestedIntent
  });
  const priority =
    gateResult.priority === "critical"
      ? "high"
      : gateResult.priority === "normal" || gateResult.priority === "high"
        ? "normal"
        : "low";

  if (gateResult.accepted || gateResult.shouldImmediateStop) {
    lifeEngine?.receiveEvent({
      type: eventType,
      text,
      classification: gateResult.classification,
      suggestedIntent: gateResult.suggestedIntent
    });
    requestPoseScenario("pose_attentive");
  }

  if (gateResult.shouldOpenAttention) {
    attentionSystem?.wake?.(gateResult.reason, activeConfig.attentionWindowMs ?? 20000);
    requestPoseScenario("pose_attentive");
  }

  if (
    gateResult.accepted &&
    ["direct_to_robot", "possible_direct_command", "question", "social_comment"].includes(gateResult.classification)
  ) {
    attentionSystem?.enterConversation?.(
      gateResult.classification,
      activeConfig.conversationWindowMs ?? 30000
    );
  }

  const event = await postRobotEvent({
    source: source === "typed" ? "typed_input" : "phone-browser",
    type: gateResult.shouldImmediateStop ? "local_stop_phrase" : eventType,
    text,
    payload: {
      confidence: input.confidence,
      language: input.language,
      final: input.final !== false,
      classification: gateResult.classification,
      accepted: gateResult.accepted,
      shouldTriggerBrain: gateResult.shouldTriggerBrain,
      shouldOpenAttention: gateResult.shouldOpenAttention,
      shouldImmediateStop: gateResult.shouldImmediateStop,
      gateReason: gateResult.reason,
      reason: gateResult.reason,
      suggestedIntent: gateResult.suggestedIntent,
      normalizedText: gateResult.normalizedText,
      source
    },
    priority
  });

  if (gateResult.shouldImmediateStop) {
    await immediateStop(
      "local_typed_stop",
      "Local typed stop phrase detected.",
      "warn"
    );
  } else if (!gateResult.accepted) {
    log(`Ignored ${source}: ${text} (${gateResult.classification})`);
  } else if (gateResult.shouldTriggerBrain && isBrainLive()) {
    requestPoseScenario("pose_curious");
  }

  updateAttentionUi();
  updateLocalBrainUi();
  return {
    event,
    gateResult
  };
}

async function refreshCameraDevices({ quiet = false } = {}) {
  if (!globalThis.navigator?.mediaDevices?.enumerateDevices) {
    if (!quiet) {
      log("Camera device list is unavailable in this browser.", "warn");
    }
    syncCameraDeviceSelects();
    return [];
  }

  const devices = await globalThis.navigator.mediaDevices.enumerateDevices();
  cameraDevices = devices.filter((device) => device.kind === "videoinput");
  syncCameraDeviceSelects();

  if (!quiet) {
    const hasHiddenLabels = cameraDevices.some((device) => !device.label);
    log(
      `Camera devices refreshed: ${cameraDevices.length}. front=${formatCameraDeviceForLog(getFrontCameraDeviceId(), "front")} back=${formatCameraDeviceForLog(getBackCameraDeviceId(), "back")}${hasHiddenLabels ? " (labels may appear after camera permission)" : ""}.`
    );
  }

  return cameraDevices;
}

function syncCameraDeviceSelects() {
  populateCameraDeviceSelect(ui.frontCameraDeviceSelect, {
    role: "front",
    selectedDeviceId: getFrontCameraDeviceId(),
    defaultIndex: DEFAULT_FRONT_CAMERA_INDEX
  });
  populateCameraDeviceSelect(ui.backCameraDeviceSelect, {
    role: "back",
    selectedDeviceId: getBackCameraDeviceId(),
    defaultIndex: DEFAULT_BACK_CAMERA_INDEX
  });
}

function populateCameraDeviceSelect(select, { role, selectedDeviceId, defaultIndex }) {
  if (!select) {
    return;
  }

  const cleanSelectedId = normalizeCameraDeviceId(selectedDeviceId);
  const defaultLabel = role === "front"
    ? `Default camera ${defaultIndex} / front`
    : `Default camera ${defaultIndex} / back`;

  select.replaceChildren();
  select.append(new Option(defaultLabel, ""));

  if (cleanSelectedId && !cameraDevices.some((device) => device.deviceId === cleanSelectedId)) {
    select.append(new Option(`Saved ${role} camera (${shortCameraDeviceId(cleanSelectedId)})`, cleanSelectedId));
  }

  cameraDevices.forEach((device, index) => {
    const label = device.label
      ? `Camera ${index}: ${device.label}`
      : `Camera ${index}${device.deviceId ? ` (${shortCameraDeviceId(device.deviceId)})` : ""}`;
    select.append(new Option(label, device.deviceId || ""));
  });

  select.value = [...select.options].some((option) => option.value === cleanSelectedId)
    ? cleanSelectedId
    : "";
}

function getFrontCameraDeviceId() {
  return normalizeCameraDeviceId(frontCameraDeviceId || getDefaultCameraDeviceId("front"));
}

function getBackCameraDeviceId() {
  return normalizeCameraDeviceId(backCameraDeviceId || getDefaultCameraDeviceId("back"));
}

function getDefaultCameraDeviceId(role) {
  const index = role === "back" ? DEFAULT_BACK_CAMERA_INDEX : DEFAULT_FRONT_CAMERA_INDEX;
  const fallbackIndex = role === "front" ? DEFAULT_BACK_CAMERA_INDEX : DEFAULT_FRONT_CAMERA_INDEX;
  return normalizeCameraDeviceId(
    cameraDevices[index]?.deviceId ||
    cameraDevices[fallbackIndex]?.deviceId ||
    cameraDevices[0]?.deviceId ||
    ""
  );
}

function loadCameraDeviceId(role) {
  const key = role === "back" ? BACK_CAMERA_DEVICE_STORAGE_KEY : FRONT_CAMERA_DEVICE_STORAGE_KEY;
  try {
    return normalizeCameraDeviceId(globalThis.localStorage?.getItem?.(key) ?? "");
  } catch {
    return "";
  }
}

function saveCameraDeviceId(role, deviceId) {
  const key = role === "back" ? BACK_CAMERA_DEVICE_STORAGE_KEY : FRONT_CAMERA_DEVICE_STORAGE_KEY;
  try {
    const cleanDeviceId = normalizeCameraDeviceId(deviceId);
    if (cleanDeviceId) {
      globalThis.localStorage?.setItem?.(key, cleanDeviceId);
    } else {
      globalThis.localStorage?.removeItem?.(key);
    }
  } catch {
    // Camera selection still applies for the current session when storage is blocked.
  }
}

function normalizeCameraDeviceId(deviceId) {
  return typeof deviceId === "string" ? deviceId.trim() : "";
}

function formatCameraStatusFacing(status = {}) {
  const facingMode = status.facingMode ?? "unknown";
  const deviceId = normalizeCameraDeviceId(status.deviceId);
  return deviceId
    ? `${facingMode} · ${formatCameraDeviceForLog(deviceId, facingMode === "environment" ? "back" : "front")}`
    : facingMode;
}

function formatCameraDeviceForLog(deviceId, role = "front") {
  const cleanDeviceId = normalizeCameraDeviceId(deviceId);
  if (!cleanDeviceId) {
    const defaultIndex = role === "back" ? DEFAULT_BACK_CAMERA_INDEX : DEFAULT_FRONT_CAMERA_INDEX;
    return `facingMode fallback (default camera ${defaultIndex} not enumerated)`;
  }

  const index = cameraDevices.findIndex((device) => device.deviceId === cleanDeviceId);
  const label = index >= 0 ? cameraDevices[index]?.label : "";
  return label
    ? `camera ${index} ${label}`
    : `camera ${index >= 0 ? index : "saved"} ${shortCameraDeviceId(cleanDeviceId)}`;
}

function shortCameraDeviceId(deviceId) {
  return String(deviceId || "").slice(0, 8);
}

async function openCameraFromUi(facingMode) {
  if (!cameraInput) {
    log("Camera input is still initializing.", "warn");
    return;
  }

  const normalizedFacingMode = facingMode === "environment" ? "environment" : "user";
  const role = normalizedFacingMode === "environment" ? "back" : "front";
  const deviceId = role === "back" ? getBackCameraDeviceId() : getFrontCameraDeviceId();
  log(`Opening ${role} camera using ${formatCameraDeviceForLog(deviceId, role)}.`);
  const result = await cameraInput.startCamera({
    facingMode: normalizedFacingMode,
    deviceId
  });
  handleCameraCommandResult(result);
}

async function captureSnapshotFromUi() {
  if (!cameraInput) {
    log("Camera input is still initializing.", "warn");
    return;
  }

  const result = await cameraInput.captureSnapshot({
    includeDataUrl: true,
    maxWidth: activeConfig.cameraSnapshotMaxWidth ?? PUBLIC_CONFIG.cameraSnapshotMaxWidth ?? 320
  });
  handleCameraCommandResult(result);

  if (result.ok) {
    await postCameraObservationEvent(cameraInput.getLatestObservation(), { force: true });
  }
}

function handleCameraCommandResult(result = {}) {
  updateCameraUi(result.status);

  if (result.ok) {
    if (result.status?.running === false) {
      visionScenarioManager?.stopFollowing?.("camera_stopped");
      drawObjectDetectionOverlays([]);
      syncGeminiVisionAssist("camera_stopped");
    } else if (result.status?.running) {
      refreshCameraDevices({ quiet: true }).catch((error) => {
        log(`Camera device refresh failed: ${error.message}`, "warn");
      });
    }
    syncGeminiVisionAssist("camera_started");
    log("Camera command completed.");
    return;
  }

  if (result.error) {
    log(`Camera command failed: ${result.error}`, "warn");
  }
}

function handleCameraSnapshot(snapshot) {
  if (snapshot?.dataUrl) {
    ui.snapshotPreview.src = snapshot.dataUrl;
    ui.snapshotPreview.hidden = false;
  }

  updateCameraUi();
}

function handleCameraObservation(observation) {
  lifeEngine?.receiveObservation?.(observation);
  updateCameraUi();
  postCameraObservationEvent(observation).catch((error) => {
    log(`Observation event failed: ${error.message}`, "warn");
  });
}

async function postCameraObservationEvent(observation, { force = false } = {}) {
  if (!observation || !observation.cameraRunning) {
    return null;
  }

  const signature = [
    observation.userVisible,
    observation.userPosition,
    observation.userDistance,
    observation.faceCount
  ].join("|");
  const now = Date.now();
  const minInterval =
    activeConfig.cameraObservationPostMs ??
    PUBLIC_CONFIG.cameraObservationPostMs ??
    3000;

  if (!force && signature === lastObservationSignature && now - lastObservationEventAt < minInterval) {
    return null;
  }

  if (!force && now - lastObservationEventAt < minInterval) {
    return null;
  }

  lastObservationSignature = signature;
  lastObservationEventAt = now;

  return postRobotEvent({
    source: "phone-browser",
    type: "observation",
    text: "Camera observation updated",
    payload: {
      observation: compactObservationForEvent(observation),
      cameraStatus: compactCameraStatus(cameraInput?.getCameraStatus?.())
    },
    priority: observation.userVisible ? "normal" : "low"
  });
}

async function postRobotEvent(event) {
  try {
    const localType = normalizeLocalEventType(event);
    const published = localEventBus?.publish?.(
      localType,
      {
        ...event.payload,
        text: event.text,
        originalType: event.type
      },
      {
        source: event.source ?? "phone-browser",
        priority: event.priority === "high" ? 5 : event.priority === "normal" ? 2 : 0
      }
    );

    updateLifeEventsUi();
    renderLocalEvents();
    return published;
  } catch (error) {
    log(`Local event publish failed: ${error.message}`, "warn");
    return null;
  }
}

function normalizeLocalEventType(event = {}) {
  if (event.type === "observation" && event.payload?.observation) {
    return "camera_observation";
  }

  if (event.type === "runtime_note" && event.payload?.lifeEventType) {
    return "system";
  }

  return event.type ?? "system";
}

function isLocalStopPhrase(text) {
  const normalized = text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    /(^|\s)(stop|freeze|halt)(\s|$)/.test(normalized) ||
    /\bdo not move\b/.test(normalized) ||
    /\bdon't move\b/.test(normalized) ||
    /\bemergency stop\b/.test(normalized)
  );
}

function classifyLocalTextInput(text) {
  const stopPhrase = isLocalStopPhrase(text);
  return {
    accepted: true,
    classification: stopPhrase ? "safety_stop" : "direct_to_robot",
    priority: stopPhrase ? "critical" : "normal",
    shouldTriggerBrain: !stopPhrase,
    shouldOpenAttention: true,
    shouldImmediateStop: stopPhrase,
    normalizedText: String(text ?? "").trim().toLowerCase(),
    reason: "local_text_input",
    suggestedIntent: null
  };
}

function bindPersonalityText(element, key) {
  element.addEventListener("input", () => {
    personalityTuning?.patchProfile?.({
      [key]: element.value
    });
  });
}

function bindPersonalityTrait(element, key) {
  element.addEventListener("input", () => {
    personalityTuning?.patchTrait?.(key, Number(element.value));
  });
}

function bindPersonalityBehavior(element, key) {
  element.addEventListener("input", () => {
    personalityTuning?.patchBehaviorStyle?.(key, Number(element.value));
  });
}

async function saveMemoryFromUi() {
  const text = ui.memoryTextInput.value.trim();

  if (!text) {
    log("Memory save skipped: text is empty.", "warn");
    return;
  }

  const payload = await postJson("/api/memory/write", {
    type: ui.memoryTypeSelect.value,
    text,
    metadata: {
      source: "browser_ui",
      importance: "medium"
    }
  });

  ui.memoryTextInput.value = "";
  ui.memoryDisplay.textContent = JSON.stringify(payload.memory ?? payload, null, 2);
  log("Memory saved locally.");
  await refreshMemoryContext();
}

async function refreshMemoryContext() {
  const payload = await fetchJson("/api/memory/context");
  const memory = payload.memory ?? {};

  ui.memoryDisplay.textContent = [
    "# Long-term",
    memory.longTerm || "(empty)",
    "",
    "# Today",
    memory.today || "(empty)",
    "",
    "# Personality notes",
    memory.personalityNotes || "(empty)",
    "",
    `# Learned phrases: ${Array.isArray(memory.learnedPhrases) ? memory.learnedPhrases.length : 0}`
  ].join("\n");
  learnedPhraseCache = Array.isArray(memory.learnedPhrases) ? memory.learnedPhrases : learnedPhraseCache;
  renderLearnedPhrases(learnedPhraseCache);
  return memory;
}

async function saveLearnedPhraseFromUi() {
  const phrase = ui.learnedPhraseInput.value.trim();
  const meaning = ui.learnedMeaningInput.value.trim();

  if (!phrase) {
    log("Learned phrase save skipped: phrase is empty.", "warn");
    return;
  }

  const args = parseJsonObject(ui.learnedArgsInput.value, {});
  const payload = await postJson("/api/memory/learned-phrases", {
    phrase,
    meaning,
    action: ui.learnedActionSelect.value,
    args,
    confidence: ui.learnedConfidenceSelect.value,
    source: "manual"
  });

  ui.learnedPhraseInput.value = "";
  ui.learnedMeaningInput.value = "";
  log(`Learned phrase saved: ${payload.phrase?.phrase ?? phrase}`);
  await refreshLearnedPhrases();
}

async function refreshLearnedPhrases() {
  const payload = await fetchJson("/api/memory/learned-phrases");
  learnedPhraseCache = Array.isArray(payload.phrases) ? payload.phrases : [];
  renderLearnedPhrases(learnedPhraseCache);
  return learnedPhraseCache;
}

function renderLearnedPhrases(phrases = learnedPhraseCache) {
  ui.learnedPhraseList.replaceChildren();

  if (!phrases.length) {
    ui.learnedPhraseList.textContent = "No learned phrases yet.";
    return;
  }

  phrases.slice(0, 40).forEach((phrase) => {
    const item = document.createElement("div");
    item.className = "learned-phrase-item";

    const title = document.createElement("strong");
    title.textContent = `${phrase.phrase} -> ${phrase.action}`;

    const detail = document.createElement("span");
    detail.textContent = `${phrase.meaning || "no meaning"} · confidence=${phrase.confidence} · uses=${phrase.useCount ?? 0} · args=${JSON.stringify(phrase.args ?? {})}`;

    item.append(title, detail);
    ui.learnedPhraseList.append(item);
  });
}

async function applyCalibrationToRobot({ quiet = false } = {}) {
  if (!bodyCalibration) {
    throw new Error("Body calibration is not initialized.");
  }

  const result = await bodyCalibration.applyToRobot(robotClient);

  if (!result.ok) {
    if (!quiet) {
      log(`Calibration not applied: ${result.reason}`, "warn");
    }
    return result;
  }

  if (!quiet) {
    log("Calibration config sent to robot runtime.");
  }

  return result;
}

async function startProductionRuntime() {
  await requestFullscreenSafe();

  if (robotClient?.refreshStatus) {
    await robotClient.refreshStatus().catch((error) => {
      log(`ESP32 gateway refresh failed: ${error.message}`, "warn");
    });
  }

  if (robotClient?.isConnected?.()) {
    await applyCalibrationToRobot({ quiet: true }).catch((error) => {
      log(`Calibration apply during startup failed: ${error.message}`, "warn");
    });
  }

  ui.runtimeGate.classList.add("runtime-gate--hidden");
  document.body.classList.add("production-ready");
  requestPoseScenario("pose_curious");
  log("Local runtime ready. LOOI face is live.");
  updateProductionChrome();
}

async function startLocalBrainProductionMode() {
  const useGeminiLive = isGeminiLivePrimary();
  const geminiStartPromise = useGeminiLive
    ? geminiLiveRuntime.start({
        model: activeConfig.geminiLiveModel,
        voice: activeConfig.geminiLiveVoice,
        thinkingLevel: activeConfig.geminiLiveThinkingLevel
      }).catch((error) => ({ error }))
    : null;

  await startProductionRuntime();
  await ensureOfficialRobotConnection();

  patchBrainPolicy({
    localMotionArmed: true
  });

  lifeEventsEnabled = true;
  globalThis.localStorage?.setItem?.("looi.lifeEventsEnabled.v1", "true");

  performanceMonitor?.start?.();
  reliabilityManager?.start?.();
  wakeLockManager?.request?.().catch((error) => {
    log(`Wake lock unavailable: ${error.message}`, "warn");
  });

  updateLocalBrainUi();
  updateCameraUi();

  localBrainEngine?.start?.();

  if (!lifeEventEmitter?.getStatus?.().running) {
    lifeEventEmitter?.start?.();
  }
  updateLifeEventsUi();

  await ensureRoboflowDetectorRunning("looi_start").catch((error) => {
    log(`Roboflow prewarm skipped: ${error.message}`, "warn");
  });

  const geminiStartResult = useGeminiLive ? await geminiStartPromise : null;
  if (geminiStartResult?.error) {
    throw geminiStartResult.error;
  }
  attentionSystem?.wake?.("live_start", activeConfig.conversationWindowMs ?? 30000);

  requestPoseScenario("pose_happy");
  log(
    useGeminiLive
      ? "Gemini Live started: Gemini audio, camera, LOOI mode, and movement are enabled."
      : "Local Brain Live started: camera, LOOI mode, and movement are enabled.",
    "warn"
  );
  updateAttentionUi();
  updateGeminiLiveUi();
  updateProductionChrome();
}

function primeLiveInputsFromUserGesture() {
  primeCameraFromUserGesture();
}

function primeCameraFromUserGesture() {
  if (!cameraInput || cameraInput.getCameraStatus?.().running) {
    return;
  }

  cameraInput.startCamera?.({
    facingMode: "user",
    deviceId: getFrontCameraDeviceId()
  })
    .then(handleCameraCommandResult)
    .catch((error) => {
      log(`Camera permission prime failed: ${error.message}`, "warn");
    });
}

async function ensureOfficialRobotConnection() {
  if (!robotClient) {
    log("Robot client is still initializing; live mode will continue without body connection for now.", "warn");
    return;
  }

  if (robotClient?.refreshStatus) {
    await robotClient.refreshStatus().catch((error) => {
      log(`ESP32 gateway refresh failed: ${error.message}`, "warn");
    });
  }

  if (!robotClient?.isConnected?.()) {
    const nextUrl = ui.esp32UrlInput.value.trim() || activeConfig.defaultEsp32WsUrl;
    await robotClient.connect(nextUrl).catch((error) => {
      log(`ESP32 gateway is not connected yet: ${error.message}`, "warn");
    });
  }

  if (robotClient?.isConnected?.()) {
    await applyCalibrationToRobot({ quiet: true }).catch((error) => {
      log(`Calibration apply during live startup failed: ${error.message}`, "warn");
    });
    log("ESP32 server gateway is attached for live mode.");
  } else {
    log("Live mode started without ESP32 body connection. Commands will wait until the server gateway is connected.", "warn");
  }
}

async function requestFullscreenSafe() {
  const target = document.documentElement;

  if (document.fullscreenElement || !target?.requestFullscreen) {
    return;
  }

  try {
    await target.requestFullscreen();
  } catch (error) {
    log(`Fullscreen request skipped: ${error.message}`, "warn");
  }
}

function setSettingsOpen(open) {
  settingsOpen = Boolean(open);
  document.body.classList.toggle("settings-open", settingsOpen);
  ui.settingsToggleButton.setAttribute("aria-expanded", String(settingsOpen));
}

function updateProductionChrome() {
  const brainRunning = Boolean(localBrainEngine?.isRunning?.());
  const geminiRunning = Boolean(geminiLiveRuntime?.getStatus?.().running);
  const liveRunning = brainRunning || geminiRunning;
  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};

  ui.localBrainQuickButton.textContent =
    liveRunning
      ? geminiRunning
        ? "LOOI Live"
        : "LOOI Brain Live"
      : "Start LOOI";
  ui.localBrainQuickButton.classList.toggle(
    "local-brain-quick-button--live",
    liveRunning
  );

  if (liveRunning) {
    ui.productionStartButton.textContent = "Enter LOOI Face";
  }

  ui.localVisionState.textContent = cameraStatus.running
    ? `${cameraStatus.facingMode ?? "camera"} live`
    : "camera off";
  const visionContext = getVisionContext();
  ui.localVisionDetail.textContent = visionContext.visibleLabels
    ? `Objects: ${visionContext.visibleLabels}`
    : "No object metadata yet.";

  if (ui.localVisionPreview && cameraInput?.stream) {
    ui.localVisionPreview.srcObject = cameraInput.stream;
  } else if (ui.localVisionPreview) {
    ui.localVisionPreview.srcObject = null;
  }

  document.body.classList.toggle("local-motion-armed", brainPolicy.localMotionArmed);
}

function updateConnectionState(status) {
  const state = status?.state ?? "disconnected";

  ui.esp32Status.textContent = state;
}

function getLifeConnectionState(status) {
  if (!status?.connected) {
    return "disconnected";
  }

  return "connected";
}

function updateLifeStatus(state = lifeEngine?.getState?.()) {
  if (!state) {
    return;
  }

  ui.moodValue.textContent = state.mood;
  ui.energyValue.textContent = formatNumber(state.energy);
  ui.boredomValue.textContent = formatNumber(state.boredom);
  ui.fearValue.textContent = formatNumber(state.fear);
  ui.curiosityValue.textContent = formatNumber(state.curiosity);
  ui.currentBehavior.textContent = state.currentBehavior;
  ui.attentionTarget.textContent = state.attentionTarget;
  ui.obstacleState.textContent = String(Boolean(state.obstacle));
  ui.listeningState.textContent = String(Boolean(state.isListening));
  ui.speakingState.textContent = String(Boolean(state.isSpeaking));
  updateLooiActivityIndicator();
}

function updateLifeEngineToggle() {
  if (!lifeEngine) {
    return;
  }

  ui.lifeEngineToggle.textContent = lifeEngine.running ? "Pause Life Engine" : "Start Life Engine";
}

function updatePersonalityUi(profile = personalityTuning?.getProfile?.()) {
  const value = profile ?? {};
  const traits = value.coreTraits ?? {};
  const behavior = value.behaviorStyle ?? {};

  setInputValue(ui.personalityNameInput, value.name ?? "LOOI");
  setInputValue(ui.personalityIdentityInput, value.identity ?? "small phone-bodied companion robot");
  setInputValue(ui.personalityPronounsInput, value.pronouns ?? "she/her");
  setInputValue(ui.traitCuriosity, traits.curiosity ?? 0.75);
  setInputValue(ui.traitGentleness, traits.gentleness ?? 0.85);
  setInputValue(ui.traitPlayfulness, traits.playfulness ?? 0.55);
  setInputValue(ui.traitShyness, traits.shyness ?? 0.35);
  setInputValue(ui.traitAffection, traits.affection ?? 0.65);
  setInputValue(ui.traitIndependence, traits.independence ?? 0.45);
  setInputValue(ui.traitTalkativeness, traits.talkativeness ?? 0.35);
  setInputValue(ui.traitCaution, traits.caution ?? 0.7);
  setInputValue(ui.behaviorMovementSoftness, behavior.movementSoftness ?? 0.8);
  setInputValue(ui.behaviorReactionSpeed, behavior.reactionSpeed ?? 0.75);
  setInputValue(ui.behaviorIdleActivity, behavior.idleActivity ?? 0.35);
  setInputValue(ui.behaviorEmotionalExpressiveness, behavior.emotionalExpressiveness ?? 0.65);
  setInputValue(ui.behaviorHesitation, behavior.hesitation ?? 0.35);
  setInputValue(ui.behaviorPersonalSpaceRespect, behavior.personalSpaceRespect ?? 0.8);
}

function updateLifeEventsUi(status = lifeEventEmitter?.getStatus?.()) {
  const info = status ?? {
    running: false,
    lastEvent: null
  };

  ui.lifeEventsToggle.checked = lifeEventsEnabled;
  ui.lifeEventsState.textContent = info.running ? "enabled" : "disabled";
  ui.lastLifeEventDisplay.textContent = info.lastEvent
    ? `${info.lastEvent.type} · ${info.lastEvent.priority}`
    : "--";
}

function updateLocalBrainUi() {
  const status = localBrainEngine?.getStatus?.() ?? {
    running: false,
    processing: false,
    adapterAvailable: false,
    provider: "unknown",
    model: "",
    latestLatencyMs: null,
    fallbackUsed: false,
    lastError: null,
    lastThoughtAt: 0,
    recentThoughts: []
  };
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  const geminiPrimaryActive = Boolean(geminiStatus.running || geminiStatus.connecting || geminiStatus.connected);

  ui.localMotionArmedToggle.checked = Boolean(brainPolicy.localMotionArmed);
  updateFollowTuningUi();

  ui.localBrainState.textContent = geminiPrimaryActive
    ? geminiStatus.connected
      ? "Gemini Live"
      : "Gemini starting"
    : status.running
    ? status.processing
      ? "thinking"
      : "running"
    : "stopped";
  ui.localBrainState.classList.toggle("local-brain-state--running", Boolean(geminiPrimaryActive || status.running));
  ui.localBrainState.classList.toggle("local-brain-state--stopped", !geminiPrimaryActive && !status.running);
  ui.localBrainAdapterState.textContent = geminiPrimaryActive
    ? "Gemini Live STS"
    : status.fallbackUsed
    ? "fallback active"
    : status.adapterAvailable
      ? "server adapter"
      : "fallback ready";
  ui.localBrainServerStatus.textContent = status.adapterAvailable
    ? "available"
    : status.lastError
      ? "unavailable"
      : "checking";
  ui.localBrainServerStatus.classList.toggle("local-server-state--available", Boolean(status.adapterAvailable));
  ui.localBrainServerStatus.classList.toggle("local-server-state--unavailable", !status.adapterAvailable);
  ui.localBrainProvider.textContent = geminiPrimaryActive
    ? "gemini-live"
    : status.provider ?? activeConfig.localBrainProvider ?? "unknown";
  ui.localBrainModel.textContent = geminiPrimaryActive
    ? geminiStatus.model || activeConfig.geminiLiveModel || "--"
    : status.model || activeConfig.localBrainModel || "--";
  ui.localBrainLatency.textContent = Number.isFinite(Number(status.latestLatencyMs))
    ? `${Math.round(Number(status.latestLatencyMs))} ms`
    : "--";
  ui.localBrainLastThought.textContent = status.lastThoughtAt
    ? `${Math.round((Date.now() - status.lastThoughtAt) / 100) / 10}s ago`
    : "--";

  document.body.classList.toggle("local-motion-armed", Boolean(brainPolicy.localMotionArmed));
  renderLocalBrainThoughts();
  updateAttentionUi();
  updateProductionChrome();
}

function updateGeminiLiveUi(status = geminiLiveRuntime?.getStatus?.() ?? {}) {
  face?.setThinking?.(Boolean(status.thinking && !status.audioPlaying));

  const state = status.running
    ? status.connected
      ? "connected"
      : "running"
    : status.connecting
      ? "connecting"
      : activeConfig.geminiLiveEnabled
        ? status.configured === false || activeConfig.geminiLiveConfigured === false
          ? "not configured"
          : "stopped"
        : "disabled";

  if (ui.geminiLiveState) {
    ui.geminiLiveState.textContent = state;
    ui.geminiLiveState.classList.toggle("local-server-state--available", Boolean(status.connected || status.running));
    ui.geminiLiveState.classList.toggle("local-server-state--unavailable", !status.connected && !status.running);
  }

  if (ui.geminiLiveMicState) {
    ui.geminiLiveMicState.textContent = status.micStreaming ? "streaming" : status.connecting ? "starting" : "off";
  }

  if (ui.geminiLiveAudioState) {
    ui.geminiLiveAudioState.textContent = status.audioPlaying ? "playing" : "idle";
  }

  ui.listeningState.textContent = String(Boolean(status.micStreaming || lifeEngine?.getState?.().isListening));
  ui.speakingState.textContent = String(Boolean(status.audioPlaying || lifeEngine?.getState?.().isSpeaking));

  if (ui.geminiLiveOutputState) {
    ui.geminiLiveOutputState.textContent =
      status.lastAudioDebug || status.outputAudioState || "--";
  }

  if (ui.geminiLiveFrameState) {
    ui.geminiLiveFrameState.textContent = status.lastVideoFrameDebug || status.lastServerMessageDebug || "--";
  }

  updateGeminiVisionAudioGate(status);
  syncGeminiVisionAssist("gemini_status");

  if (ui.geminiLiveInputTranscript) {
    ui.geminiLiveInputTranscript.textContent = status.lastInputTranscript || "--";
  }

  if (ui.geminiLiveOutputTranscript) {
    ui.geminiLiveOutputTranscript.textContent = status.lastOutputTranscript || "--";
  }

  if (ui.geminiLiveLastToolCall) {
    ui.geminiLiveLastToolCall.textContent = status.lastToolCall || status.lastToolResult || "--";
  }

  if (ui.geminiLiveLatency) {
    ui.geminiLiveLatency.textContent = Number.isFinite(Number(status.latencyMs))
      ? `${Math.round(Number(status.latencyMs))} ms`
      : "--";
  }

  updateLooiActivityIndicator(status);
}

function updateLooiActivityIndicator(geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {}) {
  if (!ui.looiActivityIndicator) {
    return;
  }

  const lifeState = lifeEngine?.getState?.() ?? {};
  const localBrainStatus = localBrainEngine?.getStatus?.() ?? {};
  const looiSpeaking = Boolean(geminiStatus.audioPlaying || lifeState.isSpeaking);
  const thinking = Boolean(
    !looiSpeaking &&
    (geminiStatus.thinking || localBrainStatus.processing)
  );
  const hearingUser = Boolean(!looiSpeaking && !thinking && geminiStatus.inputActive);
  const state = thinking
    ? "thinking"
    : hearingUser
      ? "hearing"
      : "listening";
  const label = thinking ? "Thinking" : "Listening";

  setLooiActivityState(state, label);
}

function setLooiActivityState(state, label) {
  if (!ui.looiActivityIndicator) {
    return;
  }

  const previousState = looiActivityState;
  looiActivityState = state;
  ui.looiActivityIndicator.dataset.state = state;
  ui.looiActivityIndicator.setAttribute("aria-label", `LOOI ${label.toLowerCase()}`);
  if (ui.looiActivityLabel) {
    ui.looiActivityLabel.textContent = label;
  }

  if (state === "thinking") {
    if (previousState !== "thinking") {
      startLooiThinkingDots();
    }
    return;
  }

  stopLooiThinkingDots();
}

function startLooiThinkingDots() {
  const dots = getLooiActivityDots();
  if (!dots.length) {
    return;
  }

  stopLooiThinkingDots({ clearDots: false });
  looiActivitySlotForDot = [0, 1, 2, 3, 4];
  looiActivityActiveStep = 0;
  looiActivityStepStart = performanceNow();
  dots.forEach((dot, index) => {
    dot.style.transform = `translate(-50%, -50%) translate(${LOOI_ACTIVITY_SLOT_X[looiActivitySlotForDot[index]]}px, 0px)`;
    dot.style.opacity = "0.950";
  });
  looiActivityRaf = globalThis.requestAnimationFrame?.(drawLooiThinkingDots) ?? 0;
}

function stopLooiThinkingDots({ clearDots = true } = {}) {
  if (looiActivityRaf) {
    globalThis.cancelAnimationFrame?.(looiActivityRaf);
    looiActivityRaf = 0;
  }

  if (!clearDots) {
    return;
  }

  getLooiActivityDots().forEach((dot) => {
    dot.style.transform = "";
    dot.style.opacity = "";
  });
}

function drawLooiThinkingDots(now) {
  if (looiActivityState !== "thinking") {
    stopLooiThinkingDots();
    return;
  }

  const dots = getLooiActivityDots();
  if (!dots.length) {
    looiActivityRaf = 0;
    return;
  }

  const elapsed = now - looiActivityStepStart;
  const rawT = Math.min(1, elapsed / LOOI_ACTIVITY_STEP_MS);
  const t = easeInOutCubic(rawT);
  const startSlot = LOOI_ACTIVITY_TRIPLET_SEQUENCE[looiActivityActiveStep];
  const pivotSlot = startSlot + 1;
  const endSlot = startSlot + 2;

  dots.forEach((dot, index) => {
    const currentSlot = looiActivitySlotForDot[index];
    const xBase = LOOI_ACTIVITY_SLOT_X[currentSlot];
    let x = xBase;
    let y = 0;
    let scale = 1;
    let opacity = 0.95;

    if (currentSlot === pivotSlot) {
      x = LOOI_ACTIVITY_SLOT_X[pivotSlot];
      scale = 1 + 0.03 * Math.sin(t * Math.PI);
      opacity = 1;
    } else if (currentSlot === startSlot) {
      const theta = Math.PI - Math.PI * t;
      x = LOOI_ACTIVITY_SLOT_X[pivotSlot] + LOOI_ACTIVITY_ORBIT_RADIUS * Math.cos(theta);
      y = -LOOI_ACTIVITY_ORBIT_RADIUS * Math.sin(theta);
      scale = 1 - 0.04 * Math.sin(t * Math.PI);
      opacity = 0.88 + 0.12 * Math.sin(t * Math.PI);
    } else if (currentSlot === endSlot) {
      const theta = Math.PI * t;
      x = LOOI_ACTIVITY_SLOT_X[pivotSlot] + LOOI_ACTIVITY_ORBIT_RADIUS * Math.cos(theta);
      y = LOOI_ACTIVITY_ORBIT_RADIUS * Math.sin(theta);
      scale = 1 - 0.04 * Math.sin(t * Math.PI);
      opacity = 0.88 + 0.12 * Math.sin(t * Math.PI);
    }

    dot.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    dot.style.opacity = opacity.toFixed(3);
  });

  if (rawT >= 1) {
    const leftDot = looiActivitySlotForDot.findIndex((slot) => slot === startSlot);
    const rightDot = looiActivitySlotForDot.findIndex((slot) => slot === endSlot);

    if (leftDot !== -1 && rightDot !== -1) {
      looiActivitySlotForDot[leftDot] = endSlot;
      looiActivitySlotForDot[rightDot] = startSlot;
    }

    looiActivityActiveStep = (looiActivityActiveStep + 1) % LOOI_ACTIVITY_TRIPLET_SEQUENCE.length;
    looiActivityStepStart = now;
  }

  looiActivityRaf = globalThis.requestAnimationFrame?.(drawLooiThinkingDots) ?? 0;
}

function getLooiActivityDots() {
  return Array.from(ui.looiActivityIndicator?.querySelectorAll?.(".looi-activity-points span") ?? []);
}

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - ((-2 * t + 2) ** 3) / 2;
}

function performanceNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function updateGeminiVisionAudioGate(status = geminiLiveRuntime?.getStatus?.() ?? {}) {
  const audioPlaying = isGeminiAudioPlaying(status);

  if (audioPlaying) {
    geminiAudioWasPlaying = true;
    clearGeminiVisionResumeTimer();
    stopGeminiVisionAssist("gemini_audio_playing");
    return;
  }

  if (!geminiAudioWasPlaying) {
    return;
  }

  geminiAudioWasPlaying = false;
  geminiAudioEndedAt = Date.now();
  scheduleGeminiVisionResumeAfterSpeech("gemini_audio_finished");
}

function scheduleGeminiVisionResumeAfterSpeech(reason = "gemini_audio_finished") {
  clearGeminiVisionResumeTimer();
  geminiVisionResumeTimer = globalThis.setTimeout?.(() => {
    geminiVisionResumeTimer = null;
    flushPendingFollowVisionContext(reason);
    syncGeminiVisionAssist(reason);
  }, GEMINI_VISION_RESUME_AFTER_SPEECH_MS) ?? null;
}

function clearGeminiVisionResumeTimer() {
  if (!geminiVisionResumeTimer) {
    return;
  }

  globalThis.clearTimeout?.(geminiVisionResumeTimer);
  geminiVisionResumeTimer = null;
}

function clearPendingGeminiVisionAfterSpeech() {
  clearGeminiVisionResumeTimer();
  pendingFollowVisionContextReason = "";
  geminiAudioWasPlaying = false;
  geminiAudioEndedAt = 0;
}

function isGeminiAudioPlaying(status = geminiLiveRuntime?.getStatus?.() ?? {}) {
  return Boolean(status.audioPlaying || geminiLiveRuntime?.hasOutputAudioInFlight?.());
}

function isGeminiVisionSpeechCooldownActive() {
  return Boolean(
    geminiAudioEndedAt &&
    Date.now() - geminiAudioEndedAt < GEMINI_VISION_RESUME_AFTER_SPEECH_MS
  );
}

function syncGeminiVisionAssist(reason = "sync") {
  const state = getGeminiVisionAssistState(reason);
  updateGeminiVisionAssistUi(state);

  if (!state.shouldRun) {
    stopGeminiVisionAssist(state.reason);
    return;
  }

  if (geminiVisionAssistTimer) {
    return;
  }

  sendGeminiVisionAssistFrame(reason).catch((error) => {
    log(`Gemini vision frame failed: ${error.message}`, "warn");
  });
  geminiVisionAssistTimer = globalThis.setInterval(() => {
    sendGeminiVisionAssistFrame("interval").catch((error) => {
      log(`Gemini vision frame failed: ${error.message}`, "warn");
    });
  }, geminiVisionAssistIntervalMs);
  updateGeminiVisionAssistUi(getGeminiVisionAssistState(reason));
}

function stopGeminiVisionAssist(reason = "stop") {
  if (geminiVisionAssistTimer) {
    globalThis.clearInterval(geminiVisionAssistTimer);
    geminiVisionAssistTimer = null;
  }
  updateGeminiVisionAssistUi(getGeminiVisionAssistState(reason));
}

async function sendGeminiVisionAssistFrame(reason = "frame") {
  const state = getGeminiVisionAssistState(reason);
  if (!state.shouldRun || geminiVisionAssistSending) {
    return false;
  }

  geminiVisionAssistSending = true;
  try {
    const result = await cameraInput?.captureSnapshot?.({
      includeDataUrl: true,
      maxWidth: 320,
      quality: 0.55,
      emit: false,
      record: false
    });

    if (!result?.ok || !result.snapshot?.dataUrl) {
      updateGeminiVisionAssistUi({
        ...state,
        shouldRun: false,
        reason: result?.error ?? "snapshot_unavailable"
      });
      return false;
    }

    if (shouldHoldGeminiVisionInput()) {
      updateGeminiVisionAssistUi(getGeminiVisionAssistState("gemini_audio_playing"));
      return false;
    }

    const sent = await geminiLiveRuntime?.sendVideoFrame?.({
      data: result.snapshot.dataUrl,
      mimeType: "image/jpeg",
      width: result.snapshot.width,
      height: result.snapshot.height,
      reason
    });

    if (sent) {
      geminiVisionAssistLastFrameAt = Date.now();
      updateGeminiVisionAssistUi(getGeminiVisionAssistState(reason));
    }
    return Boolean(sent);
  } finally {
    geminiVisionAssistSending = false;
  }
}

function getGeminiVisionAssistState(reason = "") {
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};
  const audioPlaying = isGeminiAudioPlaying(geminiStatus);
  const speechCooldownActive = isGeminiVisionSpeechCooldownActive();
  const blockedReason = !geminiVisionAssistEnabled
    ? "disabled"
    : !geminiStatus.connected
      ? "gemini_not_connected"
      : audioPlaying
        ? "gemini_audio_playing"
        : speechCooldownActive
          ? "gemini_audio_cooldown"
          : !cameraStatus.running
            ? "camera_off"
            : "running";
  const shouldRun = Boolean(
    geminiVisionAssistEnabled &&
    geminiStatus.connected &&
    !audioPlaying &&
    !speechCooldownActive &&
    cameraStatus.running
  );

  return {
    shouldRun,
    enabled: geminiVisionAssistEnabled,
    connected: Boolean(geminiStatus.connected),
    cameraRunning: Boolean(cameraStatus.running),
    audioPlaying,
    speechCooldownActive,
    followActive: isFollowVisionModeActive(),
    reason: shouldRun ? reason || "running" : blockedReason
  };
}

function updateGeminiVisionAssistUi(state = getGeminiVisionAssistState()) {
  if (ui.geminiVisionAssistToggle) {
    ui.geminiVisionAssistToggle.checked = geminiVisionAssistEnabled;
  }
  if (ui.geminiVisionAssistState) {
    ui.geminiVisionAssistState.textContent = state.shouldRun
      ? "sending frames"
      : state.reason || "off";
  }
  if (ui.geminiVisionAssistLastFrame) {
    ui.geminiVisionAssistLastFrame.textContent = geminiVisionAssistLastFrameAt
      ? `${Math.round((Date.now() - geminiVisionAssistLastFrameAt) / 1000)}s ago`
      : "--";
  }
}

async function refreshLocalBrainServerStatus() {
  const status = await localBrainEngine?.checkAdapterStatus?.();
  updateLocalBrainUi();
  return status;
}

function patchBrainPolicy(partial = {}) {
  brainPolicy = clampBrainPolicy({
    ...brainPolicy,
    ...partial
  });
  updateLocalBrainUi();
}

function armMovementForScenario({ requestedLabel = "", resolvedLabel = "" } = {}) {
  const wasArmed = Boolean(brainPolicy.localMotionArmed);

  patchBrainPolicy({
    localMotionArmed: true
  });

  if (!wasArmed) {
    const targetText = resolvedLabel || requestedLabel || "target";
    log(`Movement auto-armed for ${targetText}.`, "warn");
  }
}

function getPolicy() {
  return clampBrainPolicy(brainPolicy);
}

async function runScenarioFromUi(name, args = {}) {
  if (!toolExecutor?.executeAction) {
    log("Scenario runtime is still initializing.", "warn");
    return null;
  }

  const result = await toolExecutor.executeAction({
    id: `ui_scenario_${name}_${Date.now()}`,
    source: "local",
    type: "run_scenario",
    args: {
      name,
      ...args
    },
    reason: `ui_scenario:${name}`
  });
  return result;
}

function requestPoseScenario(name, { minIntervalMs = 650 } = {}) {
  if (!toolExecutor?.executeAction) {
    return null;
  }

  const now = Date.now();
  const lastAt = Number(poseScenarioLastRun.get(name) || 0);
  if (now - lastAt < minIntervalMs) {
    return null;
  }
  poseScenarioLastRun.set(name, now);

  return runScenarioFromUi(name).catch((error) => {
    log(`Pose scenario ${name} failed: ${error.message}`, "warn");
    return null;
  });
}

function renderLocalBrainThoughts(thoughts = localBrainEngine?.getRecentThoughts?.({ limit: 10 }) ?? []) {
  if (!ui.localBrainThoughtList) {
    return;
  }

  ui.localBrainThoughtList.replaceChildren();

  if (!thoughts.length) {
    const empty = document.createElement("div");
    empty.className = "local-brain-item";
    empty.innerHTML = "<strong>No local thoughts yet</strong><span>Type a message or press Think Now.</span>";
    ui.localBrainThoughtList.append(empty);
    return;
  }

  thoughts.forEach((thought) => {
    const item = document.createElement("div");
    item.className = `local-brain-item${thought.skipped ? " local-brain-item--skipped" : ""}`;

    const title = document.createElement("strong");
    title.textContent = `${thought.reason ?? "thought"} · ${thought.actionType || "none"}`;

    const detail = document.createElement("span");
    const resultSummary = (thought.results ?? [])
      .map((result) => `${result.type ?? "unknown"}:${result.status ?? "unknown"}`)
      .join(" ");
    const providerSummary = `${thought.provider ?? thought.source ?? "unknown"}${thought.fallbackUsed ? " fallback" : ""}`;
    const latencySummary = Number.isFinite(Number(thought.latencyMs)) && Number(thought.latencyMs) > 0
      ? ` · ${Math.round(Number(thought.latencyMs))} ms`
      : "";
    detail.textContent = `${new Date(thought.timestamp).toLocaleTimeString()} · ${providerSummary}${latencySummary} · ${thought.message || "--"}${resultSummary ? ` · ${resultSummary}` : ""}`;

    item.append(title, detail);
    ui.localBrainThoughtList.append(item);
  });
}

function renderLocalEvents(events = localEventBus?.getRecentEvents?.({ limit: 30 }) ?? []) {
  if (!ui.localEventList) {
    return;
  }

  ui.localEventList.replaceChildren();

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "local-event-item";
    empty.innerHTML = "<strong>No local events yet</strong><span>Text, camera, telemetry, and life events appear here.</span>";
    ui.localEventList.append(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = `local-event-item local-event-item--p${event.priority}`;

    const title = document.createElement("strong");
    title.textContent = `${event.type} · ${event.source}`;

    const detail = document.createElement("span");
    const text = event.payload?.text ?? event.payload?.lifeEventType ?? event.payload?.originalType ?? "";
    const classification = event.payload?.classification ? ` · ${event.payload.classification}` : "";
    detail.textContent = `${new Date(event.timestamp).toLocaleTimeString()} · ${text || event.id}${classification}`;

    item.append(title, detail);
    ui.localEventList.append(item);
  });
}

function updateAttentionUi() {
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  const attentionStatus = attentionSystem?.update?.() ?? {
    mode: "idle",
    attentionRemainingMs: 0,
    stopCooldownRemainingMs: 0
  };

  updateGeminiLiveUi(geminiStatus);

}

function updateOutputAudioUi() {
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  ui.speakingState.textContent = String(Boolean(geminiStatus.audioPlaying || lifeEngine?.getState?.().isSpeaking));
  updateAttentionUi();
  updateProductionChrome();
}

function updateCameraUi(status = cameraInput?.getCameraStatus?.()) {
  const cameraStatus = status ?? {
    supported: false,
    secureContext: globalThis.isSecureContext === true,
    running: false,
    facingMode: "unknown",
    lastError: null,
    visionSupported: { faceDetector: false },
    observation: null
  };
  const observation = cameraStatus.observation ?? {};
  visionState?.setCameraStatus?.(cameraStatus);

  ui.cameraSupportState.textContent = cameraStatus.supported
    ? cameraStatus.running
      ? "running"
      : "supported"
    : "unsupported";
  ui.cameraSupportState.classList.toggle("camera-state--active", Boolean(cameraStatus.running));
  ui.cameraSupportState.classList.toggle("camera-state--warn", !cameraStatus.supported);
  ui.cameraSecureWarning.textContent = cameraStatus.secureContext
    ? "Camera access may require user permission."
    : "Camera access usually requires HTTPS or localhost.";
  ui.cameraRunningState.textContent = cameraStatus.running ? "running" : "stopped";
  ui.cameraFacingMode.textContent = formatCameraStatusFacing(cameraStatus);
  ui.cameraLastError.textContent = cameraStatus.lastError ?? "--";
  ui.cameraVisionSupport.textContent = cameraStatus.visionSupported?.faceDetector
    ? "FaceDetector supported"
    : "FaceDetector unavailable";
  ui.cameraUserVisible.textContent = String(Boolean(observation.userVisible));
  ui.cameraUserPosition.textContent = observation.userPosition ?? "unknown";
  ui.cameraUserDistance.textContent = observation.userDistance ?? "unknown";
  ui.cameraFaceCount.textContent =
    observation.faceCount === null || observation.faceCount === undefined
      ? "--"
      : String(observation.faceCount);
  ui.cameraLastObservation.textContent = observation.timestamp
    ? `${observation.detector ?? "none"} · ${observation.note ?? ""}`
    : "--";
  updateVisionUi();
  updateProductionChrome();
}

async function startObjectDetectionFromUi() {
  return ensureRoboflowDetectorRunning("manual_start");
}

async function ensureRoboflowDetectorRunning(reason = "detector_start") {
  if (!objectDetectorEngine) {
    throw new Error("Object detector is not initialized.");
  }

  roboflowDetectorWanted = true;

  if (isRoboflowDetectorActive()) {
    log(`[roboflow] detector already running reason=${reason}`, "debug");
    updateVisionUi();
    return objectDetectorEngine.getStatus?.() ?? {};
  }

  if (roboflowDetectorStartPromise) {
    log(`[roboflow] detector start already in progress reason=${reason}`, "debug");
    return roboflowDetectorStartPromise;
  }

  roboflowDetectorStartPromise = startRoboflowDetector(reason).finally(() => {
    roboflowDetectorStartPromise = null;
  });

  return roboflowDetectorStartPromise;
}

async function startRoboflowDetector(reason = "detector_start") {
  await ensureFrontCameraForRoboflow(reason);

  if (!roboflowDetectorWanted) {
    log(`[roboflow] detector start skipped after stop reason=${reason}`, "debug");
    return objectDetectorEngine.getStatus?.() ?? {};
  }

  const status = await objectDetectorEngine.start();
  if (!roboflowDetectorWanted) {
    objectDetectorEngine.stop?.();
    log(`[roboflow] detector start completed after stop; stopped immediately reason=${reason}`, "warn");
    updateVisionUi();
    return objectDetectorEngine.getStatus?.() ?? status;
  }

  const active = Boolean(status?.running || status?.starting || objectDetectorEngine?.isRunning?.());
  log(
    active
      ? `[roboflow] detector warm reason=${reason}`
      : `[roboflow] detector unavailable reason=${reason} error=${status?.lastError ?? "unknown"}`,
    active ? "info" : "warn"
  );
  updateVisionUi();
  return status;
}

async function ensureFrontCameraForRoboflow(reason = "detector_start") {
  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};
  const frontDeviceId = getFrontCameraDeviceId();
  const needsFrontCamera = !cameraStatus.running ||
    cameraStatus.facingMode !== "user" ||
    Boolean(frontDeviceId && cameraStatus.deviceId !== frontDeviceId);

  if (needsFrontCamera) {
    log(`[roboflow] starting front camera reason=${reason} device=${formatCameraDeviceForLog(frontDeviceId, "front")}.`);
    const result = await cameraInput.startCamera({
      facingMode: "user",
      deviceId: frontDeviceId
    });
    handleCameraCommandResult(result);
    if (!result?.ok) {
      throw new Error(result?.error || "Camera could not start.");
    }
  }
}

function stopLooiRoboflowRuntime(reason = "looi_stop") {
  roboflowDetectorWanted = false;

  if (followTargetController?.isRunning?.()) {
    visionScenarioManager?.stopFollowing?.(reason);
  } else {
    visionState?.clearActiveTarget?.(reason);
    face?.stopFollow?.();
  }

  if (objectDetectorEngine) {
    const wasActive = isRoboflowDetectorActive();
    objectDetectorEngine.stop?.();
    if (wasActive) {
      log(`[roboflow] detector stopped with LOOI runtime reason=${reason}`);
    }
  }

  drawObjectDetectionOverlays([]);
  updateVisionUi();
}

function isRoboflowDetectorActive() {
  const status = objectDetectorEngine?.getStatus?.() ?? {};
  return Boolean(status.running || status.starting || objectDetectorEngine?.isRunning?.());
}

async function setRoboflowWorkflowFromUi() {
  if (!objectDetectorEngine?.setWorkflowId) {
    return null;
  }

  const workflowId = ui.objectRoboflowWorkflowSelect?.value?.trim();
  if (!workflowId) {
    return null;
  }

  const wasRunning = Boolean(objectDetectorEngine.isRunning?.());
  const status = await objectDetectorEngine.setWorkflowId(workflowId, {
    restart: true
  });
  log(
    wasRunning
      ? `Roboflow workflow changed to ${workflowId}. Detector restarted.`
      : `Roboflow workflow changed to ${workflowId}. It will apply on next detector start.`,
    wasRunning ? "warn" : "info"
  );
  updateVisionUi();
  return status;
}

async function setRoboflowGpuPlanFromUi() {
  if (!objectDetectorEngine?.setRequestedPlan) {
    return null;
  }

  const requestedPlan = ui.objectRoboflowGpuPlanSelect?.value?.trim();
  if (!requestedPlan) {
    return null;
  }

  const wasRunning = Boolean(objectDetectorEngine.isRunning?.());
  const status = await objectDetectorEngine.setRequestedPlan(requestedPlan, {
    restart: true
  });
  log(
    wasRunning
      ? `Roboflow GPU plan changed to ${formatRoboflowGpuPlan(requestedPlan)}. Detector restarted.`
      : `Roboflow GPU plan changed to ${formatRoboflowGpuPlan(requestedPlan)}. It will apply on next detector start.`,
    wasRunning ? "warn" : "info"
  );
  updateVisionUi();
  return status;
}

function handleObjectDetections(result = {}) {
  const tracks = objectTracker?.update?.(result) ?? [];
  visionState?.updateFromDetections?.(result, tracks);
  updateVisionUi();
  drawObjectDetectionOverlays(result);
}

function getVisionContext() {
  return buildVisionContext({
    visionState,
    cameraInput,
    objectTracker
  });
}

function isFollowVisionModeActive() {
  return Boolean(followTargetController?.isRunning?.());
}

function handleVisionFollowEvent(event = {}) {
  const type = event.type ?? "";
  updateVisionUi();
  sendFollowStateContext(type);

  syncGeminiVisionAssist(type);
}

function sendFollowStateContext(reason = "follow_context") {
  if (!geminiLiveRuntime?.sendVisionContext) {
    return false;
  }

  if (!isFollowStateContextReason(reason)) {
    return false;
  }

  if (shouldHoldGeminiVisionInput()) {
    pendingFollowVisionContextReason = reason;
    log(`Gemini follow context queued until speech ends reason=${reason}`, "debug");
    return false;
  }

  return sendFollowStateContextNow(reason);
}

function shouldHoldGeminiVisionInput() {
  return isGeminiAudioPlaying() || isGeminiVisionSpeechCooldownActive();
}

function flushPendingFollowVisionContext(trigger = "gemini_audio_finished") {
  if (!pendingFollowVisionContextReason) {
    return false;
  }

  if (shouldHoldGeminiVisionInput()) {
    scheduleGeminiVisionResumeAfterSpeech(trigger);
    return false;
  }

  const reason = pendingFollowVisionContextReason;
  pendingFollowVisionContextReason = "";
  log(`Gemini follow context flushed reason=${reason} trigger=${trigger}`, "debug");
  return sendFollowStateContextNow(reason);
}

function sendFollowStateContextNow(reason = "follow_context") {
  const sendPromise = geminiLiveRuntime.sendVisionContext({
    force: true,
    reason
  });
  sendPromise?.catch?.((error) => {
    log(`Gemini follow state context failed: ${error.message}`, "warn");
  });
  return sendPromise;
}

function isFollowStateContextReason(reason = "") {
  return [
    "vision_follow_started",
    "vision_follow_stopped",
    "vision_follow_not_found",
    "vision_target_lost",
    "vision_target_reacquired"
  ].includes(reason);
}

function updateRecentObjectReferenceFromText(text) {
  const context = getVisionContext();
  const knownLabels = context.objects.map((object) => object.label).filter(Boolean);
  const labels = findMentionedObjectLabels(text, knownLabels);
  const label = labels[0];

  if (!label) {
    return recentObjectReference;
  }

  const object = visionState?.findObject?.(label);
  recentObjectReference = {
    label,
    aliases: labels,
    lastMentionedByUserAt: new Date().toISOString(),
    lastSeenAt: object?.lastSeenAt ?? null,
    trackId: object?.trackId ?? object?.id ?? null
  };
  return recentObjectReference;
}

function isStopFollowIntent(text) {
  const normalized = String(text ?? "").toLowerCase();
  return /\b(stop following|stop tracking|cancel follow|cancel tracking|forget the target|never mind|nevermind)\b/.test(normalized);
}

function updateVisionUi() {
  const detectorStatus = objectDetectorEngine?.getStatus?.() ?? {};
  const context = getVisionContext();
  const activeTarget = context.activeTarget;
  const followStatus = followTargetController?.getStatus?.() ?? {};
  updateFollowTuningUi(followStatus);

  if (ui.objectMaxResultsInput && detectorStatus.maxResults !== undefined && document.activeElement !== ui.objectMaxResultsInput) {
    ui.objectMaxResultsInput.value = String(detectorStatus.maxResults);
  }
  if (
    ui.objectCategoryAllowlistInput &&
    Array.isArray(detectorStatus.categoryAllowlist) &&
    document.activeElement !== ui.objectCategoryAllowlistInput
  ) {
    ui.objectCategoryAllowlistInput.value = detectorStatus.categoryAllowlist.join(",");
  }
  if (ui.objectDetectorState) {
    ui.objectDetectorState.textContent = detectorStatus.running ? "running" : detectorStatus.ready ? "ready" : "stopped";
  }
  if (ui.objectDetectorModel) {
    ui.objectDetectorModel.textContent = detectorStatus.modelName ?? "--";
  }
  if (ui.objectRoboflowWorkflowSelect && detectorStatus.workflowId) {
    syncSelectOptions(ui.objectRoboflowWorkflowSelect, detectorStatus.workflowOptions, detectorStatus.workflowId);
  }
  if (
    ui.objectRoboflowWorkflowSelect &&
    detectorStatus.workflowId &&
    document.activeElement !== ui.objectRoboflowWorkflowSelect
  ) {
    setSelectValue(ui.objectRoboflowWorkflowSelect, detectorStatus.workflowId);
  }
  if (ui.objectDetectorWorkflow) {
    ui.objectDetectorWorkflow.textContent = detectorStatus.workflowId ?? "--";
  }
  if (ui.objectDetectorQuality) {
    ui.objectDetectorQuality.textContent = [
      detectorStatus.modelQuality,
      detectorStatus.modelInputShape,
      detectorStatus.modelQuantization
    ].filter(Boolean).join(" · ") || "--";
  }
  if (
    ui.objectRoboflowGpuPlanSelect &&
    detectorStatus.requestedPlan &&
    document.activeElement !== ui.objectRoboflowGpuPlanSelect
  ) {
    setSelectValue(ui.objectRoboflowGpuPlanSelect, detectorStatus.requestedPlan, formatRoboflowGpuPlan(detectorStatus.requestedPlan));
  }
  if (ui.objectDetectorGpuPlan) {
    ui.objectDetectorGpuPlan.textContent = formatRoboflowGpuPlan(detectorStatus.requestedPlan);
  }
  if (ui.objectDetectorParams) {
    ui.objectDetectorParams.textContent = [
      detectorStatus.maxResults ? `max ${detectorStatus.maxResults}` : null,
      detectorStatus.categoryAllowlist?.length ? `allow ${detectorStatus.categoryAllowlist.join(", ")}` : "all categories"
    ].filter(Boolean).join(" · ");
  }
  if (ui.objectDetectionLastRun) {
    ui.objectDetectionLastRun.textContent =
      context.lastDetectionAgeMs === null || context.lastDetectionAgeMs === undefined
        ? "--"
        : `${Math.round(context.lastDetectionAgeMs / 1000)}s ago`;
  }
  if (ui.objectDetectionMetadataCount) {
    ui.objectDetectionMetadataCount.textContent = String(context.objects.length);
  }
  if (ui.objectDetectionError) {
    ui.objectDetectionError.textContent = detectorStatus.lastError ?? "--";
  }
  if (ui.objectDetectionList) {
    renderDetectedObjects(ui.objectDetectionList, objectDetectorEngine?.lastResult?.detections ?? []);
  }
  if (ui.visibleObjectLabels) {
    ui.visibleObjectLabels.textContent = context.visibleLabels || "--";
  }
  const followLabel = followStatus.targetLabel || activeTarget?.label || "";
  const followState = followStatus.running ? followStatus.state : (context.scenario?.state ?? "idle");
  const followVisible = followStatus.running ? followStatus.targetVisible : activeTarget?.visible;

  if (ui.activeFollowTarget) {
    ui.activeFollowTarget.textContent = followLabel
      ? `${followLabel} · ${followVisible ? "visible" : "not visible"}`
      : "--";
  }
  if (ui.followScenarioState) {
    ui.followScenarioState.textContent = followState ?? "idle";
  }
  if (ui.followControllerState) {
    ui.followControllerState.textContent = followStatus.running
      ? `${followStatus.state ?? "running"} · motion ${followStatus.motionAllowed ? "allowed" : `held: ${followStatus.motionHeldReason ?? "unknown"}`}`
      : "stopped";
  }
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult ?? { detections: [] });
}

function applyFollowPresetFromUi() {
  const presetId = ui.followTuningPresetSelect?.value;
  const preset = FOLLOW_TUNING_PRESETS[presetId];

  if (!preset) {
    return;
  }

  const nextTuning = {
    ...preset,
    followTargetCenterX: brainPolicy.followTargetCenterX
  };
  delete nextTuning.label;
  patchBrainPolicy(nextTuning);
  saveFollowTuningSettings(nextTuning);
  updateFollowTuningUi(undefined, { syncPreset: false });
  updateVisionUi();
  log(`Follow tuning preset applied: ${FOLLOW_TUNING_PRESETS[presetId].label}.`, "info");
}

function updateFollowTuningUi(followStatus = followTargetController?.getStatus?.() ?? {}, { syncPreset = true } = {}) {
  if (ui.followTuningPresetSelect && syncPreset) {
    setSelectValue(ui.followTuningPresetSelect, findMatchingFollowPresetId() ?? DEFAULT_FOLLOW_TUNING_PRESET);
  }

  if (ui.followCurrentErrorX) {
    const errorX = followStatus.lastSteering?.errorX;
    ui.followCurrentErrorX.textContent = Number.isFinite(Number(errorX))
      ? formatSignedFollowValue(errorX, 3)
      : "--";
  }
  if (ui.followSteeringState) {
    const steering = followStatus.lastSteering;
    ui.followSteeringState.textContent = steering
      ? `${steering.direction} · angular ${formatSignedFollowValue(steering.angular, 3)} · duration ${Math.round(steering.commandDurationMs ?? brainPolicy.followCommandDurationMs)}ms · interval ${Math.round(steering.commandRefreshMs ?? brainPolicy.followCommandRefreshMs)}ms · tolerance ${formatFollowValue(steering.deadband, 3)} · max age ${Math.round(brainPolicy.followMaxDetectionAgeMs ?? 0)}ms`
      : "--";
  }
}

function renderDetectedObjects(container, detections = []) {
  if (!container) {
    return;
  }

  container.replaceChildren();
  const visible = Array.isArray(detections) ? detections.slice(0, 12) : [];
  if (!visible.length) {
    container.textContent = "No detections yet.";
    return;
  }

  visible.forEach((detection) => {
    const confidence = Math.round(Number(detection.confidence || 0) * 100);
    const centerX = Number.isFinite(Number(detection.centerX))
      ? Number(detection.centerX).toFixed(2)
      : "--";
    const centerY = Number.isFinite(Number(detection.centerY))
      ? Number(detection.centerY).toFixed(2)
      : "--";
    const chip = document.createElement("span");
    chip.className = "detected-object-chip";
    chip.textContent = `${detection.label} ${confidence}% · ${detection.position ?? "unknown"}/${detection.distance ?? "unknown"} · (${centerX},${centerY})`;
    container.append(chip);
  });
}

function drawObjectDetectionOverlays(resultOrDetections = []) {
  const result = Array.isArray(resultOrDetections)
    ? {
        detections: resultOrDetections,
        frameWidth: objectDetectorEngine?.lastResult?.frameWidth,
        frameHeight: objectDetectorEngine?.lastResult?.frameHeight
      }
    : resultOrDetections || { detections: [] };

  drawObjectDetectionOverlay(ui.objectDetectionOverlay, result, ui.cameraPreview);
}

function drawObjectDetectionOverlay(canvas, result = {}, videoElement = null) {
  if (!canvas) {
    return;
  }

  const detections = Array.isArray(result?.detections) ? result.detections : [];
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width || canvas.clientWidth || 0);
  const height = Math.round(rect.height || canvas.clientHeight || 0);
  logOverlayDiagnostics(canvas, result, { width, height });
  if (width <= 0 || height <= 0) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  const frameWidth = Number(result?.frameWidth || videoElement?.videoWidth || width);
  const frameHeight = Number(result?.frameHeight || videoElement?.videoHeight || height);
  const scale = Math.max(width / Math.max(1, frameWidth), height / Math.max(1, frameHeight));
  const renderedWidth = frameWidth * scale;
  const renderedHeight = frameHeight * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;

  detections.slice(0, 12).forEach((detection) => {
    const bbox = detection.bbox ?? {};
    const x = Number(bbox.x || 0) * scale + offsetX;
    const y = Number(bbox.y || 0) * scale + offsetY;
    const boxWidth = Number(bbox.width || 0) * scale;
    const boxHeight = Number(bbox.height || 0) * scale;
    const label = `${detection.label} ${Math.round(Number(detection.confidence || 0) * 100)}% · ${detection.position}/${detection.distance}`;
    if (!Number.isFinite(x + y + boxWidth + boxHeight) || boxWidth <= 0 || boxHeight <= 0) {
      drawDetectionCenter(ctx, detection, { width, height, scale, offsetX, offsetY, frameWidth, frameHeight, label });
      return;
    }

    ctx.strokeStyle = "rgba(126, 224, 186, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.font = "12px sans-serif";
    const textWidth = ctx.measureText(label).width + 10;
    const labelX = Math.max(0, Math.min(width - 12, x));
    const labelY = Math.max(0, Math.min(height - 18, y - 20));
    ctx.fillStyle = "rgba(5, 8, 16, 0.82)";
    ctx.fillRect(labelX, labelY, Math.max(0, Math.min(textWidth, width - labelX)), 18);
    ctx.fillStyle = "#dfffee";
    ctx.fillText(label, labelX + 5, labelY + 13);
  });
}

function drawDetectionCenter(ctx, detection = {}, geometry = {}) {
  const centerX = Number.isFinite(Number(detection.centerX))
    ? Number(detection.centerX) * geometry.frameWidth
    : geometry.frameWidth / 2;
  const centerY = Number.isFinite(Number(detection.centerY))
    ? Number(detection.centerY) * geometry.frameHeight
    : geometry.frameHeight / 2;
  const x = centerX * geometry.scale + geometry.offsetX;
  const y = centerY * geometry.scale + geometry.offsetY;

  ctx.strokeStyle = "rgba(255, 214, 77, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(5, 8, 16, 0.82)";
  ctx.fillRect(Math.max(0, x + 10), Math.max(0, y - 10), Math.min(geometry.width - x - 10, 120), 18);
  ctx.fillStyle = "#fff0a6";
  ctx.font = "12px sans-serif";
  ctx.fillText(geometry.label || detection.label || "object", Math.max(0, x + 15), Math.max(0, y + 3));
}

function logOverlayDiagnostics(canvas, result = {}, size = {}) {
  const detections = Array.isArray(result?.detections) ? result.detections : [];
  if (!detections.length) {
    return;
  }

  const now = Date.now();
  if (now - lastOverlayDebugAt < 1500) {
    return;
  }

  lastOverlayDebugAt = now;
  const first = detections[0] ?? {};
  console.debug?.("[LOOI overlay]", {
    canvas: canvas.id || "unknown",
    canvasSize: `${size.width}x${size.height}`,
    frameSize: `${result?.frameWidth ?? "?"}x${result?.frameHeight ?? "?"}`,
    detections: detections.length,
    first: {
      label: first.label,
      confidence: first.confidence,
      centerX: first.centerX,
      centerY: first.centerY,
      bbox: first.bbox
    }
  });
}

function isGeminiLivePrimary() {
  return Boolean(activeConfig.geminiLiveEnabled && geminiLiveRuntime);
}

function isBrainLive() {
  return Boolean(localBrainEngine?.isRunning?.() || geminiLiveRuntime?.getStatus?.().running);
}

function getExecutionPolicy() {
  return {
    source: "local",
    localMotionArmed: brainPolicy.localMotionArmed,
    followLostTimeoutMs: brainPolicy.followLostTimeoutMs,
    followTargetCenterX: brainPolicy.followTargetCenterX,
    followCenterDeadband: brainPolicy.followCenterDeadband,
    followSteerGain: brainPolicy.followSteerGain,
    maxObjectFollowSpeed: brainPolicy.maxObjectFollowSpeed,
    followCommandDurationMs: brainPolicy.followCommandDurationMs,
    followCommandRefreshMs: brainPolicy.followCommandRefreshMs,
    followMaxDetectionAgeMs: brainPolicy.followMaxDetectionAgeMs,
    robotConnected: Boolean(robotClient?.isConnected?.())
  };
}

function getRuntimeContext() {
  const lifeState = lifeEngine?.getState?.() ?? null;
  const cameraStatus = compactCameraStatus(cameraInput?.getCameraStatus?.());

  return {
    lifeState,
    latestTelemetry: robotClient?.getLatestTelemetry?.() ?? null,
    robotTelemetry: robotClient?.getLatestTelemetry?.() ?? null,
    connectionState: ui.esp32Status.textContent,
    robotConnected: Boolean(robotClient?.isConnected?.()),
    localPolicy: getPolicy(),
    attention: attentionSystem?.getStatus?.() ?? null,
    sequenceStatus: {
      current: scenarioFrameSequencer?.getCurrentSequence?.() ?? null,
      history: scenarioFrameSequencer?.getHistory?.({ limit: 5 }) ?? []
    },
    performanceStatus: performanceMonitor?.getStatus?.() ?? null,
    reliabilityStatus: reliabilityManager?.getStatus?.() ?? null,
    geminiLive: geminiLiveRuntime?.getStatus?.() ?? null,
    calibration: bodyCalibration?.getSettings?.() ?? null,
    personality: describePersonalityForRuntime(personalityTuning?.getProfile?.()),
    lifeSignals: {
      loneliness: lifeState?.loneliness,
      comfort: lifeState?.comfort,
      interactionCount: lifeState?.interactionCount,
      stopRespectActive: Number(lifeState?.stopRespectUntil || 0) > Date.now(),
      lifeEventsEnabled
    },
    recentCommands: commandQueue?.getRecentCommands?.({ limit: 8 }) ?? [],
    recentLifeEvents: lifeState?.recentEvents ?? [],
    recentEvents: localEventBus?.getRecentEvents?.({ limit: 30 }) ?? [],
    cameraStatus,
    latestObservation: cameraStatus.observation,
    vision: getVisionContext(),
    recentObjectReference,
    audioStatus: {
      geminiLive: geminiLiveRuntime?.getStatus?.() ?? null,
      isSpeaking: Boolean(geminiLiveRuntime?.getStatus?.().audioPlaying || lifeState?.isSpeaking)
    },
    browserTimestamp: new Date().toISOString()
  };
}

function summarizeActionResult(result = {}) {
  return {
    actionId: result.actionId ?? null,
    type: result.type ?? null,
    status: result.status ?? "unknown",
    executed: Boolean(result.executed),
    physical: Boolean(result.physical),
    message: result.message ?? "",
    timestamp: result.timestamp ?? new Date().toISOString()
  };
}

function compactCameraStatus(status = {}) {
  const observation = status?.observation ?? null;

  return {
    supported: Boolean(status?.supported),
    secureContext: Boolean(status?.secureContext),
    running: Boolean(status?.running),
    facingMode: status?.facingMode ?? "unknown",
    deviceId: status?.deviceId ?? "",
    lastError: status?.lastError ?? null,
    lastFrameAt: status?.lastFrameAt ?? null,
    lastSnapshotAt: status?.lastSnapshotAt ?? null,
    visionSupported: {
      faceDetector: Boolean(status?.visionSupported?.faceDetector)
    },
    latestObservation: observation ? compactObservationForEvent(observation) : null,
    observation: observation ? compactObservationForEvent(observation) : null
  };
}

function compactObservationForEvent(observation = {}) {
  return {
    timestamp: observation.timestamp ?? new Date().toISOString(),
    cameraRunning: Boolean(observation.cameraRunning),
    facingMode: observation.facingMode ?? "unknown",
    detector: observation.detector ?? "none",
    userVisible: Boolean(observation.userVisible),
    faceCount: Number.isFinite(Number(observation.faceCount))
      ? Number(observation.faceCount)
      : null,
    userPosition: observation.userPosition ?? "unknown",
    userDistance: observation.userDistance ?? "unknown",
    brightness: Number.isFinite(Number(observation.brightness))
      ? Number(observation.brightness)
      : null,
    motion: observation.motion ?? null,
    note: observation.note ?? ""
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

function parseJsonObject(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function updateSliderLabels() {
  ui.speedValue.textContent = getSpeedSetting().toFixed(2);
  ui.durationValue.textContent = `${getDurationSetting()} ms`;
}

function getDefaultLocalVisionWidgetSize() {
  return globalThis.matchMedia?.("(max-width: 560px)")?.matches ? 100 : 120;
}

function loadLocalVisionWidgetSize() {
  let storedValue = null;

  try {
    storedValue = globalThis.localStorage?.getItem?.(LOCAL_VISION_SIZE_STORAGE_KEY) ?? null;
  } catch {
    storedValue = null;
  }

  return normalizeLocalVisionWidgetSize(storedValue ?? getDefaultLocalVisionWidgetSize());
}

function normalizeLocalVisionWidgetSize(value) {
  const rawSize = clampNumber(
    value,
    LOCAL_VISION_SIZE_MIN,
    LOCAL_VISION_SIZE_MAX,
    getDefaultLocalVisionWidgetSize()
  );
  return Math.round(rawSize / LOCAL_VISION_SIZE_STEP) * LOCAL_VISION_SIZE_STEP;
}

function applyLocalVisionWidgetSize(value, { persist = true } = {}) {
  localVisionWidgetSizePx = normalizeLocalVisionWidgetSize(value);
  document.documentElement.style.setProperty(
    "--local-vision-widget-width",
    `${localVisionWidgetSizePx}px`
  );

  if (ui.localVisionSizeSlider) {
    ui.localVisionSizeSlider.value = String(localVisionWidgetSizePx);
  }
  if (ui.localVisionSizeValue) {
    ui.localVisionSizeValue.textContent = `${localVisionWidgetSizePx}px`;
  }

  if (persist) {
    try {
      globalThis.localStorage?.setItem?.(
        LOCAL_VISION_SIZE_STORAGE_KEY,
        String(localVisionWidgetSizePx)
      );
    } catch {
      // Storage can be blocked in some mobile browser modes; the size still applies this session.
    }
  }
}

function loadFollowTuningSettings() {
  try {
    const stored = globalThis.localStorage?.getItem?.(FOLLOW_TUNING_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const normalized = normalizeStoredFollowTuning(JSON.parse(stored));
    return findMatchingFollowPresetId(normalized) ? normalized : {};
  } catch {
    return {};
  }
}

function saveFollowTuningSettings(settings = {}) {
  try {
    globalThis.localStorage?.setItem?.(
      FOLLOW_TUNING_STORAGE_KEY,
      JSON.stringify(normalizeStoredFollowTuning(settings))
    );
  } catch {
    // Tuning still applies for this session if browser storage is blocked.
  }
}

function findMatchingFollowPresetId(settings = brainPolicy) {
  const normalized = normalizeStoredFollowTuning(settings);
  return Object.entries(FOLLOW_TUNING_PRESETS).find(([, preset]) => (
    nearlyEqual(normalized.maxObjectFollowSpeed, preset.maxObjectFollowSpeed, 0.0005) &&
    Number(normalized.followCommandDurationMs) === Number(preset.followCommandDurationMs) &&
    Number(normalized.followCommandRefreshMs) === Number(preset.followCommandRefreshMs) &&
    nearlyEqual(normalized.followCenterDeadband, preset.followCenterDeadband, 0.0005) &&
    Number(normalized.followMaxDetectionAgeMs) === Number(preset.followMaxDetectionAgeMs)
  ))?.[0] ?? null;
}

function normalizeStoredFollowTuning(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const normalized = {};

  if (Number.isFinite(Number(source.maxObjectFollowSpeed))) {
    normalized.maxObjectFollowSpeed = clampNumber(source.maxObjectFollowSpeed, 0, 0.25, FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].maxObjectFollowSpeed);
  }
  if (Number.isFinite(Number(source.followTargetCenterX))) {
    normalized.followTargetCenterX = clampNumber(source.followTargetCenterX, 0.25, 0.75, 0.5);
  }
  if (Number.isFinite(Number(source.followCenterDeadband))) {
    normalized.followCenterDeadband = clampNumber(source.followCenterDeadband, 0.005, 0.2, FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCenterDeadband);
  }
  if (Number.isFinite(Number(source.followCommandDurationMs))) {
    normalized.followCommandDurationMs = Math.round(clampNumber(source.followCommandDurationMs, 0, 600, FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCommandDurationMs));
  }
  if (Number.isFinite(Number(source.followCommandRefreshMs))) {
    normalized.followCommandRefreshMs = Math.round(clampNumber(source.followCommandRefreshMs, 0, 300, FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followCommandRefreshMs));
  }
  normalized.followMaxDetectionAgeMs = Math.round(clampNumber(
    source.followMaxDetectionAgeMs,
    40,
    3000,
    FOLLOW_TUNING_PRESETS[DEFAULT_FOLLOW_TUNING_PRESET].followMaxDetectionAgeMs
  ));

  return normalized;
}

function nearlyEqual(a, b, epsilon = 0.0001) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function setInputValue(element, value) {
  if (!element || document.activeElement === element) {
    return;
  }

  element.value = String(value);
}

function getSpeedSetting() {
  const maxSpeed = activeConfig.maxSpeed ?? PUBLIC_CONFIG.maxSpeed;
  return clampNumber(ui.speedSlider.value, 0.05, maxSpeed, DEFAULT_SPEED);
}

function getDurationSetting() {
  const maxDuration = activeConfig.maxDurationMs ?? PUBLIC_CONFIG.maxDurationMs;
  return clampNumber(ui.durationSlider.value, 100, maxDuration, DEFAULT_DURATION_MS);
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatFollowValue(value, digits = 2) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : "--";
}

function formatSignedFollowValue(value, digits = 2) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "--";
  }

  return `${numericValue >= 0 ? "+" : ""}${numericValue.toFixed(digits)}`;
}

function formatRoboflowGpuPlan(value) {
  const plan = String(value || "").trim();
  if (!plan) {
    return "--";
  }

  const labels = {
    "webrtc-gpu-small": "Small GPU",
    "webrtc-gpu-medium": "Medium GPU",
    "webrtc-gpu-large": "Large GPU"
  };
  return labels[plan] ?? plan;
}

function setSelectValue(select, value, label = value) {
  if (!select || !value) {
    return;
  }

  const exists = [...select.options].some((option) => option.value === value);
  if (!exists) {
    select.append(new Option(label, value));
  }
  select.value = value;
}

function syncSelectOptions(select, values = [], currentValue = "") {
  if (!select) {
    return;
  }

  const previousValue = select.value;
  const nextValues = [...new Set([currentValue, ...(Array.isArray(values) ? values : [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  nextValues.forEach((value) => {
    const exists = [...select.options].some((option) => option.value === value);
    if (!exists) {
      select.append(new Option(value, value));
    }
  });

  if (previousValue && nextValues.includes(previousValue)) {
    select.value = previousValue;
  } else if (currentValue) {
    select.value = currentValue;
  }
}

function formatMaybe(value, formatter = String) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return formatter(value);
}

function waitMs(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function log(message, level = "info") {
  if (shouldSuppressLogMessage(message, level)) {
    return false;
  }

  const signature = `${level}:${message}`;

  if (signature === lastLogSignature) {
    return false;
  }

  lastLogSignature = signature;

  appendLogEntry(message, level);
  return true;
}

function appendLogEntry(message, level = "info") {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();

  entry.className = `log-entry log-entry--${level}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-text"></span>`;
  entry.querySelector(".log-text").textContent = message;

  ui.logPanel.append(entry);
  ui.logPanel.scrollTop = ui.logPanel.scrollHeight;
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method]?.(`[LOOI] ${message}`);
}

function traceLive(label, payload = {}, level = "info") {
  const compact = compactTracePayload(payload);
  const message = `[TRACE] ${label}: ${formatTracePayload(compact)}`;
  if (log(message, level)) {
    console.debug?.(`[LOOI TRACE] ${label}`, compact);
  }
}

function traceBrainThoughtResult(event = {}) {
  const payload = event.payload ?? {};
  const thought = payload.thought ?? {};
  const response = payload.response ?? thought.response ?? {};
  const results = payload.results ?? thought.results ?? [];
  const action = response.action ?? thought.action ?? null;

  traceLive("STEP 2 BRAIN", {
    reason: thought.reason ?? response.reason,
    provider: payload.provider ?? thought.provider,
    latencyMs: payload.latencyMs ?? thought.latencyMs,
    text: response.text ?? thought.text,
    action: action ? summarizeActions([action])[0] : null,
    results: summarizeResults(results),
    fallbackUsed: payload.fallbackUsed ?? thought.fallbackUsed,
    error: payload.error ?? thought.error
  }, payload.error ? "warn" : "info");
}

function traceSequenceEvent(event = {}) {
  const payload = event.payload ?? {};
  const sequenceName = payload.sequence ?? payload.name;
  const reason = payload.reason ?? payload.result?.reason;

  traceLive(`STEP 4 SEQUENCE ${event.type ?? "event"}`, {
    sequence: sequenceName,
    reason,
    source: payload.source,
    result: payload.result
      ? {
          ok: payload.result.ok,
          executed: payload.result.executed,
          partial: payload.result.partial,
          skippedFrames: payload.result.skippedFrames,
          reason: payload.result.reason
        }
      : null
  });
}

function shouldSuppressLogMessage(message, level = "info") {
  if (level === "error" || level === "warn") {
    return false;
  }

  return false;
}

function summarizeActions(actions = []) {
  return Array.isArray(actions)
    ? actions.map((action) => ({
        type: action?.type,
        args: action?.args ?? {}
      }))
    : [];
}

function summarizeResults(results = []) {
  return Array.isArray(results)
    ? results.map((result) => ({
        type: result?.type,
        status: result?.status,
        executed: result?.executed,
        physical: result?.physical,
        message: result?.message
      }))
    : [];
}

function compactTracePayload(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 6).map(compactTracePayload);
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, compactTracePayload(entryValue)])
  );
}

function formatTracePayload(payload) {
  if (payload === null || payload === undefined) {
    return String(payload);
  }

  if (typeof payload === "string") {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return String(payload);
  }
}
