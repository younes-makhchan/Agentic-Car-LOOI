import { PUBLIC_CONFIG } from "./config.js";
import { LifeEngine } from "./life/lifeEngine.js";
import { ClawBridgeClient } from "./kimiClaw/clawBridgeClient.js";
import { RuntimeHeartbeat } from "./kimiClaw/runtimeHeartbeat.js";
import { CameraInput } from "./perception/camera.js";
import { SpeechInput } from "./perception/speech.js";
import { VoiceOutput } from "./perception/voiceOutput.js";
import { inferKnownIntent } from "./personality/learnedPhrases.js";
import { LifeEventEmitter } from "./personality/lifeEvents.js";
import { describePersonalityForRuntime } from "./personality/personalityProfile.js";
import { PersonalityTuning } from "./personality/personalityTuning.js";
import { BodyCalibration } from "./robot/bodyCalibration.js";
import { CommandQueue } from "./robot/commandQueue.js";
import { ESP32Client } from "./robot/esp32Client.js";
import { SimulatedESP32Client } from "./robot/simulatedEsp32Client.js";
import { ToolExecutor } from "./robot/toolExecutor.js";
import { createFaceController } from "./ui/faceCanvas.js";

const DEFAULT_SPEED = 0.2;
const DEFAULT_DURATION_MS = 400;

const ui = {
  canvas: document.getElementById("faceCanvas"),
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
  voiceSupportState: document.getElementById("voiceSupportState"),
  muteSpeechToggle: document.getElementById("muteSpeechToggle"),
  voiceSelect: document.getElementById("voiceSelect"),
  voiceRateSlider: document.getElementById("voiceRateSlider"),
  voicePitchSlider: document.getElementById("voicePitchSlider"),
  speakTestButton: document.getElementById("speakTestButton"),
  lastRobotEventPosted: document.getElementById("lastRobotEventPosted"),
  robotEventPostStatus: document.getElementById("robotEventPostStatus"),
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
  cloudCameraAllowButton: document.getElementById("cloudCameraAllowButton"),
  cloudCameraState: document.getElementById("cloudCameraState"),
  cameraPreview: document.getElementById("cameraPreview"),
  cameraCanvas: document.getElementById("cameraCanvas"),
  snapshotPreview: document.getElementById("snapshotPreview"),
  cameraUserVisible: document.getElementById("cameraUserVisible"),
  cameraUserPosition: document.getElementById("cameraUserPosition"),
  cameraUserDistance: document.getElementById("cameraUserDistance"),
  cameraFaceCount: document.getElementById("cameraFaceCount"),
  cameraLastObservation: document.getElementById("cameraLastObservation"),
  runtimeAuthState: document.getElementById("runtimeAuthState"),
  runtimePairingCodeInput: document.getElementById("runtimePairingCodeInput"),
  registerRuntimeButton: document.getElementById("registerRuntimeButton"),
  startHeartbeatButton: document.getElementById("startHeartbeatButton"),
  stopHeartbeatButton: document.getElementById("stopHeartbeatButton"),
  runtimeIdDisplay: document.getElementById("runtimeIdDisplay"),
  runtimeHeartbeatState: document.getElementById("runtimeHeartbeatState"),
  runtimeLastHeartbeat: document.getElementById("runtimeLastHeartbeat"),
  runtimeOnlineState: document.getElementById("runtimeOnlineState"),
  clawBridgeState: document.getElementById("clawBridgeState"),
  cloudMotionArmButton: document.getElementById("cloudMotionArmButton"),
  cloudMotionState: document.getElementById("cloudMotionState"),
  cloudSpeakToggle: document.getElementById("cloudSpeakToggle"),
  cloudNonPhysicalToggle: document.getElementById("cloudNonPhysicalToggle"),
  startClawBridgeButton: document.getElementById("startClawBridgeButton"),
  stopClawBridgeButton: document.getElementById("stopClawBridgeButton"),
  injectTestClawActionButton: document.getElementById("injectTestClawActionButton"),
  injectComeHereActionButton: document.getElementById("injectComeHereActionButton"),
  injectStopActionButton: document.getElementById("injectStopActionButton"),
  injectSpeakActionButton: document.getElementById("injectSpeakActionButton"),
  injectOpenFrontCameraActionButton: document.getElementById("injectOpenFrontCameraActionButton"),
  injectObserveSceneActionButton: document.getElementById("injectObserveSceneActionButton"),
  injectCaptureSnapshotActionButton: document.getElementById("injectCaptureSnapshotActionButton"),
  clawActionList: document.getElementById("clawActionList"),
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
  scenarioClearObstacleButton: document.getElementById("scenarioClearObstacleButton")
};

