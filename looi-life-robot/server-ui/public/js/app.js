import { PUBLIC_CONFIG } from "./config.js";
import { LocalEventBus } from "./core/localEventBus.js";
import { AttentionMotorController } from "./embodiment/attentionMotorController.js";
import { EmbodiedActionRouter } from "./embodiment/embodiedActionRouter.js";
import { IdleMicroBehavior } from "./embodiment/idleMicroBehavior.js";
import { MotionMacroSequencer } from "./embodiment/motionMacroSequencer.js";
import { PriorityScheduler } from "./embodiment/priorityScheduler.js";
import { LifeEngine } from "./life/lifeEngine.js";
import { LocalBrainEngine } from "./localBrain/localBrainEngine.js";
import { LocalServerBrainAdapter } from "./localBrain/localServerBrainAdapter.js";
import { MockBrainAdapter } from "./localBrain/mockBrainAdapter.js";
import { RuleBrainFallback } from "./localBrain/ruleBrainFallback.js";
import { AttentionSystem } from "./localBrain/attentionSystem.js";
import { AutonomousScheduler } from "./localBrain/autonomousScheduler.js";
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
import { FollowTargetController } from "./vision/followTargetController.js";
import { VisionScenarioManager } from "./vision/visionScenarioManager.js";
import { buildVisionContext, findMentionedObjectLabels } from "./vision/visionMetadataBuilder.js";
import { getObjectAliases } from "./vision/objectLabelUtils.js";

