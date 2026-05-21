import { PUBLIC_CONFIG } from "./config.js";
import { LocalEventBus } from "./core/localEventBus.js";
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
import { SpeechInput } from "./perception/speech.js";
import { AudioLevelMonitor } from "./perception/audioLevelMonitor.js";
import { SpeechGate } from "./perception/speechGate.js";
import { VoiceOutput } from "./perception/voiceOutput.js";
import { LifeEventEmitter } from "./personality/lifeEvents.js";
import { describePersonalityForRuntime } from "./personality/personalityProfile.js";
import { PersonalityTuning } from "./personality/personalityTuning.js";
import { BodyCalibration } from "./robot/bodyCalibration.js";
import { CommandQueue } from "./robot/commandQueue.js";
import { ESP32Client } from "./robot/esp32Client.js";
import { SimulatedESP32Client } from "./robot/simulatedEsp32Client.js";
import { ToolExecutor } from "./robot/toolExecutor.js";
import { PerformanceMonitor } from "./runtime/performanceMonitor.js";
import { ReliabilityManager } from "./runtime/reliabilityManager.js";
import { WakeLockManager } from "./runtime/wakeLockManager.js";
import { createFaceController } from "./ui/faceCanvas.js";
import {
  DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
  DEFAULT_OBJECT_DETECTOR_MODEL_PRESET,
  DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD,
  OBJECT_DETECTOR_MODEL_PRESETS,
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
const LOCAL_VISION_SIZE_MIN = 70;
const LOCAL_VISION_SIZE_MAX = 220;
const LOCAL_VISION_SIZE_STEP = 10;
const SPEECH_FINAL_ONLY_STORAGE_KEY = "looi.useFinalSpeechOnly.v1";
const INTERIM_STABILITY_MS = 300;

const ui = {
  canvas: document.getElementById("faceCanvas"),
  runtimeGate: document.getElementById("runtimeGate"),
  productionStartButton: document.getElementById("productionStartButton"),
  productionStopButton: document.getElementById("productionStopButton"),
  localBrainQuickButton: document.getElementById("localBrainQuickButton"),
  settingsToggleButton: document.getElementById("settingsToggleButton"),
  settingsCloseButton: document.getElementById("settingsCloseButton"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsPanel: document.getElementById("settingsPanel"),
  localVisionPreview: document.getElementById("localVisionPreview"),
  localVisionOverlay: document.getElementById("localVisionOverlay"),
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
  simulatorToggle: document.getElementById("simulatorToggle"),
  simulatorState: document.getElementById("simulatorState"),
  simulatorNote: document.getElementById("simulatorNote"),
  calibrationArmButton: document.getElementById("calibrationArmButton"),
  calibrationArmState: document.getElementById("calibrationArmState"),
  calibrationMaxSpeed: document.getElementById("calibrationMaxSpeed"),
  calibrationGentleSpeed: document.getElementById("calibrationGentleSpeed"),
  calibrationTurnSpeed: document.getElementById("calibrationTurnSpeed"),
  calibrationWiggleSpeed: document.getElementById("calibrationWiggleSpeed"),
  calibrationRampMs: document.getElementById("calibrationRampMs"),
  calibrationLeftTrim: document.getElementById("calibrationLeftTrim"),
  calibrationRightTrim: document.getElementById("calibrationRightTrim"),
  calibrationDeadband: document.getElementById("calibrationDeadband"),
  calibrationMinPwm: document.getElementById("calibrationMinPwm"),
  calibrationMotionIntensityScale: document.getElementById("calibrationMotionIntensityScale"),
  calibrationIdleMotionEnabled: document.getElementById("calibrationIdleMotionEnabled"),
  applyCalibrationButton: document.getElementById("applyCalibrationButton"),
  saveCalibrationButton: document.getElementById("saveCalibrationButton"),
  resetCalibrationButton: document.getElementById("resetCalibrationButton"),
  requestRobotConfigButton: document.getElementById("requestRobotConfigButton"),
  calibrationTestStopButton: document.getElementById("calibrationTestStopButton"),
  calibrationTestForwardButton: document.getElementById("calibrationTestForwardButton"),
  calibrationTestBackwardButton: document.getElementById("calibrationTestBackwardButton"),
  calibrationTestRotateLeftButton: document.getElementById("calibrationTestRotateLeftButton"),
  calibrationTestRotateRightButton: document.getElementById("calibrationTestRotateRightButton"),
  calibrationTestWiggleButton: document.getElementById("calibrationTestWiggleButton"),
  calibrationTestApproachButton: document.getElementById("calibrationTestApproachButton"),
  calibrationTestRetreatButton: document.getElementById("calibrationTestRetreatButton"),
  robotConfigDisplay: document.getElementById("robotConfigDisplay"),
  recentCommandHistory: document.getElementById("recentCommandHistory"),
  motionDebugDisplay: document.getElementById("motionDebugDisplay"),
  speechSupportState: document.getElementById("speechSupportState"),
  speechSecureWarning: document.getElementById("speechSecureWarning"),
  startListeningButton: document.getElementById("startListeningButton"),
  stopListeningButton: document.getElementById("stopListeningButton"),
  continuousListeningToggle: document.getElementById("continuousListeningToggle"),
  speechLanguageInput: document.getElementById("speechLanguageInput"),
  interimTranscript: document.getElementById("interimTranscript"),
  finalTranscript: document.getElementById("finalTranscript"),
  earsInterimTranscript: document.getElementById("earsInterimTranscript"),
  voiceSupportState: document.getElementById("voiceSupportState"),
  muteSpeechToggle: document.getElementById("muteSpeechToggle"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceRateSlider: document.getElementById("voiceRateSlider"),
  voicePitchSlider: document.getElementById("voicePitchSlider"),
  speakTestButton: document.getElementById("speakTestButton"),
  lastRobotEventPosted: document.getElementById("lastRobotEventPosted"),
  robotEventPostStatus: document.getElementById("robotEventPostStatus"),
  alwaysListeningToggle: document.getElementById("alwaysListeningToggle"),
  useFinalSpeechOnlyToggle: document.getElementById("useFinalSpeechOnlyToggle"),
  earsState: document.getElementById("earsState"),
  speechGateState: document.getElementById("speechGateState"),
  attentionModeState: document.getElementById("attentionModeState"),
  attentionWindowRemaining: document.getElementById("attentionWindowRemaining"),
  lastSpeechClassification: document.getElementById("lastSpeechClassification"),
  lastAcceptedTranscript: document.getElementById("lastAcceptedTranscript"),
  lastIgnoredTranscript: document.getElementById("lastIgnoredTranscript"),
  speechRecognitionSupportDetail: document.getElementById("speechRecognitionSupportDetail"),
  speechRecognitionStateDetail: document.getElementById("speechRecognitionStateDetail"),
  speechRecognitionAttemptCount: document.getElementById("speechRecognitionAttemptCount"),
  speechRecognitionResultCount: document.getElementById("speechRecognitionResultCount"),
  speechRecognitionLastResult: document.getElementById("speechRecognitionLastResult"),
  speechRecognitionLastError: document.getElementById("speechRecognitionLastError"),
  speechRecognitionDebugLog: document.getElementById("speechRecognitionDebugLog"),
  wakeNamesInput: document.getElementById("wakeNamesInput"),
  saveWakeNamesButton: document.getElementById("saveWakeNamesButton"),
  audioLevelMonitorToggle: document.getElementById("audioLevelMonitorToggle"),
  audioLevelDisplay: document.getElementById("audioLevelDisplay"),
  voiceActivityState: document.getElementById("voiceActivityState"),
  cameraSupportState: document.getElementById("cameraSupportState"),
  cameraSecureWarning: document.getElementById("cameraSecureWarning"),
  cameraRunningState: document.getElementById("cameraRunningState"),
  cameraFacingMode: document.getElementById("cameraFacingMode"),
  cameraLastError: document.getElementById("cameraLastError"),
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
  objectDetectorModelSelect: document.getElementById("objectDetectorModelSelect"),
  objectDetectionIntervalSlider: document.getElementById("objectDetectionIntervalSlider"),
  objectDetectionIntervalValue: document.getElementById("objectDetectionIntervalValue"),
  objectScoreThresholdSlider: document.getElementById("objectScoreThresholdSlider"),
  objectScoreThresholdValue: document.getElementById("objectScoreThresholdValue"),
  objectMaxResultsInput: document.getElementById("objectMaxResultsInput"),
  objectCategoryAllowlistInput: document.getElementById("objectCategoryAllowlistInput"),
  objectDetectorState: document.getElementById("objectDetectorState"),
  objectDetectorModel: document.getElementById("objectDetectorModel"),
  objectDetectorQuality: document.getElementById("objectDetectorQuality"),
  objectDetectorParams: document.getElementById("objectDetectorParams"),
  objectDetectionLastRun: document.getElementById("objectDetectionLastRun"),
  objectDetectionMetadataCount: document.getElementById("objectDetectionMetadataCount"),
  objectDetectionError: document.getElementById("objectDetectionError"),
  visibleObjectLabels: document.getElementById("visibleObjectLabels"),
  visionMetadataPreview: document.getElementById("visionMetadataPreview"),
  followTargetLabelInput: document.getElementById("followTargetLabelInput"),
  setFollowTargetButton: document.getElementById("setFollowTargetButton"),
  stopFollowingButton: document.getElementById("stopFollowingButton"),
  activeFollowTarget: document.getElementById("activeFollowTarget"),
  followScenarioState: document.getElementById("followScenarioState"),
  followControllerState: document.getElementById("followControllerState"),
  followModeArmedToggle: document.getElementById("followModeArmedToggle"),
  allowFollowMovementToggle: document.getElementById("allowFollowMovementToggle"),
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
  localBrainEnabledToggle: document.getElementById("localBrainEnabledToggle"),
  localMotionArmedToggle: document.getElementById("localMotionArmedToggle"),
  localCameraAllowedToggle: document.getElementById("localCameraAllowedToggle"),
  localSpeechAllowedToggle: document.getElementById("localSpeechAllowedToggle"),
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
  connectionState: document.getElementById("connectionState"),
  telemetryRssi: document.getElementById("telemetryRssi"),
  telemetryClients: document.getElementById("telemetryClients"),
  telemetryMotorState: document.getElementById("telemetryMotorState"),
  telemetryLeftSpeed: document.getElementById("telemetryLeftSpeed"),
  telemetryRightSpeed: document.getElementById("telemetryRightSpeed"),
  telemetryMotionRemaining: document.getElementById("telemetryMotionRemaining"),
  telemetryLastCommandAge: document.getElementById("telemetryLastCommandAge"),
  lifeEngineToggle: document.getElementById("lifeEngineToggle"),
  simulateAttentionButton: document.getElementById("simulateAttentionButton"),
  simulateObstacleButton: document.getElementById("simulateObstacleButton"),
  simulateBoredomButton: document.getElementById("simulateBoredomButton"),
  simulateLowEnergyButton: document.getElementById("simulateLowEnergyButton"),
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
  scenarioRuntimeStopButton: document.getElementById("scenarioRuntimeStopButton"),
  scenarioBoredButton: document.getElementById("scenarioBoredButton"),
  scenarioLowEnergyButton: document.getElementById("scenarioLowEnergyButton"),
  scenarioObstacleButton: document.getElementById("scenarioObstacleButton"),
  scenarioClearObstacleButton: document.getElementById("scenarioClearObstacleButton"),
  currentSequenceState: document.getElementById("currentSequenceState"),
  sequenceHistoryList: document.getElementById("sequenceHistoryList"),
  schedulerState: document.getElementById("schedulerState"),
  currentPriorityTask: document.getElementById("currentPriorityTask"),
  looiModeToggle: document.getElementById("looiModeToggle"),
  keepRobotAwakeToggle: document.getElementById("keepRobotAwakeToggle"),
  scenarioStopButton: document.getElementById("scenarioStopButton"),
  runSimulatorLooiDemoButton: document.getElementById("runSimulatorLooiDemoButton"),
  runWheelsLiftedSafetyTestButton: document.getElementById("runWheelsLiftedSafetyTestButton"),
  fpsDisplay: document.getElementById("fpsDisplay"),
  performanceModeDisplay: document.getElementById("performanceModeDisplay"),
  wakeLockState: document.getElementById("wakeLockState"),
  reliabilityModeDisplay: document.getElementById("reliabilityModeDisplay"),
  runtimeWarningsList: document.getElementById("runtimeWarningsList")
};

let face = null;
let robotClient = null;
let realRobotClient = null;
let simulatedRobotClient = null;
let commandQueue = null;
let lifeEngine = null;
let localEventBus = null;
let localBrainEngine = null;
let localServerBrainAdapter = null;
let speechGate = null;
let attentionSystem = null;
let audioLevelMonitor = null;
let brainLatencyBudget = null;
let scenarioFrameSequencer = null;
let priorityScheduler = null;
let embodiedActionRouter = null;
let wakeLockManager = null;
let performanceMonitor = null;
let reliabilityManager = null;
let speechInput = null;
let voiceOutput = null;
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
let simulatorMode = false;
let brainPolicy = createDefaultBrainPolicy();
let calibrationTestArmed = false;
let latestActionResult = null;
let lastTranscript = null;
let lastEventPosted = null;
let lastObservationEventAt = 0;
let lastObservationSignature = "";
let recentObjectReference = null;
let geminiVisionAssistEnabled = true;
let geminiVisionAssistIntervalMs = 1500;
let geminiVisionAssistTimer = null;
let geminiVisionAssistLastFrameAt = 0;
let geminiVisionAssistSending = false;
let learnedPhraseCache = [];
let lifeEventsEnabled = false;
let settingsOpen = false;
let audioActivityClearTimer = null;
let interimSpeechTimer = null;
let poseScenarioLastRun = new Map();
let latestInterimSpeech = null;
let bestInterimSpeech = null;
let lastInterimDispatchedText = "";
let lastInterimDispatchedAt = 0;
let useFinalSpeechOnly = loadUseFinalSpeechOnly();
let looiModeEnabled = false;
let keepRobotAwakeEnabled = false;
let localVisionWidgetSizePx = loadLocalVisionWidgetSize();
let lastLogSignature = "";

face = createFaceController(ui.canvas);
applyLocalVisionWidgetSize(localVisionWidgetSizePx, { persist: false });
if (ui.useFinalSpeechOnlyToggle) {
  ui.useFinalSpeechOnlyToggle.checked = useFinalSpeechOnly;
}
renderTelemetry(null);
updateSliderLabels();
updateSimulatorUi();
updateLocalBrainUi();
updateVoiceUi();
updateAlwaysListeningUi();
updateEmbodimentUi();
updateCameraUi();
updateCalibrationUi();
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

ui.simulatorToggle.addEventListener("click", () => {
  toggleSimulatorMode().catch((error) => {
    log(`Simulator toggle failed: ${error.message}`, "error");
  });
});

ui.calibrationArmButton.addEventListener("click", () => {
  calibrationTestArmed = !calibrationTestArmed;
  updateCalibrationUi();
  log(
    calibrationTestArmed
      ? "Calibration Test armed. Lift wheels and keep Emergency Stop ready."
      : "Calibration Test disarmed.",
    calibrationTestArmed ? "warn" : "info"
  );
});

bindCalibrationInput(ui.calibrationMaxSpeed, "maxSpeed");
bindCalibrationInput(ui.calibrationGentleSpeed, "gentleSpeed");
bindCalibrationInput(ui.calibrationTurnSpeed, "turnSpeed");
bindCalibrationInput(ui.calibrationWiggleSpeed, "wiggleSpeed");
bindCalibrationInput(ui.calibrationRampMs, "rampMs");
bindCalibrationInput(ui.calibrationLeftTrim, "leftTrim");
bindCalibrationInput(ui.calibrationRightTrim, "rightTrim");
bindCalibrationInput(ui.calibrationDeadband, "deadband");
bindCalibrationInput(ui.calibrationMinPwm, "minPwm");
bindCalibrationInput(ui.calibrationMotionIntensityScale, "motionIntensityScale");
ui.calibrationIdleMotionEnabled.addEventListener("change", () => {
  bodyCalibration?.patchSettings({
    idleMotionEnabled: ui.calibrationIdleMotionEnabled.checked
  });
});

ui.applyCalibrationButton.addEventListener("click", () => {
  applyCalibrationToRobot().catch((error) => {
    log(`Calibration apply failed: ${error.message}`, "error");
  });
});

ui.saveCalibrationButton.addEventListener("click", () => {
  if (!bodyCalibration) {
    return;
  }

  bodyCalibration.save();
  log("Body calibration saved locally.");
});

ui.resetCalibrationButton.addEventListener("click", () => {
  bodyCalibration?.resetDefaults();
  updateCalibrationUi();
  log("Body calibration reset to safe defaults.", "warn");
});

ui.requestRobotConfigButton.addEventListener("click", () => {
  requestRobotConfig();
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

ui.calibrationTestStopButton.addEventListener("click", async () => {
  await immediateStop("calibration_test_stop", "Calibration stop sent.", "warn");
});

ui.calibrationTestForwardButton.addEventListener("click", () => {
  runCalibrationMotionTest({ linear: 1, angular: 0, label: "calibration_forward_tiny" });
});

ui.calibrationTestBackwardButton.addEventListener("click", () => {
  runCalibrationMotionTest({ linear: -1, angular: 0, label: "calibration_backward_tiny" });
});

ui.calibrationTestRotateLeftButton.addEventListener("click", () => {
  runCalibrationMotionTest({ linear: 0, angular: -1, label: "calibration_rotate_left_tiny" });
});

ui.calibrationTestRotateRightButton.addEventListener("click", () => {
  runCalibrationMotionTest({ linear: 0, angular: 1, label: "calibration_rotate_right_tiny" });
});

ui.calibrationTestWiggleButton.addEventListener("click", () => {
  runCalibrationScenarioTest("body_talking");
});

ui.calibrationTestApproachButton.addEventListener("click", () => {
  runCalibrationScenarioTest("come_closer");
});

ui.calibrationTestRetreatButton.addEventListener("click", () => {
  runCalibrationScenarioTest("back_up");
});

ui.localBrainEnabledToggle.addEventListener("change", () => {
  patchBrainPolicy({ localBrainEnabled: ui.localBrainEnabledToggle.checked });
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

ui.localCameraAllowedToggle.addEventListener("change", () => {
  patchBrainPolicy({ localCameraAllowed: ui.localCameraAllowedToggle.checked });
  log(
    brainPolicy.localCameraAllowed
      ? "Local Camera allowed for Local Brain camera actions."
      : "Local Camera blocked for Local Brain camera actions.",
    brainPolicy.localCameraAllowed ? "warn" : "info"
  );
});

ui.localSpeechAllowedToggle.addEventListener("change", () => {
  patchBrainPolicy({ localSpeechAllowed: ui.localSpeechAllowedToggle.checked });
});

ui.followModeArmedToggle?.addEventListener("change", () => {
  patchBrainPolicy({ followModeArmed: ui.followModeArmedToggle.checked });
  log(
    brainPolicy.followModeArmed
      ? "Follow Mode armed. Follow movement still requires Local Motion and Allow Follow Movement."
      : "Follow Mode disarmed."
  );
});

ui.allowFollowMovementToggle?.addEventListener("change", () => {
  patchBrainPolicy({ allowFollowMovement: ui.allowFollowMovementToggle.checked });
  log(
    brainPolicy.allowFollowMovement
      ? "Follow Movement allowed while follow mode and local motion are armed."
      : "Follow Movement disabled."
  );
});

ui.geminiVisionAssistToggle?.addEventListener("change", () => {
  geminiVisionAssistEnabled = Boolean(ui.geminiVisionAssistToggle.checked);
  syncGeminiVisionAssist("toggle");
  log(
    geminiVisionAssistEnabled
      ? "Gemini Live Vision enabled for normal conversation. It pauses during MediaPipe follow."
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
  cameraInput?.switchCamera?.().then(handleCameraCommandResult).catch((error) => {
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

ui.startListeningButton.addEventListener("click", () => {
  if (!speechInput) {
    log("Speech input is still initializing.", "warn");
    return;
  }

  speechInput.setLanguage(ui.speechLanguageInput.value.trim() || "en-US");
  if (ui.alwaysListeningToggle.checked) {
    ui.continuousListeningToggle.checked = true;
    speechInput.startAlwaysListening();
  } else {
    speechInput.setContinuous(ui.continuousListeningToggle.checked);
    speechInput.start();
  }
  updateAlwaysListeningUi();
});

ui.stopListeningButton.addEventListener("click", () => {
  speechInput?.stop();
  ui.alwaysListeningToggle.checked = false;
  updateAlwaysListeningUi();
});

ui.continuousListeningToggle.addEventListener("change", () => {
  speechInput?.setContinuous(ui.continuousListeningToggle.checked);
  updateVoiceUi();
  updateAlwaysListeningUi();
});

ui.speechLanguageInput.addEventListener("change", () => {
  speechInput?.setLanguage(ui.speechLanguageInput.value.trim() || "en-US");
  updateVoiceUi();
  updateAlwaysListeningUi();
});

ui.alwaysListeningToggle.addEventListener("change", () => {
  if (!speechInput) {
    ui.alwaysListeningToggle.checked = false;
    log("Speech input is still initializing.", "warn");
    return;
  }

  speechInput.setLanguage(ui.speechLanguageInput.value.trim() || "en-US");
  ui.continuousListeningToggle.checked = ui.alwaysListeningToggle.checked || ui.continuousListeningToggle.checked;
  speechInput.setAlwaysListening(ui.alwaysListeningToggle.checked);
  updateAlwaysListeningUi();
});

ui.saveWakeNamesButton.addEventListener("click", () => {
  const names = parseWakeNames(ui.wakeNamesInput.value);
  speechGate?.setRobotNames?.(names);
  ui.wakeNamesInput.value = names.join(",");
  updateAlwaysListeningUi();
  log(`Wake names saved: ${names.join(", ")}`);
});

ui.audioLevelMonitorToggle.addEventListener("change", () => {
  setAudioLevelMonitorEnabled(ui.audioLevelMonitorToggle.checked).catch((error) => {
    ui.audioLevelMonitorToggle.checked = false;
    log(`Audio activity monitor failed: ${error.message}`, "warn");
    updateAlwaysListeningUi();
  });
});

ui.useFinalSpeechOnlyToggle?.addEventListener("change", () => {
  useFinalSpeechOnly = Boolean(ui.useFinalSpeechOnlyToggle.checked);
  globalThis.localStorage?.setItem?.(SPEECH_FINAL_ONLY_STORAGE_KEY, String(useFinalSpeechOnly));
  clearPendingInterimSpeech();
  log(
    useFinalSpeechOnly
      ? "Speech mode: final transcript only."
      : "Speech mode: stable interim transcript after 300ms."
  );
});

ui.muteSpeechToggle.addEventListener("change", () => {
  voiceOutput?.setMuted(ui.muteSpeechToggle.checked);
  updateVoiceUi();
});

ui.voiceSelect.addEventListener("change", () => {
  voiceOutput?.setVoiceByName(ui.voiceSelect.value);
});

ui.voiceRateSlider.addEventListener("input", () => {
  voiceOutput?.setRate(ui.voiceRateSlider.value);
});

ui.voicePitchSlider.addEventListener("input", () => {
  voiceOutput?.setPitch(ui.voicePitchSlider.value);
});

ui.speakTestButton.addEventListener("click", () => {
  voiceOutput?.speak({
    text: "I can hear you from the phone.",
    tone: "happy",
    interrupt: true
  });
});

ui.connectEsp32Button.addEventListener("click", async () => {
  if (!robotClient) {
    log("Robot client is still initializing.", "warn");
    return;
  }

  const nextUrl = ui.esp32UrlInput.value.trim() || activeConfig.defaultEsp32WsUrl;

  try {
    if (simulatorMode) {
      await robotClient.connect();
      await applyCalibrationToRobot({ quiet: true });
      log("Simulator connected from Connect button.");
    } else {
      await realRobotClient.connect(nextUrl);
      ui.esp32UrlInput.value = nextUrl;
      await applyCalibrationToRobot({ quiet: true });
    }
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
    await commandQueue.stopMotion?.(simulatorMode ? "simulator_disconnect" : "ui_disconnect");
  }

  robotClient.disconnect();
  lifeEngine?.setConnectionState("disconnected");
  renderTelemetry({});
  updateSimulatorUi();
  log(simulatorMode ? "Simulator disconnect requested." : "ESP32 disconnect requested.");
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
    log(simulatorMode ? "Ping sent to simulator." : "Ping sent to ESP32.");
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

ui.simulateAttentionButton.addEventListener("click", () => {
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "simulated attention"
  });
  requestPoseScenario("pose_attentive");
  log("Simulated user attention.");
});

ui.simulateObstacleButton.addEventListener("click", () => {
  if (!lifeEngine) {
    return;
  }

  const nextObstacleState = !lifeEngine.getState().obstacle;
  lifeEngine.receiveEvent({
    type: "obstacle",
    value: nextObstacleState
  });
  log(`Obstacle simulation ${nextObstacleState ? "enabled" : "cleared"}.`, "warn");
});

ui.simulateBoredomButton.addEventListener("click", () => {
  lifeEngine?.patchState?.({ boredom: 0.9, curiosity: 0.85, mood: "curious" }, "ui_simulate_boredom");
  requestPoseScenario("pose_curious");
  log("Simulated boredom state.");
});

ui.simulateLowEnergyButton.addEventListener("click", () => {
  lifeEngine?.patchState?.({ energy: 0.15, mood: "sleepy" }, "ui_simulate_low_energy");
  requestPoseScenario("pose_sleepy");
  log("Simulated low energy state.");
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

ui.looiModeToggle?.addEventListener("change", () => {
  looiModeEnabled = ui.looiModeToggle.checked;
  if (looiModeEnabled) {
    reliabilityManager?.start?.();
  } else {
    reliabilityManager?.stop?.();
  }
  updateEmbodimentUi();
  log(looiModeEnabled ? "Scenario runtime enabled. Motion safety gates are unchanged." : "Scenario runtime disabled.");
});

ui.keepRobotAwakeToggle?.addEventListener("change", () => {
  keepRobotAwakeEnabled = ui.keepRobotAwakeToggle.checked;
  const task = keepRobotAwakeEnabled ? wakeLockManager?.request?.() : wakeLockManager?.release?.();
  task?.catch?.((error) => {
    ui.keepRobotAwakeToggle.checked = false;
    keepRobotAwakeEnabled = false;
    log(`Wake lock failed: ${error.message}`, "warn");
    updateEmbodimentUi();
  });
  updateEmbodimentUi();
});

ui.scenarioRuntimeStopButton?.addEventListener("click", async () => {
  await immediateStop("scenario_panel_stop", "Scenario stop sent.", "warn");
});

ui.runSimulatorLooiDemoButton?.addEventListener("click", () => {
  simulatorDemoRoutine().catch((error) => log(`Simulator LOOI demo failed: ${error.message}`, "warn"));
});

ui.runWheelsLiftedSafetyTestButton?.addEventListener("click", () => {
  wheelsLiftedSafetyRoutine().catch((error) => log(`Wheels-lifted test failed: ${error.message}`, "warn"));
});

ui.speedSlider.addEventListener("input", updateSliderLabels);
ui.durationSlider.addEventListener("input", updateSliderLabels);
ui.localVisionSizeSlider?.addEventListener("input", () => {
  applyLocalVisionWidgetSize(ui.localVisionSizeSlider.value);
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult?.detections ?? []);
});
globalThis.addEventListener?.("resize", () => {
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult?.detections ?? []);
});
ui.startObjectDetectionButton?.addEventListener("click", () => {
  startObjectDetectionFromUi().catch((error) => log(`Object detector start failed: ${error.message}`, "warn"));
});
ui.stopObjectDetectionButton?.addEventListener("click", () => {
  objectDetectorEngine?.stop?.();
  followTargetController?.stop?.("object_detector_stopped");
  updateVisionUi();
});
ui.objectDetectorModelSelect?.addEventListener("change", () => {
  const preset = ui.objectDetectorModelSelect.value || DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;
  const model = OBJECT_DETECTOR_MODEL_PRESETS[preset];
  if (!model || !objectDetectorEngine?.setModelAssetPath) {
    return;
  }
  objectDetectorEngine.setModelAssetPath(model.url, { modelPreset: preset, modelName: model.label })
    .then(updateVisionUi)
    .catch((error) => log(`Object detector model switch failed: ${error.message}`, "warn"));
});
ui.objectDetectionIntervalSlider?.addEventListener("input", () => {
  const value = Number(ui.objectDetectionIntervalSlider.value);
  objectDetectorEngine?.setDetectionIntervalMs?.(value);
  if (ui.objectDetectionIntervalValue) {
    ui.objectDetectionIntervalValue.textContent = `${Math.round(value)} ms`;
  }
  updateVisionUi();
});
ui.objectScoreThresholdSlider?.addEventListener("input", () => {
  const value = Number(ui.objectScoreThresholdSlider.value);
  objectDetectorEngine?.setScoreThreshold?.(value);
  if (ui.objectScoreThresholdValue) {
    ui.objectScoreThresholdValue.textContent = value.toFixed(2);
  }
  updateVisionUi();
});
ui.objectMaxResultsInput?.addEventListener("change", () => {
  objectDetectorEngine?.setMaxResults?.(Number(ui.objectMaxResultsInput.value));
  updateVisionUi();
});
ui.objectCategoryAllowlistInput?.addEventListener("change", () => {
  objectDetectorEngine?.setCategoryAllowlist?.(ui.objectCategoryAllowlistInput.value);
  updateVisionUi();
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
      sendFollowVisionContext("manual_follow_target", { force: true, allowStopped: !result.executed });
    });
});
ui.stopFollowingButton?.addEventListener("click", () => {
  visionScenarioManager?.stopFollowing?.("manual_stop_following");
  updateVisionUi();
  sendFollowVisionContext("manual_stop_following", { force: true, allowStopped: true });
});

init();

async function init() {
  activeConfig = await loadPublicConfig();
  brainPolicy = clampBrainPolicy({
    ...createDefaultBrainPolicy(),
    localBrainEnabled: activeConfig.localBrainDefaultEnabled ?? true,
    maxThoughtsPerMinute:
      activeConfig.localBrainMaxThoughtsPerMinute ??
      PUBLIC_CONFIG.localBrainMaxThoughtsPerMinute ??
      12,
    localVisionEnabled: activeConfig.localVisionEnabled ?? PUBLIC_CONFIG.localVisionEnabled ?? true,
    objectDetectionEnabledDefault:
      activeConfig.objectDetectionEnabledDefault ??
      PUBLIC_CONFIG.objectDetectionEnabledDefault ??
      false,
    objectDetectionIntervalMs:
      activeConfig.objectDetectionIntervalMs ??
      PUBLIC_CONFIG.objectDetectionIntervalMs ??
      1000,
    followModeArmed: false,
    allowFollowMovement: false,
    followLostTimeoutMs:
      activeConfig.followLostTimeoutMs ??
      PUBLIC_CONFIG.followLostTimeoutMs ??
      2000,
    maxObjectFollowSpeed:
      activeConfig.maxObjectFollowSpeed ??
      PUBLIC_CONFIG.maxObjectFollowSpeed ??
      0.18,
    eventThoughtCooldownMs:
      activeConfig.speechGateEventCooldownMs ??
      PUBLIC_CONFIG.speechGateEventCooldownMs ??
      createDefaultBrainPolicy().eventThoughtCooldownMs
  });
  const wakeNames = Array.isArray(activeConfig.wakeNamesDefault)
    ? activeConfig.wakeNamesDefault
    : PUBLIC_CONFIG.wakeNamesDefault;
  ui.wakeNamesInput.value = parseWakeNames(wakeNames).join(",");
  ui.alwaysListeningToggle.checked = Boolean(activeConfig.alwaysListeningDefault);
  ui.audioLevelMonitorToggle.checked = Boolean(activeConfig.audioLevelMonitorDefault);
  looiModeEnabled = Boolean(activeConfig.looiModeDefault);
  keepRobotAwakeEnabled = Boolean(activeConfig.keepRobotAwakeDefault);
  if (ui.looiModeToggle) ui.looiModeToggle.checked = looiModeEnabled;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = keepRobotAwakeEnabled;
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
  ["sequence_started", "sequence_result", "sequence_interrupted"].forEach((type) => {
    localEventBus.subscribe(type, () => updateEmbodimentUi());
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

  speechGate = new SpeechGate({
    robotNames: parseWakeNames(ui.wakeNamesInput.value),
    logger: (message, level = "info") => log(message, level),
    getContext: () => ({
      lifeState: lifeEngine?.getState?.() ?? {},
      attention: attentionSystem?.getStatus?.() ?? null,
      localPolicy: getPolicy(),
      speechStatus: speechInput?.getStatus?.() ?? null
    })
  });
  speechGate.attentionWindowMs =
    activeConfig.attentionWindowMs ??
    PUBLIC_CONFIG.attentionWindowMs ??
    speechGate.attentionWindowMs;
  speechGate.conversationWindowMs =
    activeConfig.conversationWindowMs ??
    PUBLIC_CONFIG.conversationWindowMs ??
    speechGate.conversationWindowMs;

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
    updateCalibrationUi(settings);
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

  realRobotClient = new ESP32Client({
    url: ui.esp32UrlInput.value,
    logger: (message, level = "info") => log(message, level)
  });
  registerRobotClientCallbacks(realRobotClient);
  realRobotClient
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

  robotClient = realRobotClient;
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

  voiceOutput = new VoiceOutput({
    face,
    lifeEngine,
    logger: (message, level = "info") => log(message, level)
  });
  voiceOutput.onStatus(updateVoiceUi);
  setupVoiceList();

  priorityScheduler = new PriorityScheduler({
    logger: (message, level = "info") => log(message, level)
  });
  scenarioFrameSequencer = new ScenarioFrameSequencer({
    face,
    voiceOutput,
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

  setupObjectDetectorModelOptions();
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
    modelPreset:
      activeConfig.objectDetectorModelPreset ??
      PUBLIC_CONFIG.objectDetectorModelPreset ??
      DEFAULT_OBJECT_DETECTOR_MODEL_PRESET,
    modelAssetPath:
      activeConfig.objectDetectorModelAssetPath ??
      PUBLIC_CONFIG.objectDetectorModelAssetPath,
    wasmBasePath:
      activeConfig.objectDetectorWasmBasePath ??
      PUBLIC_CONFIG.objectDetectorWasmBasePath,
    moduleUrl:
      activeConfig.objectDetectorModuleUrl ??
      PUBLIC_CONFIG.objectDetectorModuleUrl,
    scoreThreshold:
      activeConfig.objectDetectorScoreThreshold ??
      PUBLIC_CONFIG.objectDetectorScoreThreshold ??
      DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD,
    maxResults:
      activeConfig.objectDetectorMaxResults ??
      PUBLIC_CONFIG.objectDetectorMaxResults ??
      DEFAULT_OBJECT_DETECTOR_MAX_RESULTS,
    detectionIntervalMs: brainPolicy.objectDetectionIntervalMs,
    logger: (message, level = "info") => log(message, level)
  });
  objectDetectorEngine.onDetections(handleObjectDetections);
  objectDetectorEngine.onStatus((status) => {
    visionState?.setDetectorStatus?.(status);
    updateVisionUi();
    sendFollowVisionContext("detector_status");
  });
  objectDetectorEngine.onError((message) => {
    log(`Object detector error: ${message}`, "warn");
    updateVisionUi();
  });

  speechInput = new SpeechInput({
    language: ui.speechLanguageInput.value.trim() || "en-US",
    continuous: ui.continuousListeningToggle.checked,
    interimResults: true,
    logger: (message, level = "info") => log(message, level)
  });
  speechInput.onStatus(updateVoiceUi);
  speechInput.onInterim(handleInterimSpeech);
  speechInput.onFinal((payload) => {
    handleFinalSpeech(payload).catch((error) => {
      log(`Speech handling failed: ${error.message}`, "error");
    });
  });
  speechInput.onError(updateVoiceUi);

  audioLevelMonitor = new AudioLevelMonitor({
    logger: (message, level = "info") => log(message, level)
  });
  audioLevelMonitor.onLevel((payload) => {
    if (ui.audioLevelDisplay) {
      ui.audioLevelDisplay.textContent = `${Math.round(Number(payload.level || 0) * 100)}%`;
    }
  });
  audioLevelMonitor.onVoiceActivity(handleVoiceActivity);

  toolExecutor = new ToolExecutor({
    lifeEngine,
    face,
    robotClient,
    commandQueue,
    embodiedActionRouter,
    voiceOutput,
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
    voiceOutput,
    scenarioRunner: runScenarioFromVisionFollow,
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
    voiceOutput,
    face,
    eventBus: localEventBus,
    getPolicy: getExecutionPolicy,
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
    eventBus: localEventBus,
    getRuntimeContext,
    logger: (message, level = "info") => log(message, level)
  });
  geminiLiveRuntime.configure(activeConfig);
  geminiLiveRuntime.onStatus(updateGeminiLiveUi);
  [
    "vision_follow_starting",
    "vision_follow_started",
    "vision_follow_stopped",
    "vision_follow_target_set",
    "vision_follow_not_found",
    "vision_target_lost"
  ].forEach((type) => {
    localEventBus.subscribe(type, () => {
      if (type === "vision_follow_starting") {
        stopGeminiVisionAssist("follow_starting");
        updateVisionUi();
        syncGeminiVisionAssist(type);
        return;
      }
      updateVisionUi();
      sendFollowVisionContext(type, {
        force: [
          "vision_follow_started",
          "vision_follow_not_found",
          "vision_target_lost"
        ].includes(type),
        allowStopped: ["vision_follow_stopped", "vision_follow_not_found"].includes(type)
      });
      syncGeminiVisionAssist(type);
    });
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
  wakeLockManager.onStatus(updateEmbodimentUi);
  performanceMonitor = new PerformanceMonitor({
    logger: (message, level = "info") => log(message, level)
  });
  performanceMonitor.onStatus((status) => {
    updateEmbodimentUi(status);
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
  if (looiModeEnabled) {
    reliabilityManager.start();
  }
  if (keepRobotAwakeEnabled) {
    wakeLockManager.request().catch((error) => {
      keepRobotAwakeEnabled = false;
      if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = false;
      log(`Wake lock unavailable: ${error.message}`, "warn");
    });
  }
  updateConnectionState(robotClient.getStatus());
  updateLifeEngineToggle();
  updateSimulatorUi();
  updateLocalBrainUi();
  updateVoiceUi();
  updateAlwaysListeningUi();
  updateCameraUi();
  updateCalibrationUi();
  updatePersonalityUi();
  updateLifeEventsUi();
  refreshLocalBrainServerStatus().catch((error) => {
    log(`Local Brain server unavailable, fallback will be used: ${error.message}`, "warn");
  });
  if (ui.audioLevelMonitorToggle.checked) {
    setAudioLevelMonitorEnabled(true).catch((error) => {
      ui.audioLevelMonitorToggle.checked = false;
      log(`Audio activity monitor unavailable: ${error.message}`, "warn");
      updateAlwaysListeningUi();
    });
  }
  ui.productionStartButton.disabled = false;
  ui.localBrainQuickButton.disabled = false;
  updateProductionChrome();
  renderLocalBrainThoughts();
  renderLocalEvents();
  globalThis.setInterval(() => {
    updateAlwaysListeningUi();
    updateEmbodimentUi();
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
      renderTelemetry({});
    }

    updateSimulatorUi();
  });

  client.onTelemetry((telemetry) => {
    if (client !== robotClient) {
      return;
    }

    renderTelemetry(telemetry);
    lifeEngine?.updateTelemetry(telemetry);
    renderMotionDebug(telemetry);
    localEventBus?.publish?.("telemetry", {
      telemetry,
      simulatorMode,
      robotConnected: Boolean(robotClient?.isConnected?.())
    }, {
      source: simulatorMode ? "simulator" : "esp32",
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
    log(`${simulatorMode ? "SIM" : "ESP32"} ack: ${message.cmd}${details ? ` (${details})` : ""}`);

    if (message.cmd === "config_update" && message.config) {
      renderRobotConfig(message.config);
    }
  });

  client.onConfig?.((config) => {
    if (client !== robotClient) {
      return;
    }

    renderRobotConfig(config);
  });

  client.onError((message) => {
    if (client !== robotClient) {
      return;
    }

    requestPoseScenario("pose_scared");
    log(`${simulatorMode ? "Simulator" : "ESP32"} error: ${message.message ?? "unknown"}`, "error");
  });
}

function createCommandQueue(client) {
  const calibrationSettings = bodyCalibration?.getSettings?.() ?? {};
  const queue = new CommandQueue({
    robotClient: client,
    logger: (message, level = "info") => log(message, level),
    maxSpeed: calibrationSettings.maxSpeed ?? activeConfig.maxSpeed ?? PUBLIC_CONFIG.maxSpeed,
    maxDurationMs: activeConfig.maxDurationMs ?? PUBLIC_CONFIG.maxDurationMs
  });

  queue.onCommand?.((_entry, history) => {
    renderCommandHistory(history);
  });

  return queue;
}

function setActiveRobotClient(nextClient) {
  robotClient = nextClient;
  commandQueue = createCommandQueue(robotClient);
  lifeEngine?.setRobotInterfaces({
    robotClient,
    commandQueue
  });
  toolExecutor?.setRobotInterfaces({
    robotClient,
    commandQueue
  });
  followTargetController?.setRobotInterfaces?.({
    commandQueue,
    lifeEngine
  });
  scenarioFrameSequencer?.setCommandQueue?.(commandQueue);
  scenarioFrameSequencer?.setLifeEngine?.(lifeEngine);
  renderCommandHistory(commandQueue?.getRecentCommands?.() ?? []);
  updateConnectionState(robotClient.getStatus());
  renderTelemetry(robotClient.getLatestTelemetry?.() ?? {});
  renderRobotConfig(robotClient.getLatestConfig?.() ?? robotClient.getLatestTelemetry?.()?.config ?? null);
  updateSimulatorUi();
}

async function toggleSimulatorMode() {
  if (simulatorMode) {
    await disableSimulatorMode();
    return;
  }

  await enableSimulatorMode();
}

async function enableSimulatorMode() {
  if (simulatorMode) {
    return;
  }

  if (realRobotClient?.isConnected()) {
    await commandQueue?.stopMotion?.("switch_to_simulator");
    realRobotClient.disconnect();
  }

  if (!simulatedRobotClient) {
    simulatedRobotClient = new SimulatedESP32Client({
      logger: (message, level = "info") => log(message, level)
    });
    registerRobotClientCallbacks(simulatedRobotClient);
  }

  simulatorMode = true;
  setActiveRobotClient(simulatedRobotClient);
  await simulatedRobotClient.connect();
  await applyCalibrationToRobot({ quiet: true });
  lifeEngine?.setConnectionState("simulated_connected");
  updateConnectionState(simulatedRobotClient.getStatus());
  updateSimulatorUi();
  log("Simulator mode enabled.");
}

async function disableSimulatorMode() {
  if (!simulatorMode) {
    return;
  }

  if (simulatedRobotClient?.isConnected()) {
    await commandQueue?.stopMotion?.("switch_to_real_esp32");
    simulatedRobotClient.disconnect();
  }

  simulatorMode = false;
  setActiveRobotClient(realRobotClient);
  lifeEngine?.setConnectionState("disconnected");
  renderTelemetry({});
  updateSimulatorUi();
  log("Simulator mode disabled.");
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
  voiceOutput?.cancel?.(reason);
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
  await handleGatedTranscript({
    text,
    confidence: 1,
    language: ui.speechLanguageInput.value.trim() || "typed",
    timestamp: new Date().toISOString(),
    source: "typed"
  });
}

async function handleGatedTranscript(transcript = {}) {
  const text = String(transcript.text ?? "").trim();

  if (!text) {
    return null;
  }

  updateRecentObjectReferenceFromText(text);
  if (isStopFollowIntent(text)) {
    visionScenarioManager?.stopFollowing?.("user_stop_following");
    sendFollowVisionContext("user_stop_following", { force: true, allowStopped: true });
  }

  const source = transcript.source === "typed"
    ? "typed"
    : transcript.source === "speech_interim"
      ? "speech_interim"
      : "speech";
  const eventType = source === "typed" ? "user_text" : "user_speech";
  const gateResult = speechGate?.processTranscript?.({
    ...transcript,
    text,
    source
  }) ?? fallbackGateResult(text, source);
  traceLive("STEP 1 SPEECH_GATE", {
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
    ["direct_to_robot", "possible_direct_command", "question", "social_comment", "open_speech"].includes(gateResult.classification)
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
      confidence: transcript.confidence,
      language: transcript.language,
      final: transcript.final !== false,
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
      source === "typed" ? "local_typed_stop" : "local_voice_stop",
      source === "typed"
        ? "Local typed stop phrase detected."
        : "Local voice stop phrase detected.",
      "warn"
    );
  } else if (!gateResult.accepted) {
    log(`Ignored ${source}: ${text} (${gateResult.classification})`);
  } else if (gateResult.shouldTriggerBrain && looiModeEnabled) {
    requestPoseScenario("pose_curious");
  }

  updateAlwaysListeningUi();
  updateLocalBrainUi();
  return {
    event,
    gateResult
  };
}

function handleInterimSpeech(payload) {
  const text = String(payload.text ?? "").trim();
  ui.interimTranscript.textContent = text || "--";
  if (ui.earsInterimTranscript) {
    ui.earsInterimTranscript.textContent = text || "--";
  }
  scheduleStableInterimSpeech({ ...payload, text });
  updateVoiceUi();
}

async function handleFinalSpeech(payload) {
  const text = payload.text.trim();

  if (!text) {
    return;
  }

  const normalizedFinal = normalizeTranscriptForDedupe(text);
  const finalMatchesDispatchedInterim =
    Boolean(lastInterimDispatchedText) &&
    normalizedFinal === normalizeTranscriptForDedupe(lastInterimDispatchedText);
  const finalFollowsRecentInterim =
    Boolean(lastInterimDispatchedAt) &&
    Date.now() - lastInterimDispatchedAt < 2500;

  clearPendingInterimSpeech();
  lastTranscript = {
    ...payload,
    text
  };
  ui.finalTranscript.textContent = text;
  ui.interimTranscript.textContent = "";
  if (ui.earsInterimTranscript) {
    ui.earsInterimTranscript.textContent = "--";
  }

  if (!useFinalSpeechOnly && (finalMatchesDispatchedInterim || finalFollowsRecentInterim)) {
    log(`STEP 0 INPUT final skipped: already sent interim "${text}"`);
    return;
  }

  log(`STEP 0 INPUT speech: "${text}"`);
  await handleGatedTranscript({
    ...payload,
    text,
    source: "speech",
    final: true
  });
}

function scheduleStableInterimSpeech(payload = {}) {
  clearTimeout(interimSpeechTimer);
  latestInterimSpeech = payload;
  bestInterimSpeech = chooseBetterInterimCandidate(bestInterimSpeech, payload);

  if (useFinalSpeechOnly) {
    return;
  }

  const text = String(bestInterimSpeech?.text ?? payload.text ?? "").trim();
  if (!shouldDispatchInterimText(text)) {
    return;
  }

  interimSpeechTimer = globalThis.setTimeout(() => {
    dispatchStableInterimSpeech().catch((error) => {
      log(`Interim speech handling failed: ${error.message}`, "warn");
    });
  }, INTERIM_STABILITY_MS);
}

async function dispatchStableInterimSpeech() {
  const payload = bestInterimSpeech ?? latestInterimSpeech;
  latestInterimSpeech = null;
  bestInterimSpeech = null;
  interimSpeechTimer = null;

  const text = String(payload?.text ?? "").trim();
  if (!shouldDispatchInterimText(text)) {
    return null;
  }

  if (normalizeTranscriptForDedupe(text) === normalizeTranscriptForDedupe(lastInterimDispatchedText)) {
    return null;
  }

  lastInterimDispatchedText = text;
  lastInterimDispatchedAt = Date.now();
  lastTranscript = {
    ...payload,
    text,
    final: false,
    source: "speech_interim"
  };
  log(`STEP 0 INPUT interim: "${text}"`);
  return handleGatedTranscript({
    ...payload,
    text,
    source: "speech_interim",
    final: false,
    timestamp: payload.timestamp ?? new Date().toISOString()
  });
}

function clearPendingInterimSpeech() {
  clearTimeout(interimSpeechTimer);
  interimSpeechTimer = null;
  latestInterimSpeech = null;
  bestInterimSpeech = null;
}

function chooseBetterInterimCandidate(current, next) {
  const currentText = String(current?.text ?? "").trim();
  const nextText = String(next?.text ?? "").trim();

  if (!nextText) {
    return current ?? next;
  }

  if (!currentText) {
    return next;
  }

  const currentNormalized = normalizeTranscriptForDedupe(currentText);
  const nextNormalized = normalizeTranscriptForDedupe(nextText);

  if (!nextNormalized) {
    return current;
  }

  if (!currentNormalized) {
    return next;
  }

  if (currentNormalized.includes(nextNormalized) && currentNormalized !== nextNormalized) {
    return current;
  }

  if (nextNormalized.includes(currentNormalized) && currentNormalized !== nextNormalized) {
    return next;
  }

  const currentWords = currentNormalized.split(/\s+/).filter(Boolean).length;
  const nextWords = nextNormalized.split(/\s+/).filter(Boolean).length;

  if (nextWords > currentWords) {
    return next;
  }

  if (nextWords === currentWords && nextNormalized.length > currentNormalized.length) {
    return next;
  }

  return current;
}

function shouldDispatchInterimText(text) {
  const normalized = normalizeTranscriptForDedupe(text);

  if (!normalized) {
    return false;
  }

  if (isLocalStopPhrase(normalized)) {
    return true;
  }

  return normalized.split(/\s+/).length >= 2 && normalized.length >= 5;
}

function normalizeTranscriptForDedupe(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function openCameraFromUi(facingMode) {
  if (!cameraInput) {
    log("Camera input is still initializing.", "warn");
    return;
  }

  const result = await cameraInput.startCamera({ facingMode });
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
      face?.setVisionIndicator?.(false);
      syncGeminiVisionAssist("camera_stopped");
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

    lastEventPosted = published;
    ui.lastRobotEventPosted.textContent = published
      ? `${published.type} · ${published.id}`
      : "--";
    ui.robotEventPostStatus.textContent = "local";
    updateLifeEventsUi();
    renderLocalEvents();
    return published;
  } catch (error) {
    ui.robotEventPostStatus.textContent = `failed: ${error.message}`;
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

async function setAudioLevelMonitorEnabled(enabled) {
  if (!audioLevelMonitor) {
    throw new Error("Audio activity monitor is still initializing.");
  }

  if (enabled) {
    await audioLevelMonitor.start();
  } else {
    audioLevelMonitor.stop();
    clearTimeout(audioActivityClearTimer);
    lifeEngine?.setListening?.(false);
  }

  updateAlwaysListeningUi();
  return audioLevelMonitor.getStatus();
}

function handleVoiceActivity(payload = {}) {
  lifeEngine?.setListening?.(true);
  requestPoseScenario("pose_attentive", { minIntervalMs: 1200 });
  if (ui.voiceActivityState) {
    ui.voiceActivityState.textContent = "voice activity";
  }

  clearTimeout(audioActivityClearTimer);
  audioActivityClearTimer = globalThis.setTimeout(() => {
    lifeEngine?.setListening?.(false);
    updateAlwaysListeningUi();
  }, 1200);

  if (ui.audioLevelDisplay) {
    ui.audioLevelDisplay.textContent = `${Math.round(Number(payload.level || 0) * 100)}%`;
  }

  updateAlwaysListeningUi();
}

function parseWakeNames(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const names = source
    .map((name) => String(name).trim().toLowerCase())
    .filter(Boolean);
  return names.length ? [...new Set(names)] : ["looi", "louie", "lui", "robot"];
}

function fallbackGateResult(text, source = "speech") {
  const typed = source === "typed";
  const stopPhrase = isLocalStopPhrase(text);
  return {
    accepted: true,
    classification: stopPhrase ? "safety_stop" : typed ? "direct_to_robot" : "open_speech",
    priority: stopPhrase ? "critical" : typed ? "normal" : "low",
    shouldTriggerBrain: !stopPhrase,
    shouldOpenAttention: typed,
    shouldImmediateStop: stopPhrase,
    normalizedText: String(text ?? "").trim().toLowerCase(),
    reason: "speech_gate_unavailable",
    suggestedIntent: null
  };
}

function bindCalibrationInput(element, key) {
  element.addEventListener("input", () => {
    if (!bodyCalibration) {
      return;
    }

    bodyCalibration.patchSettings({
      [key]: Number(element.value)
    });
  });
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

  renderRobotConfig(result.config);

  if (!quiet) {
    log("Calibration config sent to robot runtime.");
  }

  return result;
}

function requestRobotConfig() {
  if (!robotClient?.isConnected?.()) {
    log("Cannot request robot config: robot or simulator is not connected.", "warn");
    return;
  }

  if (typeof robotClient.requestConfig !== "function") {
    log("Robot config request is unavailable on this client.", "warn");
    return;
  }

  robotClient.requestConfig();
  log("Requested robot config.");
}

function runCalibrationMotionTest({ linear = 0, angular = 0, label }) {
  if (!calibrationTestArmed) {
    log("Calibration movement blocked: arm Calibration Test first.", "warn");
    return;
  }

  if (!ensureConnected("Calibration movement skipped because no robot client is connected.")) {
    return;
  }

  const settings = bodyCalibration?.getSettings?.() ?? {};
  const speed =
    linear !== 0
      ? settings.gentleSpeed ?? 0.18
      : settings.turnSpeed ?? 0.18;

  commandQueue
    .enqueueMotion({
      linear: linear * speed,
      angular: angular * speed,
      durationMs: settings.approachTinyMs ?? 220,
      rampMs: settings.rampMs ?? 150,
      label
    })
    .catch((error) => {
      log(`${label} failed: ${error.message}`, "warn");
    });
  log(`Calibration test queued: ${label}`);
}

function runCalibrationScenarioTest(name) {
  if (!calibrationTestArmed) {
    log("Calibration scenario test blocked: arm Calibration Test first.", "warn");
    return;
  }

  if (!ensureConnected("Calibration Life test skipped because no robot client is connected.")) {
    return;
  }

  lifeEngine?.receiveEvent({
    type: "manual_test",
    label: `calibration_${name}`,
    value: { scenario: name }
  });
  runScenarioFromUi(name).catch((error) => {
    log(`Calibration scenario test failed: ${error.message}`, "warn");
  });
  log(`Calibration scenario test requested: ${name}`);
}

async function startProductionRuntime() {
  await requestFullscreenSafe();

  if (realRobotClient?.refreshStatus) {
    await realRobotClient.refreshStatus().catch((error) => {
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
    localBrainEnabled: true,
    localMotionArmed: true,
    localCameraAllowed: true,
    localSpeechAllowed: true,
    followModeArmed: true,
    allowFollowMovement: true
  });

  lifeEventsEnabled = true;
  globalThis.localStorage?.setItem?.("looi.lifeEventsEnabled.v1", "true");

  ui.muteSpeechToggle.checked = false;
  voiceOutput?.setMuted?.(false);

  looiModeEnabled = true;
  keepRobotAwakeEnabled = true;
  if (ui.looiModeToggle) ui.looiModeToggle.checked = true;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = true;

  performanceMonitor?.start?.();
  reliabilityManager?.start?.();
  wakeLockManager?.request?.().catch((error) => {
    keepRobotAwakeEnabled = false;
    if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = false;
    log(`Wake lock unavailable: ${error.message}`, "warn");
  });

  updateLocalBrainUi();
  updateCameraUi();

  localBrainEngine?.start?.();

  if (!lifeEventEmitter?.getStatus?.().running) {
    lifeEventEmitter?.start?.();
  }
  updateLifeEventsUi();

  if (useGeminiLive) {
    speechInput?.stop?.();
    ui.continuousListeningToggle.checked = false;
    ui.alwaysListeningToggle.checked = false;
    const geminiStartResult = await geminiStartPromise;
    if (geminiStartResult?.error) {
      throw geminiStartResult.error;
    }
  } else {
    speechInput?.setLanguage?.(ui.speechLanguageInput.value.trim() || "en-US");
    ui.continuousListeningToggle.checked = true;
    ui.alwaysListeningToggle.checked = true;
    speechInput?.startAlwaysListening?.();
  }
  attentionSystem?.wake?.("live_start", activeConfig.conversationWindowMs ?? 30000);
  speechGate?.openAttentionWindow?.("live_start");

  if (!useGeminiLive) {
    ui.audioLevelMonitorToggle.checked = true;
    setAudioLevelMonitorEnabled(true).catch((error) => {
      ui.audioLevelMonitorToggle.checked = false;
      log(`Audio activity monitor unavailable: ${error.message}`, "warn");
      updateAlwaysListeningUi();
    });
  }

  await openCameraFromUi("user").catch((error) => {
    log(`Camera startup skipped: ${error.message}`, "warn");
  });

  if (!useGeminiLive) {
    voiceOutput?.speak?.({
      text: "I'm awake.",
      tone: "happy",
      interrupt: true
    });
  }

  requestPoseScenario("pose_happy");
  log(
    useGeminiLive
      ? "Gemini Live started: speech-to-speech ears, Gemini audio, camera, LOOI mode, and scenario movement permissions are enabled."
      : "Local Brain Live started: brain, ears, speech, camera, LOOI mode, and scenario movement permissions are enabled.",
    "warn"
  );
  updateAlwaysListeningUi();
  updateGeminiLiveUi();
  updateEmbodimentUi();
  updateProductionChrome();
}

function primeLiveInputsFromUserGesture() {
  if (!isGeminiLivePrimary()) {
    primeSpeechFromUserGesture();
  }
  primeCameraFromUserGesture();
}

function primeSpeechFromUserGesture() {
  if (!speechInput) {
    log("Speech input is still initializing.", "warn");
    return;
  }

  speechInput.setLanguage?.(ui.speechLanguageInput.value.trim() || "en-US");
  speechInput.setContinuous?.(true);
  ui.continuousListeningToggle.checked = true;
  ui.alwaysListeningToggle.checked = true;
  speechInput.startAlwaysListening?.();
  updateVoiceUi();
  updateAlwaysListeningUi();
}

function primeCameraFromUserGesture() {
  if (!cameraInput || cameraInput.getCameraStatus?.().running) {
    return;
  }

  cameraInput.startCamera?.({ facingMode: "user" })
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

  if (simulatorMode) {
    if (!robotClient.isConnected?.()) {
      await robotClient.connect();
    }
    await applyCalibrationToRobot({ quiet: true }).catch((error) => {
      log(`Simulator calibration apply failed: ${error.message}`, "warn");
    });
    return;
  }

  if (realRobotClient?.refreshStatus) {
    await realRobotClient.refreshStatus().catch((error) => {
      log(`ESP32 gateway refresh failed: ${error.message}`, "warn");
    });
  }

  if (!realRobotClient?.isConnected?.()) {
    const nextUrl = ui.esp32UrlInput.value.trim() || activeConfig.defaultEsp32WsUrl;
    await realRobotClient.connect(nextUrl).catch((error) => {
      log(`ESP32 gateway is not connected yet: ${error.message}`, "warn");
    });
  }

  if (realRobotClient?.isConnected?.()) {
    setActiveRobotClient(realRobotClient);
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
        ? "Gemini Live"
        : "Local Brain Live"
      : "Start Local Brain";
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
    : brainPolicy.localCameraAllowed
      ? "No object metadata yet."
      : "Local Brain camera actions are blocked until allowed.";

  if (ui.localVisionPreview && cameraInput?.stream) {
    ui.localVisionPreview.srcObject = cameraInput.stream;
  } else if (ui.localVisionPreview) {
    ui.localVisionPreview.srcObject = null;
  }

  document.body.classList.toggle("local-brain-running", liveRunning);
  document.body.classList.toggle("local-motion-armed", brainPolicy.localMotionArmed);
  document.body.classList.toggle("looi-mode-active", looiModeEnabled);
}

function updateConnectionState(status) {
  const state = status?.state ?? "disconnected";
  const label = simulatorMode && status?.connected ? "simulated_connected" : state;

  ui.connectionState.textContent = label;
  ui.esp32Status.textContent = label;
}

function getLifeConnectionState(status) {
  if (!status?.connected) {
    return "disconnected";
  }

  return status.simulated || simulatorMode ? "simulated_connected" : "connected";
}

function renderTelemetry(telemetry) {
  const data = telemetry ?? robotClient?.getLatestTelemetry?.() ?? null;

  ui.telemetryRssi.textContent = formatMaybe(data?.rssi, (value) => `${value} dBm`);
  ui.telemetryClients.textContent = formatMaybe(data?.clients);
  ui.telemetryMotorState.textContent = formatMaybe(data?.motor_state);
  ui.telemetryLeftSpeed.textContent = formatMaybe(data?.left_speed, formatNumber);
  ui.telemetryRightSpeed.textContent = formatMaybe(data?.right_speed, formatNumber);
  ui.telemetryMotionRemaining.textContent = formatMaybe(
    data?.motion_remaining_ms,
    (value) => `${Math.round(value)} ms`
  );
  ui.telemetryLastCommandAge.textContent = formatMaybe(
    data?.last_command_age_ms,
    (value) => `${Math.round(value)} ms`
  );
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
}

function updateLifeEngineToggle() {
  if (!lifeEngine) {
    return;
  }

  ui.lifeEngineToggle.textContent = lifeEngine.running ? "Pause Life Engine" : "Start Life Engine";
}

function updateSimulatorUi() {
  const simulatorConnected = simulatorMode && simulatedRobotClient?.isConnected();

  ui.simulatorState.textContent = simulatorMode
    ? simulatorConnected
      ? "active"
      : "enabled_disconnected"
    : "off";
  ui.simulatorToggle.textContent = simulatorMode
    ? "Disable Simulator Mode"
    : "Enable Simulator Mode";
  ui.simulatorNote.textContent = simulatorMode
    ? "Simulator active: motor commands are logged, not sent to real ESP32."
    : "Simulator inactive. Real ESP32 commands use the WebSocket body controller.";
  document.body.classList.toggle("simulator-active", simulatorMode);
}

function updateCalibrationUi(settings = bodyCalibration?.getSettings?.()) {
  const values = settings ?? {
    maxSpeed: 0.4,
    gentleSpeed: 0.18,
    turnSpeed: 0.18,
    wiggleSpeed: 0.2,
    rampMs: 150,
    leftTrim: 1,
    rightTrim: 1,
    deadband: 0.03,
    minPwm: 210,
    motionIntensityScale: 1,
    idleMotionEnabled: true
  };

  setInputValue(ui.calibrationMaxSpeed, values.maxSpeed);
  setInputValue(ui.calibrationGentleSpeed, values.gentleSpeed);
  setInputValue(ui.calibrationTurnSpeed, values.turnSpeed);
  setInputValue(ui.calibrationWiggleSpeed, values.wiggleSpeed);
  setInputValue(ui.calibrationRampMs, values.rampMs);
  setInputValue(ui.calibrationLeftTrim, values.leftTrim);
  setInputValue(ui.calibrationRightTrim, values.rightTrim);
  setInputValue(ui.calibrationDeadband, values.deadband);
  setInputValue(ui.calibrationMinPwm, values.minPwm);
  setInputValue(ui.calibrationMotionIntensityScale, values.motionIntensityScale);
  ui.calibrationIdleMotionEnabled.checked = values.idleMotionEnabled !== false;

  ui.calibrationArmButton.textContent = calibrationTestArmed
    ? "Disarm Calibration Test"
    : "Arm Calibration Test";
  ui.calibrationArmState.textContent = calibrationTestArmed
    ? "ARMED - test buttons may move the body"
    : "DISARMED - test movement blocked";
  ui.calibrationArmState.classList.toggle("calibration-state--armed", calibrationTestArmed);
  ui.calibrationArmState.classList.toggle("calibration-state--disarmed", !calibrationTestArmed);
  document.body.classList.toggle("calibration-armed", calibrationTestArmed);
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

function renderRobotConfig(config) {
  if (!ui.robotConfigDisplay) {
    return;
  }

  ui.robotConfigDisplay.textContent = config
    ? JSON.stringify(config, null, 2)
    : "No robot config received yet.";
}

function renderCommandHistory(history = commandQueue?.getRecentCommands?.() ?? []) {
  if (!ui.recentCommandHistory) {
    return;
  }

  if (!history.length) {
    ui.recentCommandHistory.textContent = "No movement commands yet.";
    return;
  }

  ui.recentCommandHistory.textContent = history
    .slice(0, 12)
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      return `${time} ${entry.status} ${entry.label} lin=${formatNumber(entry.linear)} ang=${formatNumber(entry.angular)} dur=${Math.round(entry.durationMs)} ramp=${Math.round(entry.rampMs)}`;
    })
    .join("\n");
}

function renderMotionDebug(telemetry = robotClient?.getLatestTelemetry?.()) {
  if (!ui.motionDebugDisplay) {
    return;
  }

  if (!telemetry) {
    ui.motionDebugDisplay.textContent = "No motion telemetry yet.";
    return;
  }

  ui.motionDebugDisplay.textContent = JSON.stringify(
    {
      motor_state: telemetry.motor_state,
      left_speed: telemetry.left_speed,
      right_speed: telemetry.right_speed,
      current_left_speed: telemetry.current_left_speed,
      current_right_speed: telemetry.current_right_speed,
      target_left_speed: telemetry.target_left_speed,
      target_right_speed: telemetry.target_right_speed,
      ramp_ms: telemetry.ramp_ms,
      motion_label: telemetry.motion_label,
      motion_remaining_ms: telemetry.motion_remaining_ms
    },
    null,
    2
  );
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

  ui.localBrainEnabledToggle.checked = Boolean(brainPolicy.localBrainEnabled);
  ui.localMotionArmedToggle.checked = Boolean(brainPolicy.localMotionArmed);
  ui.localCameraAllowedToggle.checked = Boolean(brainPolicy.localCameraAllowed);
  ui.localSpeechAllowedToggle.checked = Boolean(brainPolicy.localSpeechAllowed);
  if (ui.followModeArmedToggle) {
    ui.followModeArmedToggle.checked = Boolean(brainPolicy.followModeArmed);
  }
  if (ui.allowFollowMovementToggle) {
    ui.allowFollowMovementToggle.checked = Boolean(brainPolicy.allowFollowMovement);
  }

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
  updateAlwaysListeningUi();
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

  if (ui.geminiLiveOutputState) {
    ui.geminiLiveOutputState.textContent =
      status.lastAudioDebug || status.outputAudioState || "--";
  }

  if (ui.geminiLiveFrameState) {
    ui.geminiLiveFrameState.textContent = status.lastVideoFrameDebug || status.lastServerMessageDebug || "--";
  }

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
  const followActive = isFollowVisionModeActive();
  const blockedReason = !geminiVisionAssistEnabled
    ? "disabled"
    : !geminiStatus.connected
      ? "gemini_not_connected"
      : !cameraStatus.running
        ? "camera_off"
        : followActive
          ? "paused_for_follow"
          : "running";
  const shouldRun = Boolean(
    geminiVisionAssistEnabled &&
    geminiStatus.connected &&
    cameraStatus.running &&
    !followActive
  );

  return {
    shouldRun,
    enabled: geminiVisionAssistEnabled,
    connected: Boolean(geminiStatus.connected),
    cameraRunning: Boolean(cameraStatus.running),
    followActive,
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
      : state.followActive
        ? "paused for follow"
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

function getPolicy() {
  return clampBrainPolicy(brainPolicy);
}

async function runScenarioFromUi(name, args = {}) {
  if (!toolExecutor?.executeBridgeAction) {
    log("Scenario runtime is still initializing.", "warn");
    return null;
  }

  const result = await toolExecutor.executeBridgeAction({
    id: `ui_scenario_${name}_${Date.now()}`,
    source: "local",
    type: "run_scenario",
    args: {
      name,
      ...args
    },
    reason: `ui_scenario:${name}`
  });
  updateEmbodimentUi();
  return result;
}

async function runScenarioFromVisionFollow(name, args = {}) {
  if (!toolExecutor?.executeBridgeAction) {
    log(`[mediapipe] follow scenario skipped ${name}: tool executor unavailable`, "warn");
    return null;
  }

  return toolExecutor.executeBridgeAction({
    id: `mediapipe_follow_${name}_${Date.now()}`,
    source: "vision_follow",
    type: "run_scenario",
    args: {
      name,
      targetLabel: args.targetLabel ?? "",
      trackId: args.trackId ?? null
    },
    reason: args.reason ?? `mediapipe_follow:${name}`
  });
}

function requestPoseScenario(name, { minIntervalMs = 650 } = {}) {
  if (!toolExecutor?.executeBridgeAction) {
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

async function simulatorDemoRoutine() {
  if (!simulatorMode) {
    await enableSimulatorMode();
  }

  const previousMotionArmed = brainPolicy.localMotionArmed;
  patchBrainPolicy({
    localMotionArmed: true
  });

  const sequence = ["ack_yes", "look_left", "look_right", "come_closer", "back_up", "body_talking"];

  for (const name of sequence) {
    await runScenarioFromUi(name);
    await waitMs(220);
  }

  patchBrainPolicy({ localMotionArmed: previousMotionArmed });
  log("Simulator scenario demo complete.");
}

async function wheelsLiftedSafetyRoutine() {
  if (!robotClient?.isConnected?.() || simulatorMode) {
    throw new Error("Connect the real ESP32 first. This routine is for wheels-lifted hardware testing.");
  }

  if (!globalThis.confirm?.("Wheels lifted, robot supervised, stop control visible?")) {
    return;
  }

  await immediateStop("wheels_lifted_precheck", "Precheck stop sent.", "warn");
  const previousMotionArmed = brainPolicy.localMotionArmed;
  patchBrainPolicy({ localMotionArmed: true });
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: 0.08, angular: 0, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_forward" });
  await commandQueue.stopMotion("wheels_lifted_forward_stop");
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: -0.08, angular: 0, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_back" });
  await commandQueue.stopMotion("wheels_lifted_back_stop");
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: 0, angular: 0.08, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_rotate" });
  await commandQueue.stopMotion("wheels_lifted_done");
  patchBrainPolicy({ localMotionArmed: previousMotionArmed });
  log("Wheels-lifted safety routine complete.", "warn");
}

function updateEmbodimentUi(statusOverride = null) {
  const sequence = scenarioFrameSequencer?.getCurrentSequence?.();
  const schedulerTask = priorityScheduler?.getCurrentTask?.();
  const performance = statusOverride ?? performanceMonitor?.getStatus?.() ?? {};
  const reliability = reliabilityManager?.getStatus?.() ?? {};
  const wakeLock = wakeLockManager?.getStatus?.() ?? {};

  if (ui.looiModeToggle) ui.looiModeToggle.checked = looiModeEnabled;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = keepRobotAwakeEnabled && wakeLock.requested !== false;

  if (ui.currentSequenceState) {
    ui.currentSequenceState.textContent = sequence ? `${sequence.name} · ${sequence.source}` : "idle";
  }

  if (ui.schedulerState) {
    ui.schedulerState.textContent = schedulerTask ? "running" : priorityScheduler?.getQueue?.().length ? "queued" : "idle";
  }

  if (ui.currentPriorityTask) {
    ui.currentPriorityTask.textContent = schedulerTask ? `${schedulerTask.type} · p${schedulerTask.priority}` : "--";
  }

  if (ui.fpsDisplay) {
    ui.fpsDisplay.textContent = Number(performance.fps) > 0 ? `${Math.round(performance.fps)} fps` : "--";
  }

  if (ui.performanceModeDisplay) {
    ui.performanceModeDisplay.textContent = performance.running === false ? "off" : "monitoring";
  }

  if (ui.wakeLockState) {
    ui.wakeLockState.textContent = wakeLock.active ? "active" : wakeLock.supported ? "available" : "unsupported";
  }

  if (ui.reliabilityModeDisplay) {
    ui.reliabilityModeDisplay.textContent = reliability.mode ?? "normal";
  }

  renderSequenceHistory();
  renderRuntimeWarnings(performance.warnings ?? []);
  document.body.classList.toggle("looi-mode-active", looiModeEnabled);
  document.body.classList.toggle("sequence-running", Boolean(sequence));
  document.body.classList.toggle("wake-lock-active", Boolean(wakeLock.active));

  return {
    sequence,
    schedulerTask,
    performance,
    reliability,
    wakeLock
  };
}

function renderSequenceHistory(history = scenarioFrameSequencer?.getHistory?.({ limit: 8 }) ?? []) {
  if (!ui.sequenceHistoryList) {
    return;
  }

  ui.sequenceHistoryList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "sequence-history-item";
    empty.innerHTML = "<strong>No sequences yet</strong><span>Run a scenario to see local frame execution.</span>";
    ui.sequenceHistoryList.append(empty);
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `sequence-history-item${entry.partial ? " sequence-history-item--partial" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${entry.sequence} · ${entry.reason}`;
    const detail = document.createElement("span");
    detail.textContent = `${new Date(entry.timestamp).toLocaleTimeString()} · frames=${entry.executedFrames ?? 0} · skipped=${entry.skippedFrames?.join(",") || "none"}`;
    item.append(title, detail);
    ui.sequenceHistoryList.append(item);
  });
}

function renderRuntimeWarnings(warnings = performanceMonitor?.getStatus?.().warnings ?? []) {
  if (!ui.runtimeWarningsList) {
    return;
  }

  ui.runtimeWarningsList.replaceChildren();
  if (!warnings.length) {
    const empty = document.createElement("div");
    empty.className = "runtime-warning-item";
    empty.textContent = "No runtime warnings.";
    ui.runtimeWarningsList.append(empty);
    return;
  }

  warnings.slice(0, 6).forEach((warning) => {
    const item = document.createElement("div");
    item.className = "runtime-warning-item runtime-warning-item--warn";
    item.textContent = `${new Date(warning.timestamp).toLocaleTimeString()} · ${warning.message}`;
    ui.runtimeWarningsList.append(item);
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
    empty.innerHTML = "<strong>No local events yet</strong><span>Speech, text, camera, telemetry, and life events appear here.</span>";
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

function updateAlwaysListeningUi() {
  const speechStatus = speechInput?.getStatus?.() ?? {
    supported: false,
    listening: false,
    starting: false,
    alwaysListening: false
  };
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  const geminiPrimaryActive = Boolean(geminiStatus.running || geminiStatus.connecting || geminiStatus.connected);
  const gateStatus = speechGate?.getStatus?.() ?? {
    attentionOpen: false,
    attentionRemainingMs: 0,
    ignoredCount: 0,
    relevantCount: 0,
    lastResult: null
  };
  const attentionStatus = attentionSystem?.update?.() ?? {
    mode: "idle",
    attentionRemainingMs: 0,
    stopCooldownRemainingMs: 0
  };
  const audioStatus = audioLevelMonitor?.getStatus?.() ?? {
    supported: false,
    running: false,
    level: 0,
    lastActivityAt: 0
  };
  const transcripts = speechGate?.getRecentTranscripts?.({ limit: 20 }) ?? [];
  const lastAccepted = transcripts.find((entry) => entry.accepted);
  const lastIgnored = transcripts.find((entry) => !entry.accepted);

  if (ui.alwaysListeningToggle) {
    ui.alwaysListeningToggle.checked = Boolean(speechStatus.alwaysListening);
  }

  if (ui.earsState) {
    ui.earsState.textContent = geminiPrimaryActive
      ? geminiStatus.micStreaming
        ? "Gemini Live"
        : geminiStatus.connecting
          ? "Gemini starting"
          : "Gemini connected"
      : speechStatus.alwaysListening
      ? speechStatus.listening
        ? "ears on"
        : speechStatus.starting
          ? "starting"
          : "restarting"
      : speechStatus.listening
        ? "manual listening"
        : speechStatus.starting
          ? "starting"
        : "ears off";
    ui.earsState.classList.toggle(
      "ears-state--on",
      Boolean(geminiPrimaryActive || speechStatus.alwaysListening || speechStatus.listening || speechStatus.starting)
    );
    ui.earsState.classList.toggle(
      "ears-state--off",
      !geminiPrimaryActive && !speechStatus.alwaysListening && !speechStatus.listening && !speechStatus.starting
    );
  }

  if (ui.speechGateState) {
    ui.speechGateState.textContent = `${gateStatus.relevantCount} accepted / ${gateStatus.ignoredCount} ignored`;
  }

  if (ui.attentionModeState) {
    ui.attentionModeState.textContent = attentionStatus.mode;
    ui.attentionModeState.classList.toggle("attention-state--active", ["attentive", "conversation", "busy"].includes(attentionStatus.mode));
    ui.attentionModeState.classList.toggle("attention-state--stop", attentionStatus.mode === "stop_cooldown");
  }

  if (ui.attentionWindowRemaining) {
    const remaining = Math.max(
      Number(attentionStatus.attentionRemainingMs || 0),
      Number(gateStatus.attentionRemainingMs || 0)
    );
    ui.attentionWindowRemaining.textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : "--";
  }

  if (ui.lastSpeechClassification) {
    ui.lastSpeechClassification.textContent = gateStatus.lastResult?.classification ?? "--";
  }

  if (ui.lastAcceptedTranscript) {
    ui.lastAcceptedTranscript.textContent = lastAccepted
      ? `${lastAccepted.text} (${lastAccepted.classification})`
      : "--";
  }

  if (ui.lastIgnoredTranscript) {
    ui.lastIgnoredTranscript.textContent = lastIgnored
      ? `${lastIgnored.text} (${lastIgnored.classification})`
      : "--";
  }

  updateSpeechRecognitionDiagnostics(speechStatus);

  if (ui.audioLevelMonitorToggle) {
    ui.audioLevelMonitorToggle.checked = Boolean(audioStatus.running);
  }

  if (ui.audioLevelDisplay && !audioStatus.running) {
    ui.audioLevelDisplay.textContent = audioStatus.supported ? "off" : "unsupported";
  }

  if (ui.voiceActivityState) {
    const active = Number(audioStatus.lastActivityAt || 0) > Date.now() - 1600;
    ui.voiceActivityState.textContent = audioStatus.running
      ? active
        ? "voice activity"
        : "quiet"
      : "off";
    ui.voiceActivityState.classList.toggle("voice-state--active", active);
  }

  updateGeminiLiveUi(geminiStatus);

  document.body.classList.toggle(
    "ears-on",
    Boolean(geminiPrimaryActive || speechStatus.alwaysListening || speechStatus.listening)
  );
  document.body.classList.toggle("attention-active", ["attentive", "conversation", "busy"].includes(attentionStatus.mode));
  document.body.classList.toggle("stop-cooldown", attentionStatus.mode === "stop_cooldown");
}

function updateSpeechRecognitionDiagnostics(speechStatus = speechInput?.getStatus?.() ?? {}) {
  if (ui.speechRecognitionSupportDetail) {
    ui.speechRecognitionSupportDetail.textContent = speechStatus.supported
      ? speechStatus.secureContext
        ? "supported + secure"
        : "supported, insecure context"
      : "unsupported";
  }

  if (ui.speechRecognitionStateDetail) {
    ui.speechRecognitionStateDetail.textContent = speechStatus.listening
      ? "listening"
      : speechStatus.starting
        ? "starting"
      : speechStatus.alwaysListening
        ? `waiting restart (${speechStatus.restartBackoffMs ?? 0}ms)`
        : "stopped";
  }

  if (ui.speechRecognitionAttemptCount) {
    ui.speechRecognitionAttemptCount.textContent = String(speechStatus.startAttemptCount ?? 0);
  }

  if (ui.speechRecognitionResultCount) {
    ui.speechRecognitionResultCount.textContent =
      `${speechStatus.finalResultCount ?? 0} final / ${speechStatus.interimResultCount ?? 0} interim`;
  }

  if (ui.speechRecognitionLastResult) {
    ui.speechRecognitionLastResult.textContent = speechStatus.lastResultAt
      ? `${Math.max(0, Math.round((Date.now() - Number(speechStatus.lastResultAt)) / 1000))}s ago`
      : "--";
  }

  if (ui.speechRecognitionLastError) {
    ui.speechRecognitionLastError.textContent = speechStatus.lastError
      ? `${speechStatus.lastError}${speechStatus.lastErrorAt ? ` · ${Math.max(0, Math.round((Date.now() - Number(speechStatus.lastErrorAt)) / 1000))}s ago` : ""}`
      : "--";
    ui.speechRecognitionLastError.classList.toggle("voice-state--warn", Boolean(speechStatus.lastError));
  }

  renderSpeechRecognitionDebugLog(speechStatus.debugEvents ?? []);
}

function renderSpeechRecognitionDebugLog(events = []) {
  if (!ui.speechRecognitionDebugLog) {
    return;
  }

  ui.speechRecognitionDebugLog.replaceChildren();

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "speech-debug-entry";
    empty.innerHTML = "<strong>No speech recognition events yet</strong><span>Start listening, then speak near the phone.</span>";
    ui.speechRecognitionDebugLog.append(empty);
    return;
  }

  events.slice(0, 8).forEach((event) => {
    const item = document.createElement("div");
    item.className = `speech-debug-entry speech-debug-entry--${event.type ?? "event"}`;

    const title = document.createElement("strong");
    title.textContent = `${event.type ?? "event"} · ${event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "--"}`;

    const detail = document.createElement("span");
    detail.textContent = event.message ?? "";

    item.append(title, detail);
    ui.speechRecognitionDebugLog.append(item);
  });
}

function updateVoiceUi() {
  const speechStatus = speechInput?.getStatus?.() ?? {
    supported: false,
    listening: false,
    starting: false,
    secureContext: globalThis.isSecureContext !== false
  };
  const voiceStatus = voiceOutput?.getStatus?.() ?? {
    supported: false,
    muted: false,
    speaking: false
  };
  const geminiStatus = geminiLiveRuntime?.getStatus?.() ?? {};
  const geminiPrimaryActive = Boolean(geminiStatus.running || geminiStatus.connecting || geminiStatus.connected);

  ui.speechSupportState.textContent = geminiPrimaryActive
    ? geminiStatus.micStreaming
      ? "Gemini Live mic"
      : geminiStatus.connecting
        ? "Gemini starting"
        : "Gemini connected"
    : speechStatus.supported
    ? speechStatus.lastError
      ? `error: ${speechStatus.lastError}`
      : speechStatus.listening
      ? "listening"
      : speechStatus.starting
      ? "starting"
      : "supported"
    : "unsupported";
  ui.speechSupportState.classList.toggle("voice-state--active", Boolean(geminiPrimaryActive || speechStatus.listening || speechStatus.starting));
  ui.speechSupportState.classList.toggle("voice-state--warn", geminiPrimaryActive ? Boolean(geminiStatus.lastError) : !speechStatus.supported || Boolean(speechStatus.lastError));
  ui.speechSecureWarning.textContent = geminiPrimaryActive
    ? `Gemini Live primary voice path. Input transcript: ${geminiStatus.lastInputTranscript || "--"}`
    : speechStatus.lastError
    ? `Speech error: ${speechStatus.lastError}. Check microphone permission for this site on the phone.`
    : speechStatus.secureContext
      ? `Microphone access may require user permission. Results: ${speechStatus.finalResultCount ?? 0} final / ${speechStatus.interimResultCount ?? 0} interim.`
      : "Speech recognition usually requires HTTPS or localhost.";
  ui.voiceSupportState.textContent = geminiPrimaryActive
    ? geminiStatus.audioPlaying
      ? "Gemini audio"
      : "Gemini primary"
    : voiceStatus.supported
    ? voiceStatus.muted
      ? "muted"
      : "supported"
    : "unsupported";
  ui.voiceSupportState.classList.toggle("voice-state--active", Boolean(geminiStatus.audioPlaying || voiceStatus.speaking));
  ui.voiceSupportState.classList.toggle("voice-state--warn", geminiPrimaryActive ? Boolean(geminiStatus.lastError) : !voiceStatus.supported || voiceStatus.muted);
  ui.speakingState.textContent = String(Boolean(geminiStatus.audioPlaying || voiceStatus.speaking || lifeEngine?.getState?.().isSpeaking));
  ui.muteSpeechToggle.checked = Boolean(voiceStatus.muted);
  updateAlwaysListeningUi();
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
  ui.cameraFacingMode.textContent = cameraStatus.facingMode ?? "unknown";
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

function setupObjectDetectorModelOptions() {
  if (!ui.objectDetectorModelSelect) {
    return;
  }

  ui.objectDetectorModelSelect.replaceChildren();
  Object.entries(OBJECT_DETECTOR_MODEL_PRESETS).forEach(([key, preset]) => {
    ui.objectDetectorModelSelect.append(new Option(preset.label, key));
  });
  ui.objectDetectorModelSelect.value =
    activeConfig.objectDetectorModelPreset ??
    PUBLIC_CONFIG.objectDetectorModelPreset ??
    DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;
}

async function startObjectDetectionFromUi() {
  if (!objectDetectorEngine) {
    throw new Error("Object detector is not initialized.");
  }

  if (!brainPolicy.localVisionEnabled) {
    throw new Error("Local object vision is disabled.");
  }

  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};
  if (!cameraStatus.running) {
    if (!brainPolicy.localCameraAllowed) {
      throw new Error("Start the camera or enable Local Camera Allowed first.");
    }
    const result = await cameraInput.startCamera({ facingMode: cameraStatus.facingMode || "user" });
    handleCameraCommandResult(result);
    if (!result?.ok) {
      throw new Error(result?.error || "Camera could not start.");
    }
  }

  const status = await objectDetectorEngine.start();
  face?.setVisionIndicator?.(Boolean(status.running), "detecting");
  updateVisionUi();
  return status;
}

function handleObjectDetections(result = {}) {
  const tracks = objectTracker?.update?.(result) ?? [];
  visionState?.updateFromDetections?.(result, tracks);
  updateVisionUi();
  drawObjectDetectionOverlays(result.detections ?? []);
  localEventBus?.publish?.("vision_objects_updated", {
    visibleLabels: getVisionContext().visibleLabels,
    objectCount: getVisionContext().objects.length,
    activeTarget: getVisionContext().activeTarget
  }, { source: "vision" });
  sendFollowVisionContext("vision_objects_updated");
}

function getVisionContext() {
  return buildVisionContext({
    visionState,
    cameraInput,
    objectTracker
  });
}

function isFollowVisionModeActive() {
  const scenario = visionState?.getStatus?.().scenario ?? {};
  const scenarioActive = Boolean(
    scenario.active &&
    scenario.type === "follow_object" &&
    scenario.state !== "idle" &&
    scenario.state !== "not_found"
  );
  return Boolean(followTargetController?.isRunning?.() || scenarioActive);
}

function sendFollowVisionContext(reason = "follow_context", { force = false, allowStopped = false } = {}) {
  if (!geminiLiveRuntime?.sendVisionContext) {
    return false;
  }

  if (!allowStopped && !isFollowVisionModeActive()) {
    return false;
  }

  const sendPromise = geminiLiveRuntime.sendVisionContext({ force, reason });
  sendPromise?.catch?.((error) => {
    log(`Gemini follow vision context failed: ${error.message}`, "warn");
  });
  return sendPromise;
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

  if (ui.objectDetectorModelSelect && detectorStatus.modelPreset) {
    ui.objectDetectorModelSelect.value = detectorStatus.modelPreset;
  }
  if (ui.objectDetectionIntervalSlider && detectorStatus.detectionIntervalMs !== undefined) {
    ui.objectDetectionIntervalSlider.value = String(detectorStatus.detectionIntervalMs);
  }
  if (ui.objectDetectionIntervalValue && detectorStatus.detectionIntervalMs !== undefined) {
    ui.objectDetectionIntervalValue.textContent = `${Math.round(Number(detectorStatus.detectionIntervalMs))} ms`;
  }
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
  if (ui.objectDetectorQuality) {
    ui.objectDetectorQuality.textContent = [
      detectorStatus.modelQuality,
      detectorStatus.modelInputShape,
      detectorStatus.modelQuantization
    ].filter(Boolean).join(" · ") || "--";
  }
  if (ui.objectDetectorParams) {
    ui.objectDetectorParams.textContent = [
      detectorStatus.detectionIntervalMs ? `${Math.round(detectorStatus.detectionIntervalMs)} ms` : null,
      detectorStatus.scoreThreshold !== undefined ? `threshold ${Number(detectorStatus.scoreThreshold).toFixed(2)}` : null,
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
  if (ui.visibleObjectLabels) {
    ui.visibleObjectLabels.textContent = context.visibleLabels || "--";
  }
  if (ui.visionMetadataPreview) {
    ui.visionMetadataPreview.textContent = JSON.stringify(context, null, 2);
  }
  if (ui.activeFollowTarget) {
    ui.activeFollowTarget.textContent = activeTarget?.label
      ? `${activeTarget.label} · ${activeTarget.visible ? "visible" : "not visible"}`
      : "--";
  }
  if (ui.followScenarioState) {
    ui.followScenarioState.textContent = context.scenario?.state ?? "idle";
  }
  if (ui.followControllerState) {
    ui.followControllerState.textContent = followStatus.running
      ? `running · motion ${followStatus.motionAllowed ? "allowed" : "held"}`
      : "stopped";
  }
  if (ui.objectScoreThresholdValue && detectorStatus.scoreThreshold !== undefined) {
    ui.objectScoreThresholdValue.textContent = Number(detectorStatus.scoreThreshold).toFixed(2);
  }
  drawObjectDetectionOverlays(objectDetectorEngine?.lastResult?.detections ?? []);
}

function drawObjectDetectionOverlays(detections = []) {
  drawObjectDetectionOverlay(ui.objectDetectionOverlay, detections);
  drawObjectDetectionOverlay(ui.localVisionOverlay, detections);
}

function drawObjectDetectionOverlay(canvas, detections = []) {
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width || canvas.clientWidth || 0);
  const height = Math.round(rect.height || canvas.clientHeight || 0);
  if (width <= 0 || height <= 0) {
    return;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  detections.slice(0, 12).forEach((detection) => {
    const bbox = detection.bbox ?? {};
    const frameWidth = Number(objectDetectorEngine?.lastResult?.frameWidth || ui.cameraPreview?.videoWidth || width);
    const frameHeight = Number(objectDetectorEngine?.lastResult?.frameHeight || ui.cameraPreview?.videoHeight || height);
    const scale = Math.max(width / Math.max(1, frameWidth), height / Math.max(1, frameHeight));
    const renderedWidth = frameWidth * scale;
    const renderedHeight = frameHeight * scale;
    const offsetX = (width - renderedWidth) / 2;
    const offsetY = (height - renderedHeight) / 2;
    const x = Number(bbox.x || 0) * scale + offsetX;
    const y = Number(bbox.y || 0) * scale + offsetY;
    const boxWidth = Number(bbox.width || 0) * scale;
    const boxHeight = Number(bbox.height || 0) * scale;
    const label = `${detection.label} ${Math.round(Number(detection.confidence || 0) * 100)}% · ${detection.position}/${detection.distance}`;

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

function setupVoiceList() {
  if (!voiceOutput?.isSupported?.()) {
    ui.voiceSelect.replaceChildren(new Option("Speech synthesis unavailable", ""));
    return;
  }

  const populate = () => {
    const voices = voiceOutput.getVoices();
    ui.voiceSelect.replaceChildren(new Option("Default voice", ""));

    voices.forEach((voice) => {
      const label = `${voice.name}${voice.lang ? ` (${voice.lang})` : ""}`;
      ui.voiceSelect.append(new Option(label, voice.name));
    });
  };

  populate();

  if (globalThis.speechSynthesis) {
    globalThis.speechSynthesis.onvoiceschanged = populate;
  }
}

function isGeminiLivePrimary() {
  return Boolean(activeConfig.geminiLiveEnabled && geminiLiveRuntime);
}

function getExecutionPolicy() {
  return {
    source: "local",
    localMotionArmed: brainPolicy.localMotionArmed,
    localCameraAllowed: brainPolicy.localCameraAllowed,
    localSpeechAllowed: brainPolicy.localSpeechAllowed,
    localVisionEnabled: brainPolicy.localVisionEnabled,
    followModeArmed: brainPolicy.followModeArmed,
    allowFollowMovement: brainPolicy.allowFollowMovement,
    followLostTimeoutMs: brainPolicy.followLostTimeoutMs,
    maxObjectFollowSpeed: brainPolicy.maxObjectFollowSpeed,
    simulatorMode,
    robotConnected: Boolean(robotClient?.isConnected?.()),
    allowSpeak: brainPolicy.localSpeechAllowed,
    allowNonPhysical: true,
    cloudMotionArmed: false,
    cloudCameraAllowed: false
  };
}

function getStatusSnapshot() {
  const lifeState = lifeEngine?.getState?.() ?? {};

  return {
    localFirstMode: true,
    localPolicy: getPolicy(),
    attention: attentionSystem?.getStatus?.() ?? null,
    speechGate: speechGate?.getStatus?.() ?? null,
    simulatorMode,
    localBrainRunning: Boolean(localBrainEngine?.isRunning?.()),
    geminiLive: geminiLiveRuntime?.getStatus?.() ?? null,
    looiModeEnabled,
    sequenceStatus: {
      current: scenarioFrameSequencer?.getCurrentSequence?.() ?? null,
      running: Boolean(scenarioFrameSequencer?.isRunning?.())
    },
    performanceStatus: performanceMonitor?.getStatus?.() ?? null,
    robotConnected: Boolean(robotClient?.isConnected?.()),
    connectionState: ui.connectionState.textContent,
    lifeState: {
      mood: lifeState.mood,
      energy: lifeState.energy,
      boredom: lifeState.boredom,
      fear: lifeState.fear,
      curiosity: lifeState.curiosity,
      affection: lifeState.affection,
      loneliness: lifeState.loneliness,
      comfort: lifeState.comfort,
      attentionTarget: lifeState.attentionTarget,
      userVisible: lifeState.userVisible,
      userDistance: lifeState.userDistance,
      userPosition: lifeState.userPosition,
      isSpeaking: lifeState.isSpeaking,
      isListening: lifeState.isListening,
      battery: lifeState.battery,
      obstacle: lifeState.obstacle,
      currentBehavior: lifeState.currentBehavior,
      interactionCount: lifeState.interactionCount,
      stopRespectUntil: lifeState.stopRespectUntil,
      connectionState: lifeState.connectionState,
      robotMotorState: lifeState.robotMotorState
    },
    personality: describePersonalityForRuntime(personalityTuning?.getProfile?.()),
    lifeSignals: {
      loneliness: lifeState.loneliness,
      comfort: lifeState.comfort,
      interactionCount: lifeState.interactionCount,
      stopRespectActive: Number(lifeState.stopRespectUntil || 0) > Date.now(),
      lifeEventsEnabled
    },
    telemetry: robotClient?.getLatestTelemetry?.() ?? null,
    latestAction: latestActionResult,
    calibration: bodyCalibration?.getSettings?.() ?? null,
    recentCommands: commandQueue?.getRecentCommands?.({ limit: 5 }) ?? [],
    camera: compactCameraStatus(cameraInput?.getCameraStatus?.()),
    vision: getVisionContext(),
    recentObjectReference,
    voice: {
      speechListening: Boolean(speechInput?.getStatus?.().listening),
      alwaysListening: Boolean(speechInput?.getStatus?.().alwaysListening),
      geminiLive: geminiLiveRuntime?.getStatus?.() ?? null,
      speechSupported: Boolean(speechInput?.isSupported?.()),
      voiceOutputSupported: Boolean(voiceOutput?.isSupported?.()),
      voiceMuted: Boolean(voiceOutput?.getStatus?.().muted),
      isSpeaking: Boolean(voiceOutput?.isSpeaking?.()),
      lastTranscript
    },
    browserTime: new Date().toISOString()
  };
}

function getRuntimeContext() {
  const lifeState = lifeEngine?.getState?.() ?? null;
  const cameraStatus = compactCameraStatus(cameraInput?.getCameraStatus?.());

  return {
    lifeState,
    latestTelemetry: robotClient?.getLatestTelemetry?.() ?? null,
    robotTelemetry: robotClient?.getLatestTelemetry?.() ?? null,
    connectionState: ui.connectionState.textContent,
    simulatorMode,
    robotConnected: Boolean(robotClient?.isConnected?.()),
    localPolicy: getPolicy(),
    attention: attentionSystem?.getStatus?.() ?? null,
    speechGate: speechGate?.getStatus?.() ?? null,
    sequenceStatus: {
      current: scenarioFrameSequencer?.getCurrentSequence?.() ?? null,
      history: scenarioFrameSequencer?.getHistory?.({ limit: 5 }) ?? []
    },
    performanceStatus: performanceMonitor?.getStatus?.() ?? null,
    reliabilityStatus: reliabilityManager?.getStatus?.() ?? null,
    audioActivity: audioLevelMonitor?.getStatus?.() ?? null,
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
    speechStatus: speechInput?.getStatus?.() ?? null,
    voiceStatus: voiceOutput?.getStatus?.() ?? null,
    voice: getStatusSnapshot().voice,
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

function loadUseFinalSpeechOnly() {
  try {
    return globalThis.localStorage?.getItem?.(SPEECH_FINAL_ONLY_STORAGE_KEY) === "true";
  } catch {
    return false;
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

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function formatNumber(value) {
  return Number(value).toFixed(2);
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