let face = null;
let robotClient = null;
let realRobotClient = null;
let simulatedRobotClient = null;
let commandQueue = null;
let lifeEngine = null;
let clawBridgeClient = null;
let runtimeHeartbeat = null;
let speechInput = null;
let voiceOutput = null;
let cameraInput = null;
let bodyCalibration = null;
let personalityTuning = null;
let lifeEventEmitter = null;
let toolExecutor = null;
let activeConfig = { ...PUBLIC_CONFIG };
let simulatorMode = false;
let cloudMotionArmed = false;
let cloudCameraAllowed = false;
let calibrationTestArmed = false;
let clawActionRecords = [];
let latestActionResult = null;
let lastTranscript = null;
let lastEventPosted = null;
let lastObservationEventAt = 0;
let lastObservationSignature = "";
let learnedPhraseCache = [];
let lifeEventsEnabled = false;

face = createFaceController(ui.canvas);
face.setExpression("neutral");
face.setEyeDirection("center");
renderTelemetry(null);
updateSliderLabels();
updateSimulatorUi();
updateCloudExecutionUi();
updateRuntimeUi();
updateVoiceUi();
updateCameraUi();
updateCalibrationUi();
updatePersonalityUi();
updateLifeEventsUi();

ui.sendButton.addEventListener("click", handleSend);
ui.userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    handleSend();
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

ui.cloudMotionArmButton.addEventListener("click", () => {
  cloudMotionArmed = !cloudMotionArmed;
  updateCloudExecutionUi();
  log(
    cloudMotionArmed
      ? "Cloud Motion armed. Supervise the robot and keep Emergency Stop ready."
      : "Cloud Motion disarmed. Physical cloud actions will be rejected.",
    cloudMotionArmed ? "warn" : "info"
  );
});

ui.cloudSpeakToggle.addEventListener("change", updateCloudExecutionUi);
ui.cloudNonPhysicalToggle.addEventListener("change", updateCloudExecutionUi);

ui.cloudCameraAllowButton.addEventListener("click", () => {
  cloudCameraAllowed = !cloudCameraAllowed;
  updateCameraUi();
  log(
    cloudCameraAllowed
      ? "Cloud Camera allowed. KimiClaw camera actions can use the local camera while supervised."
      : "Cloud Camera blocked. KimiClaw camera actions will be rejected.",
    cloudCameraAllowed ? "warn" : "info"
  );
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
  speechInput.setContinuous(ui.continuousListeningToggle.checked);
  speechInput.start();
});

ui.stopListeningButton.addEventListener("click", () => {
  speechInput?.stop();
});

ui.continuousListeningToggle.addEventListener("change", () => {
  speechInput?.setContinuous(ui.continuousListeningToggle.checked);
  updateVoiceUi();
});