const DEFAULT_SPEED = 0.2;
const DEFAULT_DURATION_MS = 400;
const LOCAL_VISION_SIZE_STORAGE_KEY = "looi.localVisionWidgetSizePx.v2";
const LOCAL_VISION_SIZE_MIN = 70;
const LOCAL_VISION_SIZE_MAX = 220;
const LOCAL_VISION_SIZE_STEP = 10;
const SPEECH_FINAL_ONLY_STORAGE_KEY = "looi.useFinalSpeechOnly.v1";
const INTERIM_STABILITY_MS = 300;
const MEDIA_PIPE_LOG_LIMIT = 30;

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
  autonomousSchedulerState: document.getElementById("autonomousSchedulerState"),
  lastAutonomousReason: document.getElementById("lastAutonomousReason"),
  cameraSupportState: document.getElementById("cameraSupportState"),
  cameraSecureWarning: document.getElementById("cameraSecureWarning"),
  cameraRunningState: document.getElementById("cameraRunningState"),
  cameraFacingMode: document.getElementById("cameraFacingMode"),
  cameraLastError: document.getElementById("cameraLastError"),
  cameraVisionSupport: document.getElementById("cameraVisionSupport"),
  startFrontCameraButton: document.getElementById("startFrontCameraButton"),
  startBackCameraButton: document.getElementById("startBackCameraButton"),
  switchCameraButton: document.getElementById("switchCameraButton"),
  stopCameraButton: document.getElementById("stopCameraButton"),
  captureSnapshotButton: document.getElementById("captureSnapshotButton"),
  cameraPreview: document.getElementById("cameraPreview"),
  cameraObjectOverlay: document.getElementById("cameraObjectOverlay"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  snapshotPreview: document.getElementById("snapshotPreview"),
  cameraUserVisible: document.getElementById("cameraUserVisible"),
  cameraUserPosition: document.getElementById("cameraUserPosition"),
  cameraUserDistance: document.getElementById("cameraUserDistance"),
  cameraFaceCount: document.getElementById("cameraFaceCount"),
  cameraLastObservation: document.getElementById("cameraLastObservation"),
  cameraObjectCount: document.getElementById("cameraObjectCount"),
  cameraObjectLabels: document.getElementById("cameraObjectLabels"),
  cameraVisionMetadataAge: document.getElementById("cameraVisionMetadataAge"),
  cameraMediaPipeQuality: document.getElementById("cameraMediaPipeQuality"),
  cameraMediaPipeModel: document.getElementById("cameraMediaPipeModel"),
  cameraMediaPipeSettings: document.getElementById("cameraMediaPipeSettings"),
  cameraVisionMetadataSafety: document.getElementById("cameraVisionMetadataSafety"),
  cameraVisionMetadataPreview: document.getElementById("cameraVisionMetadataPreview"),
  mediaPipeDetectionLog: document.getElementById("mediaPipeDetectionLog"),
  objectDetectorState: document.getElementById("objectDetectorState"),
  objectDetectorModel: document.getElementById("objectDetectorModel"),
  objectDetectionInterval: document.getElementById("objectDetectionInterval"),
  objectDetectionLastRun: document.getElementById("objectDetectionLastRun"),
  objectDetectionError: document.getElementById("objectDetectionError"),
  objectDetectorModelSelect: document.getElementById("objectDetectorModelSelect"),
  objectDetectorModelHelp: document.getElementById("objectDetectorModelHelp"),
  startObjectDetectionButton: document.getElementById("startObjectDetectionButton"),
  stopObjectDetectionButton: document.getElementById("stopObjectDetectionButton"),
  objectDetectionIntervalSlider: document.getElementById("objectDetectionIntervalSlider"),
  objectDetectionIntervalValue: document.getElementById("objectDetectionIntervalValue"),
  objectScoreThresholdSlider: document.getElementById("objectScoreThresholdSlider"),
  objectScoreThresholdValue: document.getElementById("objectScoreThresholdValue"),
  objectMaxResultsSlider: document.getElementById("objectMaxResultsSlider"),
  objectMaxResultsValue: document.getElementById("objectMaxResultsValue"),
  objectCategoryAllowlistInput: document.getElementById("objectCategoryAllowlistInput"),
  visibleObjectList: document.getElementById("visibleObjectList"),
  visionSummary: document.getElementById("visionSummary"),
  followTargetLabelInput: document.getElementById("followTargetLabelInput"),
  setFollowTargetButton: document.getElementById("setFollowTargetButton"),
  stopFollowingButton: document.getElementById("stopFollowingButton"),
  clearFollowTargetButton: document.getElementById("clearFollowTargetButton"),
  followScenarioState: document.getElementById("followScenarioState"),
  activeFollowTarget: document.getElementById("activeFollowTarget"),
  followTargetVisible: document.getElementById("followTargetVisible"),
  followTargetPosition: document.getElementById("followTargetPosition"),
  followTargetDistance: document.getElementById("followTargetDistance"),
  followTargetLostFor: document.getElementById("followTargetLostFor"),
  followControllerState: document.getElementById("followControllerState"),
  localBrainState: document.getElementById("localBrainState"),
  localBrainAdapterState: document.getElementById("localBrainAdapterState"),
  localBrainServerStatus: document.getElementById("localBrainServerStatus"),
  localBrainProvider: document.getElementById("localBrainProvider"),
  localBrainModel: document.getElementById("localBrainModel"),
  localBrainLatency: document.getElementById("localBrainLatency"),
  localBrainLastThought: document.getElementById("localBrainLastThought"),
  localBrainThoughtList: document.getElementById("localBrainThoughtList"),
  localBrainEnabledToggle: document.getElementById("localBrainEnabledToggle"),
  autonomousModeToggle: document.getElementById("autonomousModeToggle"),
  localMotionArmedToggle: document.getElementById("localMotionArmedToggle"),
  localCameraAllowedToggle: document.getElementById("localCameraAllowedToggle"),
  localSpeechAllowedToggle: document.getElementById("localSpeechAllowedToggle"),
  allowAutonomousMovementToggle: document.getElementById("allowAutonomousMovementToggle"),
  allowAutonomousSpeechToggle: document.getElementById("allowAutonomousSpeechToggle"),
  followModeArmedToggle: document.getElementById("followModeArmedToggle"),
  allowFollowMovementToggle: document.getElementById("allowFollowMovementToggle"),
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
  scenarioStopButton: document.getElementById("scenarioStopButton"),
  scenarioBoredButton: document.getElementById("scenarioBoredButton"),
  scenarioLowEnergyButton: document.getElementById("scenarioLowEnergyButton"),
  scenarioObstacleButton: document.getElementById("scenarioObstacleButton"),
  scenarioClearObstacleButton: document.getElementById("scenarioClearObstacleButton"),
  currentMacroState: document.getElementById("currentMacroState"),
  macroHistoryList: document.getElementById("macroHistoryList"),
  schedulerState: document.getElementById("schedulerState"),
  currentPriorityTask: document.getElementById("currentPriorityTask"),
  looiModeToggle: document.getElementById("looiModeToggle"),
  idleMicroBehaviorToggle: document.getElementById("idleMicroBehaviorToggle"),
  attentionBodyTrackingToggle: document.getElementById("attentionBodyTrackingToggle"),
  keepRobotAwakeToggle: document.getElementById("keepRobotAwakeToggle"),
  testMacroSoftListenButton: document.getElementById("testMacroSoftListenButton"),
  testMacroThinkingPoseButton: document.getElementById("testMacroThinkingPoseButton"),
  testMacroCuriousScanButton: document.getElementById("testMacroCuriousScanButton"),
  testMacroHappyApproachButton: document.getElementById("testMacroHappyApproachButton"),
  testMacroShyRetreatButton: document.getElementById("testMacroShyRetreatButton"),
  testMacroExcitedWiggleButton: document.getElementById("testMacroExcitedWiggleButton"),
  testMacroSleepyIdleButton: document.getElementById("testMacroSleepyIdleButton"),
  testMacroUserReturnedButton: document.getElementById("testMacroUserReturnedButton"),
  macroStopButton: document.getElementById("macroStopButton"),
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
let autonomousScheduler = null;
let brainLatencyBudget = null;
let macroSequencer = null;
let priorityScheduler = null;
let embodiedActionRouter = null;
let idleMicroBehavior = null;
let attentionMotorController = null;
let wakeLockManager = null;
let performanceMonitor = null;
let reliabilityManager = null;
let speechInput = null;
let voiceOutput = null;
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
let lastObjectDetectionResult = null;
let recentObjectReference = null;
let mediaPipeDetectionLogs = [];
let learnedPhraseCache = [];
let lifeEventsEnabled = false;
let settingsOpen = false;
let audioActivityClearTimer = null;
let interimSpeechTimer = null;
let latestInterimSpeech = null;
let bestInterimSpeech = null;
let lastInterimDispatchedText = "";
let lastInterimDispatchedAt = 0;
let useFinalSpeechOnly = loadUseFinalSpeechOnly();
let looiModeEnabled = false;
let idleMicroBehaviorEnabled = true;
let attentionBodyTrackingEnabled = false;
let keepRobotAwakeEnabled = false;
let localVisionWidgetSizePx = loadLocalVisionWidgetSize();
let lastLogSignature = "";
const QUIET_IDLE_MACROS = new Set(["soft_idle", "soft_recenter", "thinking_pose"]);

face = createFaceController(ui.canvas);
face.setExpression("neutral");
face.setEyeDirection("center");
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
renderMediaPipeDetectionLog();
updateCalibrationUi();
updatePersonalityUi();
updateLifeEventsUi();
updateProductionChrome();

ui.productionStartButton.addEventListener("click", () => {
  startProductionRuntime().catch((error) => {
    log(`Local runtime start failed: ${error.message}`, "error");
    face.setExpression("scared");
  });
});

ui.localBrainQuickButton.addEventListener("click", () => {
  startLocalBrainProductionMode().catch((error) => {
    log(`Local Brain start failed: ${error.message}`, "error");
    face.setExpression("scared");
  });
});

ui.productionStopButton.addEventListener("click", async () => {
  await emergencyStop("production_top_stop", "Emergency stop sent from production controls.", "error");
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
  await emergencyStop("calibration_test_stop", "Calibration stop sent.", "error");
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
  runCalibrationLifeTest("excited_wiggle", { intensity: 0.45 });
});

ui.calibrationTestApproachButton.addEventListener("click", () => {
  runCalibrationLifeTest("approach_user", { style: "gentle", distance: "tiny" });
});

ui.calibrationTestRetreatButton.addEventListener("click", () => {
  runCalibrationLifeTest("retreat", { style: "gentle", distance: "tiny" });
});

ui.localBrainEnabledToggle.addEventListener("change", () => {
  patchBrainPolicy({ localBrainEnabled: ui.localBrainEnabledToggle.checked });
});

ui.autonomousModeToggle.addEventListener("change", () => {
  patchBrainPolicy({ autonomousMode: ui.autonomousModeToggle.checked });
  syncAutonomousScheduler();
  log(
    brainPolicy.autonomousMode
      ? "Autonomous Mode enabled. Motion remains blocked unless Local Motion and Autonomous Movement are both armed."
      : "Autonomous Mode disabled."
  );
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

ui.allowAutonomousMovementToggle.addEventListener("change", () => {
  patchBrainPolicy({ allowAutonomousMovement: ui.allowAutonomousMovementToggle.checked });
  log(
    brainPolicy.allowAutonomousMovement
      ? "Autonomous Movement allowed, but only while Local Motion is armed."
      : "Autonomous Movement disabled."
  );
});

ui.allowAutonomousSpeechToggle.addEventListener("change", () => {
  patchBrainPolicy({ allowAutonomousSpeech: ui.allowAutonomousSpeechToggle.checked });
});

ui.followModeArmedToggle?.addEventListener("change", () => {
  patchBrainPolicy({ followModeArmed: ui.followModeArmedToggle.checked });
  log(
    brainPolicy.followModeArmed
      ? "Follow Mode armed. Target following still requires Local Motion, Allow Follow Movement, and a connected robot."
      : "Follow Mode disarmed."
  );
});

ui.allowFollowMovementToggle?.addEventListener("change", () => {
  patchBrainPolicy({ allowFollowMovement: ui.allowFollowMovementToggle.checked });
  log(
    brainPolicy.allowFollowMovement
      ? "Follow movement allowed while follow mode and local motion are armed."
      : "Follow movement disabled."
  );
});

ui.startLocalBrainButton.addEventListener("click", () => {
  primeLiveInputsFromUserGesture();
  startLocalBrainProductionMode().catch((error) => {
    log(`Local Brain live startup failed: ${error.message}`, "error");
    face.setExpression("scared");
  });
});

ui.stopLocalBrainButton.addEventListener("click", () => {
  localBrainEngine?.stop?.();
  autonomousScheduler?.stop?.();
  updateLocalBrainUi();
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

ui.startObjectDetectionButton?.addEventListener("click", () => {
  startObjectDetection({ source: "ui" }).catch((error) => {
    log(`Object detection start failed: ${error.message}`, "error");
  });
});

ui.stopObjectDetectionButton?.addEventListener("click", () => {
  stopObjectDetection("ui_stop");
});

ui.objectDetectorModelSelect?.addEventListener("change", () => {
  const presetKey = ui.objectDetectorModelSelect.value;
  const preset = OBJECT_DETECTOR_MODEL_PRESETS[presetKey];

  if (!preset || !objectDetectorEngine) {
    return;
  }

  pushMediaPipeLog({
    type: "model_change",
    message: `Switching detector model to ${preset.label}.`
  });
  objectDetectorEngine
    .setModelAssetPath?.(preset.url, {
      modelPreset: presetKey,
      modelName: preset.label
    })
    .then(() => {
      updateObjectVisionUi();
      updateCameraVisionMetadataUi();
    })
    .catch((error) => {
      pushMediaPipeLog({
        type: "error",
        message: `Model switch failed: ${error.message}`
      });
      log(`Object detector model switch failed: ${error.message}`, "warn");
    });
});

ui.objectDetectionIntervalSlider?.addEventListener("input", () => {
  const intervalMs = Number(ui.objectDetectionIntervalSlider.value);
  objectDetectorEngine?.setDetectionIntervalMs?.(intervalMs);
  patchBrainPolicy({ objectDetectionIntervalMs: intervalMs });
  pushMediaPipeLog({
    type: "config",
    message: `Detection interval set to ${intervalMs} ms.`
  });
  updateObjectVisionUi();
});

ui.objectScoreThresholdSlider?.addEventListener("input", () => {
  const threshold = Number(ui.objectScoreThresholdSlider.value);
  objectDetectorEngine?.setScoreThreshold?.(threshold);
  pushMediaPipeLog({
    type: "config",
    message: `Score threshold set to ${threshold.toFixed(2)}.`
  });
  updateObjectVisionUi();
});

ui.objectMaxResultsSlider?.addEventListener("input", () => {
  const maxResults = Number(ui.objectMaxResultsSlider.value);
  objectDetectorEngine?.setMaxResults?.(maxResults);
  pushMediaPipeLog({
    type: "config",
    message: `Max results set to ${maxResults}.`
  });
  updateObjectVisionUi();
});

ui.objectCategoryAllowlistInput?.addEventListener("change", () => {
  const allowlist = objectDetectorEngine?.setCategoryAllowlist?.(ui.objectCategoryAllowlistInput.value) ?? [];
  pushMediaPipeLog({
    type: "config",
    message: `Category allowlist ${allowlist.length ? allowlist.join(", ") : "cleared"}.`
  });
  updateObjectVisionUi();
});

ui.setFollowTargetButton?.addEventListener("click", () => {
  const label = ui.followTargetLabelInput?.value?.trim();
  if (!label) {
    log("Follow target label is empty.", "warn");
    return;
  }

  visionScenarioManager?.startFollowTarget?.({ label, mode: "gentle" });
});

ui.stopFollowingButton?.addEventListener("click", () => {
  visionScenarioManager?.stopFollowing?.("ui_stop_following");
  updateObjectVisionUi();
});

ui.clearFollowTargetButton?.addEventListener("click", () => {
  visionScenarioManager?.stopFollowing?.("ui_clear_target");
  recentObjectReference = null;
  updateObjectVisionUi();
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
    face.setExpression("scared");
  }
});

ui.disconnectEsp32Button.addEventListener("click", async () => {
  if (!robotClient) {
    log("Robot client is still initializing.", "warn");
    return;
  }

  if (commandQueue) {
    await commandQueue.emergencyStop(simulatorMode ? "simulator_disconnect" : "ui_disconnect");
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
  await emergencyStop("ui_emergency_stop", "Emergency stop sent. Verify motors stopped.");
});

ui.manualStopButton.addEventListener("click", async () => {
  await emergencyStop("manual_stop", "Manual stop sent.", "info");
});

ui.moveForwardButton.addEventListener("click", () => {
  queueManualMotion({
    linear: getSpeedSetting(),
    angular: 0,
    label: "manual_forward"
  });
});

ui.moveBackwardButton.addEventListener("click", () => {
  queueManualMotion({
    linear: -getSpeedSetting(),
    angular: 0,
    label: "manual_backward"
  });
});

ui.rotateLeftButton.addEventListener("click", () => {
  queueManualMotion({
    linear: 0,
    angular: -getSpeedSetting(),
    label: "manual_rotate_left"
  });
});

ui.rotateRightButton.addEventListener("click", () => {
  queueManualMotion({
    linear: 0,
    angular: getSpeedSetting(),
    label: "manual_rotate_right"
  });
});

ui.happyButton.addEventListener("click", () => {
  requestLifeBehavior("excited_wiggle", { intensity: 0.6 });
});

ui.curiousButton.addEventListener("click", () => {
  requestLifeBehavior("curious_scan", { direction: "both", intensity: 0.5 });
});

ui.wiggleButton.addEventListener("click", () => {
  requestLifeBehavior("excited_wiggle", { intensity: 0.8 });
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
  lifeEngine?.requestBehavior("listen_pose").catch((error) => {
    log(`Attention simulation failed: ${error.message}`, "warn");
  });
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
  runBoredScenario("Simulated boredom and curiosity.");
});

ui.simulateLowEnergyButton.addEventListener("click", () => {
  runLowEnergyScenario("Simulated low energy.");
});

ui.scenarioComeHereButton.addEventListener("click", () => {
  log("Scenario: Come Here");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "come here"
  });
  requestLifeBehavior("approach_user", {
    style: "happy",
    distance: "short"
  });
});

ui.scenarioGiveMeSpaceButton.addEventListener("click", () => {
  log("Scenario: Give Me Space");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "give me space"
  });
  requestLifeBehavior("retreat", {
    style: "gentle",
    distance: "short"
  });
});

ui.scenarioLookAroundButton.addEventListener("click", () => {
  log("Scenario: Look Around");
  lifeEngine?.receiveEvent({
    type: "user_text",
    text: "look around"
  });
  requestLifeBehavior("curious_scan", {
    direction: "both",
    intensity: 0.7
  });
});

ui.scenarioStopButton.addEventListener("click", async () => {
  log("Scenario: Stop / Freeze");
  await emergencyStop("scenario_stop", "Scenario stop sent.", "error");
});

ui.scenarioBoredButton.addEventListener("click", () => {
  log("Scenario: Ignored / Bored");
  runBoredScenario("Scenario boredom injected.");
});

ui.scenarioLowEnergyButton.addEventListener("click", () => {
  log("Scenario: Low Energy");
  runLowEnergyScenario("Scenario low energy injected.");
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
    idleMicroBehaviorEnabled = ui.idleMicroBehaviorToggle?.checked ?? idleMicroBehaviorEnabled;
    idleMicroBehaviorEnabled ? idleMicroBehavior?.start?.() : idleMicroBehavior?.stop?.();
    attentionMotorController?.start?.();
    reliabilityManager?.start?.();
  } else {
    idleMicroBehavior?.stop?.();
    attentionMotorController?.stop?.();
  }
  updateEmbodimentUi();
  log(looiModeEnabled ? "LOOI Mode enabled. Motion safety gates are unchanged." : "LOOI Mode disabled.");
});