ui.speechLanguageInput.addEventListener("change", () => {
  speechInput?.setLanguage(ui.speechLanguageInput.value.trim() || "en-US");
  updateVoiceUi();
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

ui.registerRuntimeButton.addEventListener("click", () => {
  registerRuntimeFromUi().catch((error) => {
    log(`Runtime registration failed: ${error.message}`, "error");
  });
});

ui.startHeartbeatButton.addEventListener("click", () => {
  if (!runtimeHeartbeat) {
    log("Runtime heartbeat is still initializing.", "warn");
    return;
  }

  runtimeHeartbeat.start();
  updateRuntimeUi();
});

ui.stopHeartbeatButton.addEventListener("click", () => {
  runtimeHeartbeat?.stop();
  updateRuntimeUi();
});

ui.startClawBridgeButton.addEventListener("click", () => {
  if (!clawBridgeClient) {
    log("KimiClaw bridge client is still initializing.", "warn");
    return;
  }

  if (activeConfig.robotRequireRuntimeAuth && !runtimeHeartbeat?.getRuntimeInfo?.().registered) {
    log("Register the browser runtime before starting KimiClaw Bridge.", "warn");
    return;
  }

  clawBridgeClient.start();
  log("KimiClaw Cloud bridge listening.");
});

ui.stopClawBridgeButton.addEventListener("click", () => {
  if (!clawBridgeClient) {
    log("KimiClaw bridge client is still initializing.", "warn");
    return;
  }

  clawBridgeClient.stop();
});

ui.injectTestClawActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "curious_scan",
    args: {
      direction: "both",
      intensity: 0.7
    },
    reason: "local UI test"
  }).catch((error) => {
    log(`Inject test Claw action failed: ${error.message}`, "error");
  });
});

ui.injectComeHereActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "approach_user",
    args: {
      style: "happy",
      distance: "short"
    },
    reason: "local UI come here test"
  }).catch((error) => {
    log(`Inject Come Here action failed: ${error.message}`, "error");
  });
});

ui.injectStopActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "stop",
    args: {
      reason: "local_ui_test_stop"
    },
    reason: "local UI stop test"
  }).catch((error) => {
    log(`Inject Stop action failed: ${error.message}`, "error");
  });
});

ui.injectSpeakActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "speak",
    args: {
      text: "I heard the cloud action.",
      tone: "curious"
    },
    reason: "local UI speech test"
  }).catch((error) => {
    log(`Inject Speak action failed: ${error.message}`, "error");
  });
});

ui.injectOpenFrontCameraActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "open_front_camera",
    args: {},
    reason: "local UI camera open test"
  }).catch((error) => {
    log(`Inject Open Front Camera action failed: ${error.message}`, "error");
  });
});

ui.injectObserveSceneActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "observe_scene",
    args: {
      includeSnapshot: false
    },
    reason: "local UI observe scene test"
  }).catch((error) => {
    log(`Inject Observe Scene action failed: ${error.message}`, "error");
  });
});

ui.injectCaptureSnapshotActionButton.addEventListener("click", () => {
  injectClawAction({
    source: "test",
    type: "capture_snapshot",
    args: {
      includeDataUrl: true,
      maxWidth: activeConfig.cameraSnapshotMaxWidth ?? PUBLIC_CONFIG.cameraSnapshotMaxWidth ?? 320
    },
    reason: "local UI snapshot test"
  }).catch((error) => {
    log(`Inject Capture Snapshot action failed: ${error.message}`, "error");
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

ui.speedSlider.addEventListener("input", updateSliderLabels);
ui.durationSlider.addEventListener("input", updateSliderLabels);

init();

async function init() {
  activeConfig = await loadPublicConfig();
  cloudCameraAllowed = Boolean(activeConfig.cloudCameraAllowedDefault);

  bodyCalibration = new BodyCalibration({
    logger: (message, level = "info") => log(message, level)
  });
  bodyCalibration.load();
  bodyCalibration.onChange((settings) => {
    lifeEngine?.setCalibration?.(bodyCalibration);
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

  cameraInput = new CameraInput({
    videoElement: ui.cameraPreview,
    canvasElement: ui.cameraCanvas,
    analysisIntervalMs: 500,
    logger: (message, level = "info") => log(message, level)
  });
  cameraInput.onStatus(updateCameraUi);
  cameraInput.onObservation(handleCameraObservation);
  cameraInput.onSnapshot(handleCameraSnapshot);

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

  runtimeHeartbeat = new RuntimeHeartbeat({
    intervalMs:
      activeConfig.robotRuntimeHeartbeatMs ??
      PUBLIC_CONFIG.robotRuntimeHeartbeatMs ??
      1000,
    requireRuntimeAuth: Boolean(activeConfig.robotRequireRuntimeAuth),
    getStatusSnapshot,
    logger: (message, level = "info") => log(message, level)
  });
  runtimeHeartbeat.onStatus(updateRuntimeUi);

  clawBridgeClient = new ClawBridgeClient({
    pollMs: activeConfig.robotBridgePollMs ?? PUBLIC_CONFIG.robotBridgePollMs ?? 1000,
    logger: (message, level = "info") => log(message, level),
    getAuthHeaders: () => runtimeHeartbeat?.getAuthHeaders?.() ?? {}
  });
  clawBridgeClient.onStatus(updateClawBridgeStatus);
  clawBridgeClient.onAction(handleClawBridgeAction);

  toolExecutor = new ToolExecutor({
    lifeEngine,
    face,
    robotClient,
    commandQueue,
    clawBridgeClient,
    voiceOutput,
    cameraInput,
    logger: (message, level = "info") => log(message, level),
    getRuntimeContext,
    getExecutionPolicy
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
  updateConnectionState(robotClient.getStatus());
  updateLifeEngineToggle();
  updateSimulatorUi();
  updateCloudExecutionUi();
  updateRuntimeUi();
  updateVoiceUi();
  updateCameraUi();
  updateCalibrationUi();
  updatePersonalityUi();
  updateLifeEventsUi();
  updateClawBridgeStatus(clawBridgeClient);
  renderClawActionList([]);
  refreshLearnedPhrases().catch((error) => {
    log(`Learned phrase cache unavailable: ${error.message}`, "warn");
  });
  log("UI ready.");
  log(
    activeConfig.robotRequireRuntimeAuth
      ? "Runtime auth is enabled. Pair this browser before starting bridge polling."
      : "Runtime auth is disabled for local development. Register runtime to publish heartbeat status."
  );
  log("Cloud Motion is disarmed by default. Start the bridge separately, then arm only when supervised.");
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

  if (toolExecutor) {
    await toolExecutor.emergencyStop(reason);
  } else {
    await commandQueue.emergencyStop(reason);
    lifeEngine?.receiveEvent({ type: "stop", reason });
  }

  face.setExpression(reason === "manual_stop" ? "attentive" : "scared");
  log(message, level);
}

function handleSend() {
  const text = ui.userInput.value.trim();

  if (!text) {
    log("Empty input ignored.");
    return;
  }

  log(`User input: ${text}`);
  const inferredKnownIntent = inferKnownIntent(text, learnedPhraseCache);
  recordLearnedPhraseUse(inferredKnownIntent);
  lifeEngine?.receiveEvent({
    type: "user_text",
    text,
    inferredKnownIntent
  });
  lifeEngine?.requestBehavior("listen_pose").catch((error) => {
    log(`Attentive reaction failed: ${error.message}`, "warn");
  });
  postRobotEvent({
    source: "ui",
    type: "user_text",
    text,
    payload: {
      source: "typed_input",
      final: true,
      inferredKnownIntent
    },
    priority: "normal"
  });
  ui.userInput.value = "";
}

function handleInterimSpeech(payload) {
  ui.interimTranscript.textContent = payload.text;
  updateVoiceUi();
}

async function handleFinalSpeech(payload) {
  const text = payload.text.trim();

  if (!text) {
    return;
  }

  lastTranscript = {
    ...payload,
    text
  };
  ui.finalTranscript.textContent = text;
  ui.interimTranscript.textContent = "";
  log(`Heard: ${text}`);
  const inferredKnownIntent = inferKnownIntent(text, learnedPhraseCache);
  recordLearnedPhraseUse(inferredKnownIntent);
  lifeEngine?.receiveEvent({
    type: "user_speech",
    text,
    inferredKnownIntent
  });
  lifeEngine?.requestBehavior("listen_pose").catch((error) => {
    log(`Speech attention reaction failed: ${error.message}`, "warn");
  });

  if (isLocalStopPhrase(text)) {
    await emergencyStop("local_voice_stop", "Local voice stop phrase detected.", "error");
    await postRobotEvent({
      source: "phone-browser",
      type: "local_stop_phrase",
      text,
      payload: {
        confidence: payload.confidence,
        language: payload.language,
        final: true,
        inferredKnownIntent
      },
      priority: "high"
    });
    return;
  }

  await postRobotEvent({
    source: "phone-browser",
    type: "user_speech",
    text,
    payload: {
      confidence: payload.confidence,
      language: payload.language,
      final: true,
      inferredKnownIntent
    },
    priority: "normal"
  });
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
  if (activeConfig.robotRequireRuntimeAuth && !runtimeHeartbeat?.getRuntimeInfo?.().registered) {
    log("Robot event not posted: register runtime first.", "warn");
    ui.robotEventPostStatus.textContent = "runtime not registered";
    return null;
  }

  try {
    const response = await fetch("/api/robot-bridge/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(runtimeHeartbeat?.getAuthHeaders?.() ?? {})
      },
      body: JSON.stringify(event)
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? `HTTP ${response.status}`);
    }

    lastEventPosted = payload.event;
    ui.lastRobotEventPosted.textContent = `${payload.event.type} · ${payload.event.id}`;
    ui.robotEventPostStatus.textContent = "posted";
    updateLifeEventsUi();
    return payload.event;
  } catch (error) {
    ui.robotEventPostStatus.textContent = `failed: ${error.message}`;
    log(`Robot event post failed: ${error.message}`, "warn");
    return null;
  }
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

function recordLearnedPhraseUse(inferredKnownIntent) {
  if (inferredKnownIntent?.source !== "learned_phrase" || !inferredKnownIntent.id) {
    return;
  }

  fetch(`/api/memory/learned-phrases/${encodeURIComponent(inferredKnownIntent.id)}/use`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(runtimeHeartbeat?.getAuthHeaders?.() ?? {})
    }
  })
    .then(() => refreshLearnedPhrases())
    .catch(() => {});
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

async function registerRuntimeFromUi() {
  if (!runtimeHeartbeat) {
    throw new Error("Runtime heartbeat is not initialized.");
  }

  const pairingCode = ui.runtimePairingCodeInput.value.trim();
  const payload = await runtimeHeartbeat.register({
    name: "phone-browser",
    pairingCode
  });

  ui.runtimePairingCodeInput.value = "";
  updateRuntimeUi();
  log(`Runtime registered: ${payload.runtimeId}`);
  runtimeHeartbeat.start();
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

async function injectClawAction(action) {
  if (!clawBridgeClient) {
    throw new Error("KimiClaw bridge client is not initialized.");
  }

  const payload = await clawBridgeClient.injectTestAction(action);

  log(`Injected Claw action: ${payload.action.type}`);

  if (!clawBridgeClient?.isRunning()) {
    log("Start KimiClaw Bridge to claim the injected action.", "warn");
  }
}

async function handleClawBridgeAction(action) {
  log(
    `KimiClaw action received: ${action.type} from ${action.source} (${action.id})`,
    "info"
  );
  upsertClawAction(action, {
    localStatus: "executing",
    result: null
  });

  try {
    const result = await toolExecutor.executeBridgeAction(action);

    if (result.status === "completed") {
      await clawBridgeClient.completeAction(action.id, result);
    } else if (result.status === "rejected") {
      await clawBridgeClient.rejectAction(action.id, result);
    } else {
      await clawBridgeClient.failAction(action.id, result);
    }

    upsertClawAction(action, {
      status: result.status,
      localStatus: result.status,
      result
    });
    latestActionResult = summarizeActionResult(result);
    log(`KimiClaw action ${result.status}: ${result.message}`, result.status === "completed" ? "info" : "warn");
  } catch (error) {
    const failedResult = {
      status: "failed",
      actionId: action.id,
      type: action.type,
      executed: false,
      physical: false,
      message: error.message,
      detail: {},
      timestamp: new Date().toISOString()
    };
    upsertClawAction(action, {
      status: "failed",
      localStatus: "failed",
      result: failedResult
    });
    latestActionResult = summarizeActionResult(failedResult);
    await clawBridgeClient?.failAction?.(action.id, { message: error.message }).catch(() => {});
    log(`KimiClaw action failed: ${action.id}: ${error.message}`, "error");
  }
}

function updateClawBridgeStatus(status = {}) {
  const running =
    typeof status.isRunning === "function" ? status.isRunning() : Boolean(status.running);
  ui.clawBridgeState.textContent = running
    ? `listening (${status.receivedCount ?? 0} received${status.processing ? ", processing" : ""})`
    : "stopped";
  updateRuntimeUi();
}

function renderClawActionList(actions = []) {
  ui.clawActionList.replaceChildren();

  if (actions.length === 0) {
    const emptyItem = document.createElement("div");
    emptyItem.className = "claw-action-item";
    emptyItem.innerHTML = "<strong>No Claw actions yet</strong><span>Start the bridge or inject a test action.</span>";
    ui.clawActionList.append(emptyItem);
    return;
  }

  actions.slice(0, 10).forEach((action) => {
    const item = document.createElement("div");
    const status = action.localStatus ?? action.status ?? "unknown";
    item.className = `claw-action-item claw-action-item--${status}`;

    const title = document.createElement("strong");
    title.textContent = `${action.type} · ${status}`;

    const details = document.createElement("span");
    const result = action.result;
    const resultText = result
      ? ` · physical=${String(result.physical)} executed=${String(result.executed)} · ${result.message}`
      : "";
    details.textContent = `${action.id} · ${action.source} · ${JSON.stringify(action.args ?? {})}${resultText}`;

    item.append(title, details);
    ui.clawActionList.append(item);
  });
}

function upsertClawAction(action, updates = {}) {
  const existingIndex = clawActionRecords.findIndex((item) => item.id === action.id);
  const nextAction = {
    ...(existingIndex >= 0 ? clawActionRecords[existingIndex] : action),
    ...action,
    ...updates
  };

  if (existingIndex >= 0) {
    clawActionRecords[existingIndex] = nextAction;
  } else {
    clawActionRecords.unshift(nextAction);
  }

  clawActionRecords = clawActionRecords.slice(0, 20);
  renderClawActionList(clawActionRecords);
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
    minPwm: 0,
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

function updateCloudExecutionUi() {
  ui.cloudMotionArmButton.textContent = cloudMotionArmed
    ? "Disarm Cloud Motion"
    : "Arm Cloud Motion";
  ui.cloudMotionState.textContent = cloudMotionArmed
    ? "ARMED - cloud actions may move the body through Life Engine"
    : "DISARMED - cloud actions cannot move the body";
  ui.cloudMotionState.classList.toggle("cloud-motion-state--armed", cloudMotionArmed);
  ui.cloudMotionState.classList.toggle("cloud-motion-state--disarmed", !cloudMotionArmed);
  document.body.classList.toggle("cloud-motion-armed", cloudMotionArmed);
}

function updateRuntimeUi(status = runtimeHeartbeat?.getRuntimeInfo?.()) {
  const info = status ?? {};
  const staleMs =
    activeConfig.robotRuntimeHeartbeatStaleMs ??
    PUBLIC_CONFIG.robotRuntimeHeartbeatStaleMs ??
    5000;
  const heartbeatAgeMs = info.lastHeartbeatAt ? Date.now() - Number(info.lastHeartbeatAt) : null;
  const online = info.running && heartbeatAgeMs !== null && heartbeatAgeMs <= staleMs;

  ui.runtimeAuthState.textContent = activeConfig.robotRequireRuntimeAuth
    ? "enabled - pairing required"
    : "disabled for local development";
  ui.runtimeIdDisplay.textContent = info.runtimeId ?? "not registered";
  ui.runtimeHeartbeatState.textContent = info.running
    ? info.lastError
      ? `running with warning: ${info.lastError}`
      : "running"
    : info.registered
      ? "registered, stopped"
      : "not registered";
  ui.runtimeLastHeartbeat.textContent = info.lastHeartbeatAt
    ? `${Math.round(heartbeatAgeMs / 100) / 10}s ago`
    : "--";
  ui.runtimeOnlineState.textContent = online ? "online" : "offline";
  ui.runtimeOnlineState.classList.toggle("runtime-state--online", online);
  ui.runtimeOnlineState.classList.toggle("runtime-state--offline", !online);
}

function updateVoiceUi() {
  const speechStatus = speechInput?.getStatus?.() ?? {
    supported: false,
    listening: false,
    secureContext: globalThis.isSecureContext !== false
  };
  const voiceStatus = voiceOutput?.getStatus?.() ?? {
    supported: false,
    muted: false,
    speaking: false
  };

  ui.speechSupportState.textContent = speechStatus.supported
    ? speechStatus.listening
      ? "listening"
      : "supported"
    : "unsupported";
  ui.speechSupportState.classList.toggle("voice-state--active", speechStatus.listening);
  ui.speechSupportState.classList.toggle("voice-state--warn", !speechStatus.supported);
  ui.speechSecureWarning.textContent = speechStatus.secureContext
    ? "Microphone access may require user permission."
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
  ui.cloudCameraState.textContent = cloudCameraAllowed
    ? "ALLOWED - cloud camera actions may use the local camera"
    : "BLOCKED - cloud camera actions are rejected";
  ui.cloudCameraState.classList.toggle("cloud-camera-state--allowed", cloudCameraAllowed);
  ui.cloudCameraState.classList.toggle("cloud-camera-state--blocked", !cloudCameraAllowed);
  ui.cloudCameraAllowButton.textContent = cloudCameraAllowed
    ? "Block Cloud Camera"
    : "Allow Cloud Camera";
  document.body.classList.toggle("cloud-camera-allowed", cloudCameraAllowed);
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
    cloudMotionArmed,
    cloudCameraAllowed,
    simulatorMode,
    robotConnected: Boolean(robotClient?.isConnected?.()),
    allowSpeak: ui.cloudSpeakToggle.checked,
    allowNonPhysical: ui.cloudNonPhysicalToggle.checked
  };
}

function getStatusSnapshot() {
  const lifeState = lifeEngine?.getState?.() ?? {};

  return {
    cloudMotionArmed,
    simulatorMode,
    bridgePolling: Boolean(clawBridgeClient?.isRunning?.()),
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
    learnedPhraseCount: learnedPhraseCache.length,
    telemetry: robotClient?.getLatestTelemetry?.() ?? null,
    latestAction: latestActionResult,
    calibration: bodyCalibration?.getSettings?.() ?? null,
    recentCommands: commandQueue?.getRecentCommands?.({ limit: 5 }) ?? [],
    cloudCameraAllowed,
    camera: compactCameraStatus(cameraInput?.getCameraStatus?.()),
    voice: {
      speechListening: Boolean(speechInput?.getStatus?.().listening),
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
    robotTelemetry: robotClient?.getLatestTelemetry?.() ?? null,
    connectionState: ui.connectionState.textContent,
    simulatorMode,
    cloudMotionArmed,
    cloudCameraAllowed,
    calibration: bodyCalibration?.getSettings?.() ?? null,
    personality: describePersonalityForRuntime(personalityTuning?.getProfile?.()),
    lifeSignals: {
      loneliness: lifeState?.loneliness,
      comfort: lifeState?.comfort,
      interactionCount: lifeState?.interactionCount,
      stopRespectActive: Number(lifeState?.stopRespectUntil || 0) > Date.now(),
      lifeEventsEnabled
    },
    learnedPhraseCount: learnedPhraseCache.length,
    recentCommands: commandQueue?.getRecentCommands?.({ limit: 8 }) ?? [],
    recentLifeEvents: lifeState?.recentEvents ?? [],
    cameraStatus,
    latestObservation: cameraStatus.observation,
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
    cache: "no-store",
    headers: {
      ...(runtimeHeartbeat?.getAuthHeaders?.() ?? {})
    }
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
    headers: {
      "Content-Type": "application/json",
      ...(runtimeHeartbeat?.getAuthHeaders?.() ?? {})
    },
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

function log(message, level = "info") {
  const entry = document.createElement("div");
  const time = new Date().toLocaleTimeString();

  entry.className = `log-entry log-entry--${level}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-text"></span>`;
  entry.querySelector(".log-text").textContent = message;

  ui.logPanel.append(entry);
  ui.logPanel.scrollTop = ui.logPanel.scrollHeight;
}