ui.idleMicroBehaviorToggle?.addEventListener("change", () => {
  idleMicroBehaviorEnabled = ui.idleMicroBehaviorToggle.checked;
  if (looiModeEnabled && idleMicroBehaviorEnabled) {
    idleMicroBehavior?.start?.();
  } else {
    idleMicroBehavior?.stop?.();
  }
  updateEmbodimentUi();
});

ui.attentionBodyTrackingToggle?.addEventListener("change", () => {
  attentionBodyTrackingEnabled = ui.attentionBodyTrackingToggle.checked;
  attentionMotorController?.setBodyTrackingEnabled?.(attentionBodyTrackingEnabled);
  updateEmbodimentUi();
  log(
    attentionBodyTrackingEnabled
      ? "Attention body tracking enabled. It still requires Local Motion Armed and Autonomous Movement."
      : "Attention body tracking disabled."
  );
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

bindMacroButton(ui.testMacroSoftListenButton, "soft_listen", { allowMotion: false });
bindMacroButton(ui.testMacroThinkingPoseButton, "thinking_pose", { allowMotion: false });
bindMacroButton(ui.testMacroCuriousScanButton, "curious_scan");
bindMacroButton(ui.testMacroHappyApproachButton, "happy_approach");
bindMacroButton(ui.testMacroShyRetreatButton, "shy_retreat");
bindMacroButton(ui.testMacroExcitedWiggleButton, "excited_wiggle");
bindMacroButton(ui.testMacroSleepyIdleButton, "sleepy_idle", { allowMotion: false });
bindMacroButton(ui.testMacroUserReturnedButton, "user_returned_greeting");

ui.macroStopButton?.addEventListener("click", async () => {
  await emergencyStop("macro_panel_stop", "Macro stop sent.", "error");
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
});

init();

async function init() {
  activeConfig = await loadPublicConfig();
  brainPolicy = clampBrainPolicy({
    ...createDefaultBrainPolicy(),
    localBrainEnabled: activeConfig.localBrainDefaultEnabled ?? true,
    autonomousMode: activeConfig.localBrainAutonomousDefault ?? false,
    minAutonomousThoughtIntervalMs:
      activeConfig.localBrainThoughtIntervalMs ??
      PUBLIC_CONFIG.localBrainThoughtIntervalMs ??
      4000,
    maxThoughtsPerMinute:
      activeConfig.localBrainMaxThoughtsPerMinute ??
      PUBLIC_CONFIG.localBrainMaxThoughtsPerMinute ??
      12,
    eventThoughtCooldownMs:
      activeConfig.speechGateEventCooldownMs ??
      PUBLIC_CONFIG.speechGateEventCooldownMs ??
      createDefaultBrainPolicy().eventThoughtCooldownMs,
    localVisionEnabled: activeConfig.localVisionEnabled ?? PUBLIC_CONFIG.localVisionEnabled ?? true,
    objectDetectionEnabledDefault:
      activeConfig.objectDetectionEnabledDefault ??
      PUBLIC_CONFIG.objectDetectionEnabledDefault ??
      false,
    objectDetectionIntervalMs:
      activeConfig.objectDetectionIntervalMs ??
      PUBLIC_CONFIG.objectDetectionIntervalMs ??
      1000,
    followLostTimeoutMs:
      activeConfig.followLostTimeoutMs ??
      PUBLIC_CONFIG.followLostTimeoutMs ??
      2000,
    maxObjectFollowSpeed:
      activeConfig.maxObjectFollowSpeed ??
      PUBLIC_CONFIG.maxObjectFollowSpeed ??
      0.18
  });
  const wakeNames = Array.isArray(activeConfig.wakeNamesDefault)
    ? activeConfig.wakeNamesDefault
    : PUBLIC_CONFIG.wakeNamesDefault;
  ui.wakeNamesInput.value = parseWakeNames(wakeNames).join(",");
  ui.alwaysListeningToggle.checked = Boolean(activeConfig.alwaysListeningDefault);
  ui.audioLevelMonitorToggle.checked = Boolean(activeConfig.audioLevelMonitorDefault);
  looiModeEnabled = Boolean(activeConfig.looiModeDefault);
  idleMicroBehaviorEnabled = activeConfig.idleMicroBehaviorDefault !== false;
  attentionBodyTrackingEnabled = Boolean(activeConfig.attentionBodyTrackingDefault);
  keepRobotAwakeEnabled = Boolean(activeConfig.keepRobotAwakeDefault);
  if (ui.looiModeToggle) ui.looiModeToggle.checked = looiModeEnabled;
  if (ui.idleMicroBehaviorToggle) ui.idleMicroBehaviorToggle.checked = idleMicroBehaviorEnabled;
  if (ui.attentionBodyTrackingToggle) ui.attentionBodyTrackingToggle.checked = attentionBodyTrackingEnabled;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = keepRobotAwakeEnabled;

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
  localEventBus.subscribe("autonomous_tick", () => {
    updateAlwaysListeningUi();
  });
  ["macro_started", "macro_result", "macro_interrupted"].forEach((type) => {
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
  ["macro_started", "macro_result", "macro_interrupted"].forEach((type) => {
    localEventBus.subscribe(type, traceMacroEvent);
  });
  ["vision_objects_updated", "vision_follow_started", "vision_follow_stopped", "vision_follow_target_set"].forEach((type) => {
    localEventBus.subscribe(type, () => updateObjectVisionUi());
  });
  localEventBus.subscribe("vision_target_lost", () => {
    face?.setVisionIndicator?.(true, "lost");
    updateObjectVisionUi();
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
    eventThoughtTimeoutMs: activeConfig.localBrainEventTimeoutMs ?? 12000,
    autonomousThoughtTimeoutMs: activeConfig.localBrainAutonomousTimeoutMs ?? 20000
  });

  bodyCalibration = new BodyCalibration({
    logger: (message, level = "info") => log(message, level)
  });
  bodyCalibration.load();
  bodyCalibration.onChange((settings) => {
    lifeEngine?.setCalibration?.(bodyCalibration);
    macroSequencer?.setCalibration?.(bodyCalibration);
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
  populateObjectDetectorModelSelect(getConfiguredObjectDetectorModelPreset());
  if (ui.objectDetectionIntervalSlider) {
    ui.objectDetectionIntervalSlider.value = String(brainPolicy.objectDetectionIntervalMs);
  }
  if (ui.objectScoreThresholdSlider) {
    ui.objectScoreThresholdSlider.value = String(
      activeConfig.objectDetectorScoreThreshold ??
      PUBLIC_CONFIG.objectDetectorScoreThreshold ??
      DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD
    );
  }
  if (ui.objectMaxResultsSlider) {
    ui.objectMaxResultsSlider.value = String(
      activeConfig.objectDetectorMaxResults ??
      PUBLIC_CONFIG.objectDetectorMaxResults ??
      DEFAULT_OBJECT_DETECTOR_MAX_RESULTS
    );
  }
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
  macroSequencer = new MotionMacroSequencer({
    face,
    voiceOutput,
    commandQueue,
    lifeEngine,
    calibration: bodyCalibration,
    eventBus: localEventBus,
    logger: (message, level = "info") => log(message, level)
  });
  embodiedActionRouter = new EmbodiedActionRouter({
    macroSequencer,
    priorityScheduler,
    lifeEngine,
    logger: (message, level = "info") => log(message, level)
  });
  lifeEngine.setMacroSequencer?.(macroSequencer);
  lifeEngine.setEmbodiedActionRouter?.(embodiedActionRouter);

  cameraInput = new CameraInput({
    videoElement: ui.cameraPreview,
    canvasElement: ui.cameraCanvas,
    analysisIntervalMs: 500,
    logger: (message, level = "info") => log(message, level)
  });
  cameraInput.onStatus(handleCameraStatus);
  cameraInput.onObservation(handleCameraObservation);
  cameraInput.onSnapshot(handleCameraSnapshot);

  objectTracker = new ObjectTracker({
    maxLostMs: brainPolicy.followLostTimeoutMs,
    logger: (message, level = "info") => log(message, level)
  });
  visionState = new VisionState({
    logger: (message, level = "info") => log(message, level)
  });
  objectDetectorEngine = new ObjectDetectorEngine({
    videoElement: ui.cameraPreview,
    cameraInput,
    modelPreset: getSelectedObjectDetectorModelPreset(),
    modelAssetPath:
      activeConfig.objectDetectorModelAssetPath ??
      PUBLIC_CONFIG.objectDetectorModelAssetPath,
    wasmBasePath:
      activeConfig.objectDetectorWasmBasePath ??
      PUBLIC_CONFIG.objectDetectorWasmBasePath,
    moduleUrl:
      activeConfig.objectDetectorModuleUrl ??
      PUBLIC_CONFIG.objectDetectorModuleUrl,
    detectionIntervalMs: brainPolicy.objectDetectionIntervalMs,
    scoreThreshold: Number(ui.objectScoreThresholdSlider?.value ?? DEFAULT_OBJECT_DETECTOR_SCORE_THRESHOLD),
    maxResults: Number(ui.objectMaxResultsSlider?.value ?? DEFAULT_OBJECT_DETECTOR_MAX_RESULTS),
    logger: (message, level = "info") => log(message, level)
  });
  objectDetectorEngine.onDetections(handleObjectDetections);
  objectDetectorEngine.onStatus((status) => {
    visionState?.setDetectorStatus?.(status);
    updateObjectVisionUi();
  });
  objectDetectorEngine.onError((message) => {
    pushMediaPipeLog({
      type: "error",
      message
    });
    log(`Object detector error: ${message}`, "warn");
    updateObjectVisionUi();
  });
  followTargetController = new FollowTargetController({
    visionState,
    objectTracker,
    lifeEngine,
    commandQueue,
    macroSequencer,
    eventBus: localEventBus,
    voiceOutput,
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
    getPolicy,
    logger: (message, level = "info") => log(message, level)
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
    visionScenarioManager,
    visionState,
    followTargetController,
    objectDetectorEngine,
    logger: (message, level = "info") => log(message, level),
    getRuntimeContext,
    getExecutionPolicy
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

  autonomousScheduler = new AutonomousScheduler({
    eventBus: localEventBus,
    lifeEngine,
    getPolicy,
    getContext: getRuntimeContext,
    tickMs:
      activeConfig.autonomousSchedulerTickMs ??
      PUBLIC_CONFIG.autonomousSchedulerTickMs ??
      1000,
    logger: (message, level = "info") => log(message, level)
  });

  idleMicroBehavior = new IdleMicroBehavior({
    eventBus: localEventBus,
    lifeEngine,
    macroSequencer,
    getPolicy,
    getContext: getRuntimeContext,
    minMs: activeConfig.idleMicroMinMs ?? PUBLIC_CONFIG.idleMicroMinMs ?? 4000,
    maxMs: activeConfig.idleMicroMaxMs ?? PUBLIC_CONFIG.idleMicroMaxMs ?? 12000,
    logger: (message, level = "info") => log(message, level)
  });
  attentionMotorController = new AttentionMotorController({
    lifeEngine,
    macroSequencer,
    eventBus: localEventBus,
    getPolicy,
    logger: (message, level = "info") => log(message, level)
  });
  attentionMotorController.setBodyTrackingEnabled(attentionBodyTrackingEnabled);
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
    idleMicroBehavior,
    autonomousScheduler,
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
    idleMicroBehaviorEnabled ? idleMicroBehavior.start() : idleMicroBehavior.stop();
    attentionMotorController.start();
    reliabilityManager.start();
  }
  if (keepRobotAwakeEnabled) {
    wakeLockManager.request().catch((error) => {
      keepRobotAwakeEnabled = false;
      if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = false;
      log(`Wake lock unavailable: ${error.message}`, "warn");
    });
  }
  syncAutonomousScheduler();
  updateConnectionState(robotClient.getStatus());
  updateLifeEngineToggle();
  updateSimulatorUi();
  updateLocalBrainUi();
  updateVoiceUi();
  updateAlwaysListeningUi();
  updateCameraUi();
  updateObjectVisionUi();
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
    updateObjectVisionUi();
  }, 1000);
  refreshLearnedPhrases().catch((error) => {
    log(`Learned phrase cache unavailable: ${error.message}`, "warn");
  });
  log("UI ready.");
  log("Local-first runtime active. Legacy cloud bridge is inactive in this browser path.");
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

    face.setExpression("scared");
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
  macroSequencer?.setCommandQueue?.(commandQueue);
  macroSequencer?.setLifeEngine?.(lifeEngine);
  if (followTargetController) {
    followTargetController.commandQueue = commandQueue;
    followTargetController.lifeEngine = lifeEngine;
  }
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
    await commandQueue?.emergencyStop?.("switch_to_simulator");
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
    await commandQueue?.emergencyStop?.("switch_to_real_esp32");
    simulatedRobotClient.disconnect();
  }

  simulatorMode = false;
  setActiveRobotClient(realRobotClient);
  lifeEngine?.setConnectionState("disconnected");
  renderTelemetry({});
  updateSimulatorUi();
  log("Simulator mode disabled.");
}

function queueManualMotion({ linear, angular, label }) {
  const calibrationSettings = bodyCalibration?.getSettings?.() ?? {};
  lifeEngine?.receiveEvent({
    type: "manual_test",
    label,
    value: { linear, angular, durationMs: getDurationSetting(), rampMs: calibrationSettings.rampMs }
  });

  if (lifeEngine?.getState?.().obstacle && linear > 0) {
    log(`${label} rejected because obstacle is active. Clear obstacle first.`, "warn");
    return;
  }

  if (!ensureConnected("Movement skipped because no robot client is connected.")) {
    return;
  }

  commandQueue
    .enqueueMotion({
      linear,
      angular,
      durationMs: getDurationSetting(),
      rampMs: calibrationSettings.rampMs,
      label
    })
    .catch((error) => {
      log(`${label} failed: ${error.message}`, "warn");
    });
}

function ensureConnected(message) {
  if (!robotClient?.isConnected()) {
    log(message, "warn");
    return false;
  }

  return true;
}

async function emergencyStop(reason, message, level = "error") {
  if (!commandQueue && !toolExecutor) {
    log("Robot command queue is still initializing.", "warn");
    return;
  }

  voiceOutput?.cancel?.(reason);
  visionScenarioManager?.stopScenario?.(reason);
  macroSequencer?.interrupt?.(reason, 100);
  priorityScheduler?.interruptBelow?.(100, reason);
  priorityScheduler?.clear?.();

  if (toolExecutor) {
    await toolExecutor.emergencyStop(reason);
  } else {
    await commandQueue.emergencyStop(reason);
    lifeEngine?.receiveEvent({ type: "stop", reason });
  }

  face.setExpression(reason === "manual_stop" ? "attentive" : "scared");
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

  const source = transcript.source === "typed"
    ? "typed"
    : transcript.source === "speech_interim"
      ? "speech_interim"
      : "speech";
  const eventType = source === "typed" ? "user_text" : "user_speech";

  if (await handleLocalVisionControlPhrase(text)) {
    updateAlwaysListeningUi();
    updateLocalBrainUi();
    return {
      event: null,
      gateResult: {
        accepted: true,
        shouldTriggerBrain: false,
        shouldImmediateStop: false,
        classification: "vision_control"
      }
    };
  }

  updateRecentObjectReferenceFromText(text);
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
    lifeEngine?.requestBehavior("listen_pose").catch((error) => {
      log(`Attentive reaction failed: ${error.message}`, "warn");
    });
    if (looiModeEnabled) {
      macroSequencer?.playMacro?.("soft_listen", {
        source: "speech_gate",
        priority: 80,
        allowMotion: false,
        allowSpeech: false,
        reason: gateResult.classification
      }).catch?.((error) => log(`Soft listen macro failed: ${error.message}`, "warn"));
    }
  }

  if (gateResult.shouldOpenAttention) {
    attentionSystem?.wake?.(gateResult.reason, activeConfig.attentionWindowMs ?? 20000);
    face.setExpression("attentive", 1);
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
    attentionSystem?.enterStopCooldown?.(
      "local_voice_stop",
      brainPolicy.stopRespectCooldownMs ?? 8000
    );
    await emergencyStop(
      source === "typed" ? "local_typed_stop" : "local_voice_stop",
      source === "typed"
        ? "Local typed stop phrase detected."
        : "Local voice stop phrase detected.",
      "error"
    );
  } else if (!gateResult.accepted) {
    log(`Ignored ${source}: ${text} (${gateResult.classification})`);
  } else if (gateResult.shouldTriggerBrain && looiModeEnabled) {
    macroSequencer?.playMacro?.("thinking_pose", {
      source: "speech_gate",
      priority: 45,
      allowMotion: false,
      allowSpeech: false,
      reason: "brain_thought_pending"
    }).catch?.(() => {});
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
  handleCameraStatus(result.status ?? cameraInput?.getCameraStatus?.());

  if (result.status && !result.status.running) {
    stopObjectDetection("camera_stopped");
    visionScenarioManager?.stopFollowing?.("camera_stopped");
  }

  if (result.status?.running && objectDetectorEngine?.isRunning?.()) {
    const detectPromise = objectDetectorEngine.detectOnce?.();
    detectPromise?.catch?.(() => {});
  }

  if (result.ok) {
    log("Camera command completed.");
    return;
  }

  if (result.error) {
    log(`Camera command failed: ${result.error}`, "warn");
  }
}

function handleCameraStatus(status = cameraInput?.getCameraStatus?.()) {
  const cameraStatus = status ?? cameraInput?.getCameraStatus?.() ?? {};
  visionState?.setCameraStatus?.(cameraStatus);

  if (cameraStatus.running === false) {
    objectDetectorEngine?.stop?.();
    if (followTargetController?.isRunning?.()) {
      visionScenarioManager?.stopFollowing?.("camera_stopped");
    }
    objectTracker?.markAllLost?.();
    visionState?.updateFromDetections?.(
      {
        timestamp: new Date().toISOString(),
        detections: []
      },
      objectTracker?.getTracks?.() ?? []
    );
  }

  updateCameraUi(cameraStatus);
  updateObjectVisionUi();
}

async function startObjectDetection({ source = "manual" } = {}) {
  if (!brainPolicy.localVisionEnabled) {
    log("Local object vision is disabled.", "warn");
    return null;
  }

  if (!cameraInput?.getCameraStatus?.().running) {
    log("Start the camera before object detection.", "warn");
    return null;
  }

  if (ui.objectDetectionIntervalSlider) {
    objectDetectorEngine?.setDetectionIntervalMs?.(Number(ui.objectDetectionIntervalSlider.value));
  }

  if (ui.objectScoreThresholdSlider) {
    objectDetectorEngine?.setScoreThreshold?.(Number(ui.objectScoreThresholdSlider.value));
  }

  if (ui.objectMaxResultsSlider) {
    objectDetectorEngine?.setMaxResults?.(Number(ui.objectMaxResultsSlider.value));
  }

  if (ui.objectCategoryAllowlistInput) {
    objectDetectorEngine?.setCategoryAllowlist?.(ui.objectCategoryAllowlistInput.value);
  }

  const status = await objectDetectorEngine?.start?.();
  face?.setVisionIndicator?.(true, "detecting");
  pushMediaPipeLog({
    type: "status",
    message: `Object detection ${status?.running ? "started" : "not started"} (${source}).`
  });
  log(`Object detection ${status?.running ? "started" : "not started"} (${source}).`);
  updateObjectVisionUi();
  return status;
}

function stopObjectDetection(reason = "object_detection_stop") {
  objectDetectorEngine?.stop?.();
  lastObjectDetectionResult = null;
  renderObjectOverlays();

  if (!followTargetController?.isRunning?.()) {
    face?.setVisionIndicator?.(false);
  }

  localEventBus?.publish?.("vision_detector_stopped", { reason }, { source: "vision" });
  pushMediaPipeLog({
    type: "status",
    message: `Object detection stopped (${reason}).`
  });
  updateObjectVisionUi();
}

function handleObjectDetections(result = {}) {
  lastObjectDetectionResult = result;
  const tracks = objectTracker?.update?.(result) ?? [];
  visionState?.updateFromDetections?.(result, tracks);
  updateRecentObjectReferenceFromVision();
  updateObjectVisionUi();
  renderObjectOverlays();
  localEventBus?.publish?.("vision_objects_updated", {
    vision: buildVisionContext({ visionState, cameraInput, objectTracker })
  }, { source: "vision" });
  pushMediaPipeDetectionResult(result);
}

function updateRecentObjectReferenceFromVision() {
  const activeTarget = visionState?.getActiveTarget?.();
  const visibleObjects = visionState?.getVisibleObjects?.() ?? [];
  const currentReferenceLabel = recentObjectReference?.label;
  const matchingVisible = currentReferenceLabel
    ? visibleObjects.find((object) => object.label === currentReferenceLabel)
    : null;

  if (activeTarget?.visible) {
    recentObjectReference = buildRecentObjectReference(activeTarget.label, {
      trackId: activeTarget.trackId,
      lastSeenAt: new Date().toISOString()
    });
    return;
  }

  if (matchingVisible) {
    recentObjectReference = {
      ...recentObjectReference,
      trackId: matchingVisible.trackId,
      lastSeenAt: new Date().toISOString()
    };
  }
}

function updateRecentObjectReferenceFromText(text) {
  const knownLabels = [
    ...(visionState?.getVisibleObjects?.() ?? []).map((object) => object.label),
    visionState?.getActiveTarget?.()?.label
  ].filter(Boolean);
  const labels = findMentionedObjectLabels(text, knownLabels);

  if (labels.length === 0) {
    return;
  }

  const label = labels[0];
  const visible = visionState?.findObject?.(label);
  recentObjectReference = buildRecentObjectReference(label, {
    trackId: visible?.trackId,
    lastSeenAt: visible?.lastSeenAt ? new Date(visible.lastSeenAt).toISOString() : null
  });
}

function buildRecentObjectReference(label, { trackId = null, lastSeenAt = null } = {}) {
  return {
    label,
    aliases: getObjectAliases(label),
    lastMentionedByUserAt: new Date().toISOString(),
    lastSeenAt,
    trackId: trackId ?? null
  };
}

async function handleLocalVisionControlPhrase(text) {
  const normalized = normalizeTranscriptForDedupe(text);

  if (/\bstop (camera|looking|vision|detection)\b/.test(normalized)) {
    visionScenarioManager?.stopFollowing?.("user_stop_camera");
    stopObjectDetection("user_stop_camera");
    const result = await cameraInput?.stopCamera?.();
    if (result) {
      handleCameraCommandResult(result);
    }
    log("Local vision and camera stopped by user request.");
    return true;
  }

  if (
    /\bstop following\b|\bcancel follow\b|\bcancel following\b|\bforget (the )?target\b/.test(normalized) ||
    (/\bnever mind\b|\bcancel\b/.test(normalized) && followTargetController?.isRunning?.())
  ) {
    visionScenarioManager?.stopFollowing?.("user_stop_following");
    if (brainPolicy.localSpeechAllowed) {
      voiceOutput?.speak?.({
        text: "Okay, I'll stop following it.",
        tone: "soft",
        interrupt: true
      });
    }
    log("Follow target stopped by user request.");
    return true;
  }

  return false;
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
  attentionMotorController?.onObservation?.(observation);
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

  if (/\bstop (following|camera|looking|vision|detection)\b/.test(normalized)) {
    return false;
  }

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
  face.setExpression("attentive", 0.9);
  face.setEyeDirection("center");
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

function requestLifeBehavior(name, args = {}) {
  if (!lifeEngine) {
    log("Life Engine is still initializing.", "warn");
    return;
  }

  lifeEngine.receiveEvent({
    type: "manual_test",
    label: name,
    value: args
  });

  lifeEngine.requestBehavior(name, args).catch((error) => {
    log(`Life behavior ${name} failed: ${error.message}`, "warn");
  });
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

function runCalibrationLifeTest(name, args = {}) {
  if (!calibrationTestArmed) {
    log("Calibration Life test blocked: arm Calibration Test first.", "warn");
    return;
  }

  if (!ensureConnected("Calibration Life test skipped because no robot client is connected.")) {
    return;
  }

  lifeEngine?.receiveEvent({
    type: "manual_test",
    label: `calibration_${name}`,
    value: args
  });
  lifeEngine?.requestBehavior(name, args).catch((error) => {
    log(`Calibration Life test failed: ${error.message}`, "warn");
  });
  log(`Calibration Life test requested: ${name}`);
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
  face.setExpression("curious");
  log("Local runtime ready. LOOI face is live.");
  updateProductionChrome();
}

async function startLocalBrainProductionMode() {
  await startProductionRuntime();
  await ensureOfficialRobotConnection();

  patchBrainPolicy({
    localBrainEnabled: true,
    autonomousMode: true,
    localMotionArmed: true,
    localCameraAllowed: true,
    localSpeechAllowed: true,
    allowAutonomousMovement: true,
    allowAutonomousSpeech: true
  });

  lifeEventsEnabled = true;
  globalThis.localStorage?.setItem?.("looi.lifeEventsEnabled.v1", "true");

  ui.muteSpeechToggle.checked = false;
  voiceOutput?.setMuted?.(false);

  looiModeEnabled = true;
  idleMicroBehaviorEnabled = true;
  attentionBodyTrackingEnabled = true;
  keepRobotAwakeEnabled = true;
  if (ui.looiModeToggle) ui.looiModeToggle.checked = true;
  if (ui.idleMicroBehaviorToggle) ui.idleMicroBehaviorToggle.checked = true;
  if (ui.attentionBodyTrackingToggle) ui.attentionBodyTrackingToggle.checked = true;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = true;

  performanceMonitor?.start?.();
  idleMicroBehavior?.start?.();
  attentionMotorController?.setBodyTrackingEnabled?.(true);
  attentionMotorController?.start?.();
  reliabilityManager?.start?.();
  wakeLockManager?.request?.().catch((error) => {
    keepRobotAwakeEnabled = false;
    if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = false;
    log(`Wake lock unavailable: ${error.message}`, "warn");
  });

  updateLocalBrainUi();
  updateCameraUi();

  localBrainEngine?.start?.();
  syncAutonomousScheduler();

  if (!lifeEventEmitter?.getStatus?.().running) {
    lifeEventEmitter?.start?.();
  }
  updateLifeEventsUi();

  speechInput?.setLanguage?.(ui.speechLanguageInput.value.trim() || "en-US");
  ui.continuousListeningToggle.checked = true;
  ui.alwaysListeningToggle.checked = true;
  speechInput?.startAlwaysListening?.();
  attentionSystem?.wake?.("live_start", activeConfig.conversationWindowMs ?? 30000);
  speechGate?.openAttentionWindow?.("live_start");

  ui.audioLevelMonitorToggle.checked = true;
  setAudioLevelMonitorEnabled(true).catch((error) => {
    ui.audioLevelMonitorToggle.checked = false;
    log(`Audio activity monitor unavailable: ${error.message}`, "warn");
    updateAlwaysListeningUi();
  });

  await openCameraFromUi("user").catch((error) => {
    log(`Camera startup skipped: ${error.message}`, "warn");
  });

  if (brainPolicy.localCameraAllowed && brainPolicy.localVisionEnabled) {
    await startObjectDetection({ source: "local_brain_live" }).catch((error) => {
      log(`Object detection startup skipped: ${error.message}`, "warn");
    });
  }

  voiceOutput?.speak?.({
    text: "I'm awake.",
    tone: "happy",
    interrupt: true
  });

  face.setExpression("happy");
  log("Local Brain Live started: brain, ears, speech, camera, LOOI mode, movement permissions, and autonomous mode are enabled.", "warn");
  updateAlwaysListeningUi();
  updateEmbodimentUi();
  updateProductionChrome();
}

function primeLiveInputsFromUserGesture() {
  primeSpeechFromUserGesture();
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
  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};
  const vision = buildVisionContext({ visionState, cameraInput, objectTracker });

  ui.localBrainQuickButton.textContent =
    brainRunning
      ? "Local Brain Live"
      : "Start Local Brain";
  ui.localBrainQuickButton.classList.toggle(
    "local-brain-quick-button--live",
    brainRunning
  );

  if (brainRunning) {
    ui.productionStartButton.textContent = "Enter LOOI Face";
  }

  ui.localVisionState.textContent = cameraStatus.running
    ? objectDetectorEngine?.isRunning?.()
      ? `${vision.objects?.length ?? 0} objects`
      : `${cameraStatus.facingMode ?? "camera"} live`
    : "camera off";
  ui.localVisionDetail.textContent = objectDetectorEngine?.isRunning?.()
    ? vision.summary ?? "Object detection running locally."
    : brainPolicy.localCameraAllowed
      ? "Local Brain may request camera observations."
      : "Local Brain camera actions are blocked until allowed.";

  if (ui.localVisionPreview && cameraInput?.stream) {
    ui.localVisionPreview.srcObject = cameraInput.stream;
  } else if (ui.localVisionPreview) {
    ui.localVisionPreview.srcObject = null;
  }

  document.body.classList.toggle("local-brain-running", brainRunning);
  document.body.classList.toggle("local-motion-armed", brainPolicy.localMotionArmed);
  document.body.classList.toggle("looi-mode-active", looiModeEnabled);
}

function runBoredScenario(message) {
  if (!lifeEngine) {
    return;
  }

  lifeEngine.receiveEvent({
    type: "system",
    value: {
      kind: "simulate_boredom",
      boredom: 0.9,
      curiosity: 0.85
    }
  });
  lifeEngine.patchState?.(
    {
      boredom: 0.9,
      curiosity: 0.85,
      mood: "curious"
    },
    "scenario_bored"
  );
  lifeEngine.requestBehavior("curious_scan", { direction: "both", intensity: 0.45 }).catch(
    (error) => {
      log(`Bored scenario failed: ${error.message}`, "warn");
    }
  );
  log(message);
}

function runLowEnergyScenario(message) {
  if (!lifeEngine) {
    return;
  }

  lifeEngine.receiveEvent({
    type: "system",
    value: {
      kind: "simulate_low_energy",
      energy: 0.15
    }
  });
  lifeEngine.patchState?.(
    {
      energy: 0.15,
      mood: "sleepy"
    },
    "scenario_low_energy"
  );
  lifeEngine.requestBehavior("sleepy_idle").catch((error) => {
    log(`Low energy scenario failed: ${error.message}`, "warn");
  });
  log(message);
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

  ui.localBrainEnabledToggle.checked = Boolean(brainPolicy.localBrainEnabled);
  ui.autonomousModeToggle.checked = Boolean(brainPolicy.autonomousMode);
  ui.localMotionArmedToggle.checked = Boolean(brainPolicy.localMotionArmed);
  ui.localCameraAllowedToggle.checked = Boolean(brainPolicy.localCameraAllowed);
  ui.localSpeechAllowedToggle.checked = Boolean(brainPolicy.localSpeechAllowed);
  ui.allowAutonomousMovementToggle.checked = Boolean(brainPolicy.allowAutonomousMovement);
  ui.allowAutonomousSpeechToggle.checked = Boolean(brainPolicy.allowAutonomousSpeech);
  if (ui.followModeArmedToggle) {
    ui.followModeArmedToggle.checked = Boolean(brainPolicy.followModeArmed);
  }
  if (ui.allowFollowMovementToggle) {
    ui.allowFollowMovementToggle.checked = Boolean(brainPolicy.allowFollowMovement);
  }

  ui.localBrainState.textContent = status.running
    ? status.processing
      ? "thinking"
      : "running"
    : "stopped";
  ui.localBrainState.classList.toggle("local-brain-state--running", Boolean(status.running));
  ui.localBrainState.classList.toggle("local-brain-state--stopped", !status.running);
  ui.localBrainAdapterState.textContent = status.fallbackUsed
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
  ui.localBrainProvider.textContent = status.provider ?? activeConfig.localBrainProvider ?? "unknown";
  ui.localBrainModel.textContent = status.model || activeConfig.localBrainModel || "--";
  ui.localBrainLatency.textContent = Number.isFinite(Number(status.latestLatencyMs))
    ? `${Math.round(Number(status.latestLatencyMs))} ms`
    : "--";
  ui.localBrainLastThought.textContent = status.lastThoughtAt
    ? `${Math.round((Date.now() - status.lastThoughtAt) / 100) / 10}s ago`
    : "--";

  document.body.classList.toggle("local-motion-armed", Boolean(brainPolicy.localMotionArmed));
  document.body.classList.toggle("local-autonomous-mode", Boolean(brainPolicy.autonomousMode));
  renderLocalBrainThoughts();
  updateObjectVisionUi();
  updateAlwaysListeningUi();
  updateProductionChrome();
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
  if (followTargetController) {
    followTargetController.lostTimeoutMs = brainPolicy.followLostTimeoutMs;
  }
  if (objectDetectorEngine && partial.objectDetectionIntervalMs) {
    objectDetectorEngine.setDetectionIntervalMs(brainPolicy.objectDetectionIntervalMs);
  }
  syncAutonomousScheduler();
  updateLocalBrainUi();
}

function getPolicy() {
  return clampBrainPolicy(brainPolicy);
}

function syncAutonomousScheduler() {
  if (!autonomousScheduler) {
    return;
  }

  if (brainPolicy.localBrainEnabled && brainPolicy.autonomousMode && localBrainEngine?.isRunning?.()) {
    autonomousScheduler.start();
  } else {
    autonomousScheduler.stop();
  }

  updateAlwaysListeningUi();
}

function bindMacroButton(button, macroName, options = {}) {
  button?.addEventListener?.("click", () => {
    playTestMacro(macroName, options).catch((error) => {
      log(`Macro ${macroName} failed: ${error.message}`, "warn");
    });
  });
}

async function playTestMacro(macroName, options = {}) {
  if (!macroSequencer) {
    log("Macro sequencer is still initializing.", "warn");
    return null;
  }

  const allowMotion = options.allowMotion === false
    ? false
    : Boolean(brainPolicy.localMotionArmed);
  const result = await macroSequencer.playMacro(macroName, {
    source: "manual",
    priority: options.priority ?? 60,
    allowMotion,
    allowSpeech: brainPolicy.localSpeechAllowed,
    reason: `test_${macroName}`
  });
  updateEmbodimentUi();
  log(
    `Macro ${macroName}: ${result.reason}${result.partial ? " (partial)" : ""}`,
    result.ok ? "info" : "warn"
  );
  return result;
}

async function simulatorDemoRoutine() {
  if (!simulatorMode) {
    await enableSimulatorMode();
  }

  const previousMotionArmed = brainPolicy.localMotionArmed;
  patchBrainPolicy({
    localMotionArmed: true
  });

  const sequence = [
    ["soft_listen", { allowMotion: false }],
    ["thinking_pose", { allowMotion: false }],
    ["curious_scan", { allowMotion: true }],
    ["happy_approach", { allowMotion: true }],
    ["shy_retreat", { allowMotion: true }],
    ["excited_wiggle", { allowMotion: true }],
    ["sleepy_idle", { allowMotion: false }]
  ];

  for (const [name, options] of sequence) {
    await playTestMacro(name, {
      ...options,
      priority: 65
    });
    await waitMs(220);
  }

  patchBrainPolicy({ localMotionArmed: previousMotionArmed });
  log("Simulator LOOI demo complete.");
}

async function wheelsLiftedSafetyRoutine() {
  if (!robotClient?.isConnected?.() || simulatorMode) {
    throw new Error("Connect the real ESP32 first. This routine is for wheels-lifted hardware testing.");
  }

  if (!globalThis.confirm?.("Wheels lifted, robot supervised, Emergency Stop visible?")) {
    return;
  }

  await emergencyStop("wheels_lifted_precheck", "Precheck stop sent.", "warn");
  const previousMotionArmed = brainPolicy.localMotionArmed;
  patchBrainPolicy({ localMotionArmed: true });
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: 0.08, angular: 0, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_forward" });
  await commandQueue.emergencyStop("wheels_lifted_forward_stop");
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: -0.08, angular: 0, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_back" });
  await commandQueue.emergencyStop("wheels_lifted_back_stop");
  await waitMs(250);
  await commandQueue.enqueueMotion({ linear: 0, angular: 0.08, durationMs: 140, rampMs: 80, label: "wheels_lifted_tiny_rotate" });
  await commandQueue.emergencyStop("wheels_lifted_done");
  patchBrainPolicy({ localMotionArmed: previousMotionArmed });
  log("Wheels-lifted safety routine complete.", "warn");
}

async function deskGentleDemoRoutine() {
  if (!brainPolicy.localMotionArmed) {
    throw new Error("Arm Local Motion first. Use only on a safe flat surface.");
  }

  if (!globalThis.confirm?.("Use only on a safe flat surface with Emergency Stop ready.")) {
    return;
  }

  const sequence = ["soft_listen", "curious_scan", "gentle_approach", "shy_retreat", "soft_recenter"];
  for (const macroName of sequence) {
    await playTestMacro(macroName, { allowMotion: macroName !== "soft_listen" });
    await waitMs(250);
  }
  log("Desk gentle demo complete.", "warn");
}

function updateEmbodimentUi(statusOverride = null) {
  const macro = macroSequencer?.getCurrentMacro?.();
  const schedulerTask = priorityScheduler?.getCurrentTask?.();
  const performance = statusOverride ?? performanceMonitor?.getStatus?.() ?? {};
  const reliability = reliabilityManager?.getStatus?.() ?? {};
  const wakeLock = wakeLockManager?.getStatus?.() ?? {};
  const idle = idleMicroBehavior?.getStatus?.() ?? {};
  const attentionMotor = attentionMotorController?.getStatus?.() ?? {};

  if (ui.looiModeToggle) ui.looiModeToggle.checked = looiModeEnabled;
  if (ui.idleMicroBehaviorToggle) ui.idleMicroBehaviorToggle.checked = idleMicroBehaviorEnabled;
  if (ui.attentionBodyTrackingToggle) ui.attentionBodyTrackingToggle.checked = attentionBodyTrackingEnabled;
  if (ui.keepRobotAwakeToggle) ui.keepRobotAwakeToggle.checked = keepRobotAwakeEnabled && wakeLock.requested !== false;

  if (ui.currentMacroState) {
    ui.currentMacroState.textContent = macro ? `${macro.name} · ${macro.source}` : "idle";
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

  renderMacroHistory();
  renderRuntimeWarnings(performance.warnings ?? []);
  document.body.classList.toggle("looi-mode-active", looiModeEnabled);
  document.body.classList.toggle("macro-running", Boolean(macro));
  document.body.classList.toggle("wake-lock-active", Boolean(wakeLock.active));

  return {
    macro,
    schedulerTask,
    performance,
    reliability,
    wakeLock,
    idle,
    attentionMotor
  };
}

function renderMacroHistory(history = macroSequencer?.getHistory?.({ limit: 8 }) ?? []) {
  if (!ui.macroHistoryList) {
    return;
  }

  ui.macroHistoryList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "macro-history-item";
    empty.innerHTML = "<strong>No macros yet</strong><span>Run a test macro or trigger a Local Brain action.</span>";
    ui.macroHistoryList.append(empty);
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `macro-history-item${entry.partial ? " macro-history-item--partial" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `${entry.macro} · ${entry.reason}`;
    const detail = document.createElement("span");
    detail.textContent = `${new Date(entry.timestamp).toLocaleTimeString()} · frames=${entry.executedFrames ?? 0} · skipped=${entry.skippedFrames?.join(",") || "none"}`;
    item.append(title, detail);
    ui.macroHistoryList.append(item);
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
  const schedulerStatus = autonomousScheduler?.getStatus?.() ?? {
    running: false,
    lastReason: null
  };
  const transcripts = speechGate?.getRecentTranscripts?.({ limit: 20 }) ?? [];
  const lastAccepted = transcripts.find((entry) => entry.accepted);
  const lastIgnored = transcripts.find((entry) => !entry.accepted);

  if (ui.alwaysListeningToggle) {
    ui.alwaysListeningToggle.checked = Boolean(speechStatus.alwaysListening);
  }

  if (ui.earsState) {
    ui.earsState.textContent = speechStatus.alwaysListening
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
      Boolean(speechStatus.alwaysListening || speechStatus.listening || speechStatus.starting)
    );
    ui.earsState.classList.toggle(
      "ears-state--off",
      !speechStatus.alwaysListening && !speechStatus.listening && !speechStatus.starting
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

  if (ui.autonomousSchedulerState) {
    ui.autonomousSchedulerState.textContent = schedulerStatus.running ? "running" : "stopped";
    ui.autonomousSchedulerState.classList.toggle("voice-state--active", Boolean(schedulerStatus.running));
  }

  if (ui.lastAutonomousReason) {
    ui.lastAutonomousReason.textContent = schedulerStatus.lastReason ?? "--";
  }

  document.body.classList.toggle("ears-on", Boolean(speechStatus.alwaysListening || speechStatus.listening));
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

  ui.speechSupportState.textContent = speechStatus.supported
    ? speechStatus.lastError
      ? `error: ${speechStatus.lastError}`
      : speechStatus.listening
      ? "listening"
      : speechStatus.starting
      ? "starting"
      : "supported"
    : "unsupported";
  ui.speechSupportState.classList.toggle("voice-state--active", Boolean(speechStatus.listening || speechStatus.starting));
  ui.speechSupportState.classList.toggle("voice-state--warn", !speechStatus.supported || Boolean(speechStatus.lastError));
  ui.speechSecureWarning.textContent = speechStatus.lastError
    ? `Speech error: ${speechStatus.lastError}. Check microphone permission for this site on the phone.`
    : speechStatus.secureContext
      ? `Microphone access may require user permission. Results: ${speechStatus.finalResultCount ?? 0} final / ${speechStatus.interimResultCount ?? 0} interim.`
      : "Speech recognition usually requires HTTPS or localhost.";
  ui.voiceSupportState.textContent = voiceStatus.supported
    ? voiceStatus.muted
      ? "muted"
      : "supported"
    : "unsupported";
  ui.voiceSupportState.classList.toggle("voice-state--active", voiceStatus.speaking);
  ui.voiceSupportState.classList.toggle("voice-state--warn", !voiceStatus.supported || voiceStatus.muted);
  ui.speakingState.textContent = String(Boolean(voiceStatus.speaking || lifeEngine?.getState?.().isSpeaking));
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
  updateCameraVisionMetadataUi();
  updateProductionChrome();
}

function updateCameraVisionMetadataUi() {
  const vision = buildVisionContext({ visionState, cameraInput, objectTracker });
  const detectorStatus = objectDetectorEngine?.getStatus?.() ?? {};
  const visibleObjects = Array.isArray(vision.objects)
    ? vision.objects.filter((object) => object.visible !== false)
    : [];
  const lastAge = Number(vision.lastDetectionAgeMs);
  const quality = describeMediaPipeQuality({
    detectorStatus,
    objectCount: visibleObjects.length,
    lastDetectionAgeMs: lastAge
  });

  if (ui.cameraObjectCount) {
    ui.cameraObjectCount.textContent = String(visibleObjects.length);
  }

  if (ui.cameraObjectLabels) {
    ui.cameraObjectLabels.textContent = visibleObjects.length
      ? visibleObjects
          .slice(0, 6)
          .map((object) => `${object.label}${Number.isFinite(Number(object.confidence)) ? ` ${Math.round(Number(object.confidence) * 100)}%` : ""}`)
          .join(", ")
      : "--";
  }

  if (ui.cameraVisionMetadataAge) {
    ui.cameraVisionMetadataAge.textContent = Number.isFinite(lastAge)
      ? `${Math.round(lastAge / 100) / 10}s`
      : "--";
  }

  if (ui.cameraMediaPipeQuality) {
    ui.cameraMediaPipeQuality.textContent = quality;
  }

  if (ui.cameraMediaPipeModel) {
    ui.cameraMediaPipeModel.textContent = detectorStatus.modelName
      ? `${detectorStatus.modelName} · ${detectorStatus.modelQuality ?? "custom"} · ${detectorStatus.modelInputShape ?? "unknown"}`
      : "MediaPipe ObjectDetector";
  }

  if (ui.cameraMediaPipeSettings) {
    const threshold = Number(detectorStatus.scoreThreshold ?? 0);
    const allowlist = Array.isArray(detectorStatus.categoryAllowlist) && detectorStatus.categoryAllowlist.length
      ? detectorStatus.categoryAllowlist.join(", ")
      : "all categories";
    ui.cameraMediaPipeSettings.textContent =
      `threshold ${Number.isFinite(threshold) ? threshold.toFixed(2) : "--"} · max ${detectorStatus.maxResults ?? "--"} · ${allowlist} · every ${detectorStatus.detectionIntervalMs ?? brainPolicy.objectDetectionIntervalMs}ms`;
  }

  if (ui.cameraVisionMetadataSafety) {
    ui.cameraVisionMetadataSafety.textContent = "metadata only, no frames";
  }

  if (ui.cameraVisionMetadataPreview) {
    ui.cameraVisionMetadataPreview.textContent = JSON.stringify(compactVisionMetadataPreview(vision), null, 2);
  }
}

function updateObjectVisionUi() {
  const detectorStatus = objectDetectorEngine?.getStatus?.() ?? {};
  const vision = buildVisionContext({ visionState, cameraInput, objectTracker });
  const scenario = vision.scenario ?? {};
  const activeTarget = vision.activeTarget ?? null;
  const followStatus = followTargetController?.getStatus?.() ?? {};
  const lastAge = Number(vision.lastDetectionAgeMs);

  if (ui.objectDetectorState) {
    ui.objectDetectorState.textContent = detectorStatus.running
      ? detectorStatus.ready
        ? "running"
        : "starting"
      : detectorStatus.ready
        ? "ready"
        : "stopped";
  }
  if (ui.objectDetectorModel) {
    ui.objectDetectorModel.textContent = detectorStatus.modelName
      ? `${detectorStatus.modelName} (${detectorStatus.modelQuality ?? "custom"})`
      : "--";
  }
  if (ui.objectDetectorModelSelect && detectorStatus.modelPreset && OBJECT_DETECTOR_MODEL_PRESETS[detectorStatus.modelPreset]) {
    ui.objectDetectorModelSelect.value = detectorStatus.modelPreset;
  }
  if (ui.objectDetectorModelHelp) {
    ui.objectDetectorModelHelp.textContent =
      detectorStatus.modelDescription ||
      "Custom MediaPipe object detector model. Keep the detection interval conservative on phones.";
  }
  if (ui.objectDetectionInterval) {
    ui.objectDetectionInterval.textContent = `${detectorStatus.detectionIntervalMs ?? brainPolicy.objectDetectionIntervalMs} ms`;
  }
  if (ui.objectDetectionIntervalValue) {
    ui.objectDetectionIntervalValue.textContent = `${detectorStatus.detectionIntervalMs ?? brainPolicy.objectDetectionIntervalMs} ms`;
  }
  if (ui.objectScoreThresholdValue) {
    const threshold = Number(detectorStatus.scoreThreshold);
    ui.objectScoreThresholdValue.textContent = Number.isFinite(threshold) ? threshold.toFixed(2) : "--";
  }
  if (ui.objectMaxResultsValue) {
    ui.objectMaxResultsValue.textContent = `${detectorStatus.maxResults ?? "--"} objects`;
  }
  if (ui.objectDetectionLastRun) {
    ui.objectDetectionLastRun.textContent = Number.isFinite(lastAge)
      ? `${Math.round(lastAge / 100) / 10}s ago`
      : "--";
  }
  if (ui.objectDetectionError) {
    ui.objectDetectionError.textContent = detectorStatus.lastError ?? "--";
  }
  updateCameraVisionMetadataUi();
  if (ui.visionSummary) {
    ui.visionSummary.textContent = vision.summary ?? "No objects detected.";
  }
  if (ui.visibleObjectList) {
    renderVisibleObjectList(vision.objects ?? []);
  }
  if (ui.followScenarioState) {
    ui.followScenarioState.textContent = scenario.state ?? "idle";
  }
  if (ui.activeFollowTarget) {
    ui.activeFollowTarget.textContent = activeTarget?.label ?? "--";
  }
  if (ui.followTargetVisible) {
    ui.followTargetVisible.textContent = activeTarget ? String(Boolean(activeTarget.visible)) : "--";
  }
  if (ui.followTargetPosition) {
    ui.followTargetPosition.textContent = activeTarget?.position ?? "--";
  }
  if (ui.followTargetDistance) {
    ui.followTargetDistance.textContent = activeTarget?.distance ?? "--";
  }
  if (ui.followTargetLostFor) {
    ui.followTargetLostFor.textContent = activeTarget?.lostForMs
      ? `${Math.round(activeTarget.lostForMs / 100) / 10}s`
      : "--";
  }
  if (ui.followControllerState) {
    ui.followControllerState.textContent = followStatus.running
      ? followStatus.motionAllowed
        ? "running, motion allowed"
        : "running, motion held"
      : "stopped";
  }

  document.body.classList.toggle("object-vision-running", Boolean(detectorStatus.running));
  document.body.classList.toggle("follow-scenario-running", Boolean(followStatus.running));
  renderObjectOverlays();
}

function renderVisibleObjectList(objects = []) {
  ui.visibleObjectList.replaceChildren();

  if (!objects.length) {
    const empty = document.createElement("div");
    empty.className = "object-chip object-chip--empty";
    empty.textContent = "No visible objects yet.";
    ui.visibleObjectList.append(empty);
    return;
  }

  objects.slice(0, 12).forEach((object) => {
    const item = document.createElement("div");
    item.className = "object-chip";
    item.textContent = `${object.label} ${Math.round(Number(object.confidence || 0) * 100)}% · ${object.position} · ${object.distance}`;
    ui.visibleObjectList.append(item);
  });
}

function renderObjectOverlays() {
  const frameWidth = Number(lastObjectDetectionResult?.frameWidth || 0);
  const frameHeight = Number(lastObjectDetectionResult?.frameHeight || 0);
  const detections = Array.isArray(lastObjectDetectionResult?.detections)
    ? lastObjectDetectionResult.detections
    : [];
  renderObjectOverlay(ui.cameraObjectOverlay, detections, frameWidth, frameHeight);
  renderObjectOverlay(ui.localVisionOverlay, detections, frameWidth, frameHeight);
}

function renderObjectOverlay(container, detections, frameWidth, frameHeight) {
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (!frameWidth || !frameHeight || !detections.length) {
    return;
  }

  detections.slice(0, 8).forEach((object) => {
    if (!object?.bbox) {
      return;
    }

    const box = document.createElement("div");
    box.className = "object-detection-box";
    box.style.left = `${(Number(object.bbox.x || 0) / frameWidth) * 100}%`;
    box.style.top = `${(Number(object.bbox.y || 0) / frameHeight) * 100}%`;
    box.style.width = `${(Number(object.bbox.width || 0) / frameWidth) * 100}%`;
    box.style.height = `${(Number(object.bbox.height || 0) / frameHeight) * 100}%`;

    const label = document.createElement("span");
    label.className = "object-detection-label";
    label.textContent = `${object.label} ${Math.round(Number(object.confidence || 0) * 100)}% · ${object.position} · ${object.distance}`;
    box.append(label);
    container.append(box);
  });
}

function populateObjectDetectorModelSelect(selectedPreset = DEFAULT_OBJECT_DETECTOR_MODEL_PRESET) {
  if (!ui.objectDetectorModelSelect) {
    return;
  }

  ui.objectDetectorModelSelect.replaceChildren();

  Object.entries(OBJECT_DETECTOR_MODEL_PRESETS).forEach(([key, preset]) => {
    const option = new Option(
      `${preset.label} · ${preset.quality} · ${preset.inputShape}`,
      key
    );
    option.title = preset.description ?? "";
    ui.objectDetectorModelSelect.append(option);
  });

  ui.objectDetectorModelSelect.value = OBJECT_DETECTOR_MODEL_PRESETS[selectedPreset]
    ? selectedPreset
    : DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;
}

function getConfiguredObjectDetectorModelPreset() {
  const configuredPreset =
    activeConfig.objectDetectorModelPreset ??
    PUBLIC_CONFIG.objectDetectorModelPreset ??
    DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;

  if (OBJECT_DETECTOR_MODEL_PRESETS[configuredPreset]) {
    return configuredPreset;
  }

  const configuredPath =
    activeConfig.objectDetectorModelAssetPath ??
    PUBLIC_CONFIG.objectDetectorModelAssetPath;
  const presetFromPath = Object.entries(OBJECT_DETECTOR_MODEL_PRESETS)
    .find(([, preset]) => preset.url === configuredPath)?.[0];

  return presetFromPath ?? DEFAULT_OBJECT_DETECTOR_MODEL_PRESET;
}

function getSelectedObjectDetectorModelPreset() {
  return OBJECT_DETECTOR_MODEL_PRESETS[ui.objectDetectorModelSelect?.value]
    ? ui.objectDetectorModelSelect.value
    : getConfiguredObjectDetectorModelPreset();
}

function pushMediaPipeDetectionResult(result = {}) {
  const detectorStatus = objectDetectorEngine?.getStatus?.() ?? {};
  const detections = Array.isArray(result.detections) ? result.detections : [];
  const labels = detections
    .map((object) => `${object.label} ${Math.round(Number(object.confidence || 0) * 100)}% ${object.position}/${object.distance}`)
    .join("; ");
  const maxResults = Number(detectorStatus.maxResults);
  const capReached = Number.isFinite(maxResults) && detections.length >= maxResults;
  const reason = result.reason ? ` · reason ${result.reason}` : "";

  pushMediaPipeLog({
    type: "detect",
    modelName: detectorStatus.modelName,
    threshold: detectorStatus.scoreThreshold,
    maxResults: detectorStatus.maxResults,
    allowlist: detectorStatus.categoryAllowlist,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    detectionCount: detections.length,
    message: detections.length
      ? `${labels}${capReached ? " · cap reached, raise max results if weaker objects are missing" : ""}`
      : `none${reason} · try lower threshold, clearer lighting, or remove allowlist`
  });
}

function pushMediaPipeLog(entry = {}) {
  mediaPipeDetectionLogs = [
    {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      ...entry
    },
    ...mediaPipeDetectionLogs
  ].slice(0, MEDIA_PIPE_LOG_LIMIT);
  renderMediaPipeDetectionLog();
}

function renderMediaPipeDetectionLog() {
  if (!ui.mediaPipeDetectionLog) {
    return;
  }

  if (!mediaPipeDetectionLogs.length) {
    ui.mediaPipeDetectionLog.textContent = "No MediaPipe detections yet.";
    return;
  }

  ui.mediaPipeDetectionLog.textContent = mediaPipeDetectionLogs
    .map(formatMediaPipeLogEntry)
    .join("\n");
}

function formatMediaPipeLogEntry(entry = {}) {
  const time = new Date(entry.timestamp ?? Date.now()).toLocaleTimeString();

  if (entry.type === "detect") {
    const threshold = Number(entry.threshold);
    const allowlist = Array.isArray(entry.allowlist) && entry.allowlist.length
      ? entry.allowlist.join(", ")
      : "all categories";
    const frame =
      Number(entry.frameWidth) > 0 && Number(entry.frameHeight) > 0
        ? `${Math.round(Number(entry.frameWidth))}x${Math.round(Number(entry.frameHeight))}`
        : "--";

    return `[${time}] detect · ${entry.modelName ?? "model"} · threshold ${Number.isFinite(threshold) ? threshold.toFixed(2) : "--"} · max ${entry.maxResults ?? "--"} · ${allowlist} · frame ${frame} · ${entry.detectionCount ?? 0} objects · ${entry.message ?? ""}`;
  }

  return `[${time}] ${entry.type ?? "info"} · ${entry.message ?? ""}`;
}

function describeMediaPipeQuality({ detectorStatus = {}, objectCount = 0, lastDetectionAgeMs = null } = {}) {
  if (detectorStatus.lastError) {
    return "error";
  }

  if (!detectorStatus.running) {
    return detectorStatus.ready ? "ready, stopped" : "not running";
  }

  if (!detectorStatus.ready) {
    return "loading model";
  }

  if (!Number.isFinite(Number(lastDetectionAgeMs))) {
    return "waiting for first frame";
  }

  if (lastDetectionAgeMs > 3500) {
    return "stale metadata";
  }

  if (lastDetectionAgeMs > 1800) {
    return "slightly delayed";
  }

  return objectCount > 0 ? "fresh detections" : "fresh, no objects";
}

function compactVisionMetadataPreview(vision = {}) {
  return {
    summary: vision.summary ?? "No objects detected.",
    objects: Array.isArray(vision.objects)
      ? vision.objects.slice(0, 8).map((object) => ({
          label: object.label,
          visible: Boolean(object.visible),
          confidence: roundForPreview(object.confidence),
          position: object.position,
          distance: object.distance,
          trackId: object.trackId,
          lastSeenMs: Number.isFinite(Number(object.lastSeenMs)) ? Math.round(Number(object.lastSeenMs)) : null
        }))
      : [],
    activeTarget: vision.activeTarget ?? null,
    scenario: vision.scenario
      ? {
          active: Boolean(vision.scenario.active),
          type: vision.scenario.type ?? null,
          targetLabel: vision.scenario.targetLabel ?? null,
          state: vision.scenario.state ?? null,
          reason: vision.scenario.reason ?? null
        }
      : null,
    detectorRunning: Boolean(vision.detectorRunning),
    cameraRunning: Boolean(vision.cameraRunning),
    currentCameraFacingMode: vision.currentCameraFacingMode ?? "unknown",
    lastDetectionAgeMs: Number.isFinite(Number(vision.lastDetectionAgeMs))
      ? Math.round(Number(vision.lastDetectionAgeMs))
      : null,
    safety: "metadata_only_no_raw_images"
  };
}

function roundForPreview(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
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

function getExecutionPolicy() {
  return {
    source: "local",
    localMotionArmed: brainPolicy.localMotionArmed,
    localCameraAllowed: brainPolicy.localCameraAllowed,
    localSpeechAllowed: brainPolicy.localSpeechAllowed,
    autonomousMode: brainPolicy.autonomousMode,
    allowAutonomousMovement: brainPolicy.allowAutonomousMovement,
    allowAutonomousSpeech: brainPolicy.allowAutonomousSpeech,
    localVisionEnabled: brainPolicy.localVisionEnabled,
    followModeArmed: brainPolicy.followModeArmed,
    allowFollowMovement: brainPolicy.allowFollowMovement,
    followLostTimeoutMs: brainPolicy.followLostTimeoutMs,
    objectDetectionIntervalMs: brainPolicy.objectDetectionIntervalMs,
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
    autonomousScheduler: autonomousScheduler?.getStatus?.() ?? null,
    simulatorMode,
    localBrainRunning: Boolean(localBrainEngine?.isRunning?.()),
    looiModeEnabled,
    macroStatus: {
      current: macroSequencer?.getCurrentMacro?.() ?? null,
      running: Boolean(macroSequencer?.isRunning?.())
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
    vision: buildVisionContext({ visionState, cameraInput, objectTracker }),
    recentObjectReference,
    voice: {
      speechListening: Boolean(speechInput?.getStatus?.().listening),
      alwaysListening: Boolean(speechInput?.getStatus?.().alwaysListening),
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
  const vision = buildVisionContext({ visionState, cameraInput, objectTracker });

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
    autonomousScheduler: autonomousScheduler?.getStatus?.() ?? null,
    macroStatus: {
      current: macroSequencer?.getCurrentMacro?.() ?? null,
      history: macroSequencer?.getHistory?.({ limit: 5 }) ?? []
    },
    performanceStatus: performanceMonitor?.getStatus?.() ?? null,
    reliabilityStatus: reliabilityManager?.getStatus?.() ?? null,
    audioActivity: audioLevelMonitor?.getStatus?.() ?? null,
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
    vision,
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

function traceMacroEvent(event = {}) {
  const payload = event.payload ?? {};
  const macroName = payload.macro ?? payload.name;
  const reason = payload.reason ?? payload.result?.reason;

  if (
    event.type === "macro_result" &&
    QUIET_IDLE_MACROS.has(macroName) &&
    ["macro_cooldown_active", "cooldown", "idle_micro_behavior"].includes(reason)
  ) {
    return;
  }

  if (
    event.type === "macro_result" &&
    QUIET_IDLE_MACROS.has(macroName) &&
    payload.result == null &&
    String(reason ?? "").includes("cooldown")
  ) {
    return;
  }

  traceLive(`STEP 4 MACRO ${event.type ?? "event"}`, {
    macro: macroName,
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

  const text = String(message ?? "");

  return (
    /^Macro (soft_idle|soft_recenter|thinking_pose): (macro_cooldown_active|cooldown|idle_micro_behavior)$/.test(text) ||
    /^\[TRACE\] Macro macro_result: .*"macro":"(soft_idle|soft_recenter|thinking_pose)".*"reason":"(macro_cooldown_active|cooldown|idle_micro_behavior)"/.test(text) ||
    /^\[TRACE\] Macro macro_result: .*"macro":"(soft_idle|soft_recenter|thinking_pose)".*"result":null/.test(text)
  );
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
