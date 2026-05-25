import assert from "node:assert/strict";
import { ToolExecutor } from "../public/js/robot/toolExecutor.js";

const logs = [];
const faceEvents = [];
const stops = [];
const motions = [];
const routedSequences = [];
let eatingActive = false;
let drinkingActive = false;
let tellingActive = false;
const policy = {
  robotConnected: true,
  localMotionArmed: false
};

const face = {
  setExpression(expression, intensity) {
    faceEvents.push({ type: "expression", expression, intensity });
  },
  setEyeDirection(direction) {
    faceEvents.push({ type: "eye", direction });
  },
  takePicture() {
    faceEvents.push({ type: "take_picture" });
  },
  takeBite() {
    eatingActive = true;
    faceEvents.push({ type: "take_bite" });
  },
  finishBurger() {
    eatingActive = false;
    faceEvents.push({ type: "finish_burger" });
  },
  isEatingActive() {
    return eatingActive;
  },
  openDrink() {
    drinkingActive = true;
    faceEvents.push({ type: "open_drink" });
  },
  finishDrink() {
    drinkingActive = false;
    faceEvents.push({ type: "finish_drink" });
  },
  isDrinkingActive() {
    return drinkingActive;
  },
  showQuestion() {
    faceEvents.push({ type: "question" });
  },
  showAngry() {
    faceEvents.push({ type: "angry" });
  },
  showLoving() {
    faceEvents.push({ type: "loving" });
  },
  showShocked() {
    faceEvents.push({ type: "shocked" });
  },
  showTellMeAboutYourself() {
    tellingActive = true;
    faceEvents.push({ type: "tell_me_about_yourself" });
  },
  finishTellMeAboutYourself() {
    tellingActive = false;
    faceEvents.push({ type: "finish_telling" });
  },
  isTellingActive() {
    return tellingActive;
  },
  showKiss() {
    faceEvents.push({ type: "kiss" });
    return true;
  },
  showPhoto(dataUrl) {
    faceEvents.push({ type: "show_photo", dataUrl });
  },
  dismissPhoto() {
    faceEvents.push({ type: "dismiss_photo" });
  }
};

const robotClient = {
  isConnected() {
    return policy.robotConnected;
  },
  getLatestTelemetry() {
    return {
      motor_state: "stopped"
    };
  }
};

const commandQueue = {
  async enqueueMotion(command) {
    motions.push(command);
    return { ok: true, command };
  },
  async stopMotion(reason) {
    stops.push(reason);
    return { ok: true, reason };
  }
};

const cameraStatus = {
  supported: true,
  secureContext: true,
  running: true,
  facingMode: "user",
  hasStream: true,
  lastError: null,
  lastFrameAt: Date.now(),
  lastSnapshotAt: null,
  visionSupported: { faceDetector: false },
  observation: null
};
const cameraCalls = [];
const cameraInput = {
  getCameraStatus() {
    return cameraStatus;
  },
  async startCamera({ facingMode }) {
    cameraCalls.push({ type: "start", facingMode });
    cameraStatus.running = true;
    cameraStatus.facingMode = facingMode;
    return { ok: true, status: cameraStatus };
  },
  async captureSnapshot({ includeDataUrl, maxWidth }) {
    cameraCalls.push({ type: "snapshot", includeDataUrl, maxWidth });
    return {
      ok: true,
      status: cameraStatus,
      snapshot: {
        timestamp: new Date().toISOString(),
        facingMode: cameraStatus.facingMode,
        width: maxWidth,
        height: 180,
        dataUrl: includeDataUrl ? "data:image/jpeg;base64,AA==" : null,
        bytesApprox: 2,
        note: "small local thumbnail"
      }
    };
  }
};
const backCameraCalls = [];
let backCameraRunning = false;
const backCameraProbe = {
  getStatus() {
    return {
      running: backCameraRunning,
      cameraStatus: {
        ...cameraStatus,
        running: backCameraRunning,
        facingMode: "environment"
      }
    };
  },
  async start({ targetLabel, reason }) {
    backCameraCalls.push({ type: "start", targetLabel, reason });
    backCameraRunning = true;
    return { ok: true, status: this.getStatus() };
  },
  async stop(reason) {
    backCameraCalls.push({ type: "stop", reason });
    backCameraRunning = false;
    return { ok: true, status: this.getStatus() };
  },
  async captureSnapshot({ includeDataUrl, maxWidth, targetLabel }) {
    backCameraCalls.push({ type: "snapshot", includeDataUrl, maxWidth, targetLabel });
    return {
      ok: true,
      status: this.getStatus(),
      snapshot: {
        timestamp: new Date().toISOString(),
        facingMode: "environment",
        source: "back_camera_probe",
        width: maxWidth,
        height: 180,
        dataUrl: includeDataUrl ? "data:image/jpeg;base64,BB==" : null,
        bytesApprox: 2,
        note: "back camera probe thumbnail"
      }
    };
  }
};

const lifeEngine = {
  getState() {
    return {
      mood: "neutral",
      energy: 0.7,
      boredom: 0.2,
      fear: 0,
      recentEvents: [],
      stopRespectUntil: 0
    };
  },
  patchState(partialState, reason) {
    return { partialState, reason };
  },
  receiveEvent(event) {
    return event;
  }
};

async function runMockFrames(frames = [], context = {}) {
  const skippedFrames = [];
  const details = [];
  let executedFrames = 0;

  for (const frame of Array.isArray(frames) ? frames : []) {
    if (frame.type === "motion") {
      if (context.allowMotion === false) {
        skippedFrames.push("motion_not_allowed");
        continue;
      }
      await commandQueue.enqueueMotion(frame);
      executedFrames += 1;
      continue;
    }

    if (frame.type === "face") {
      if (frame.expression) {
        face.setExpression(frame.expression, frame.intensity ?? 0.8);
      }
      if (frame.eyeDirection) {
        face.setEyeDirection(frame.eyeDirection);
      }
      executedFrames += 1;
      continue;
    }

    if (frame.type === "action" && typeof frame.action === "function") {
      const actionResult = await frame.action({
        face,
        cameraInput,
        backCameraProbe,
        commandQueue,
        lifeEngine,
        allowMotion: context.allowMotion !== false,
        allowCamera: context.allowCamera === true,
        wait: async () => {},
        playFrames: (inlineFrames = []) => runMockFrames(inlineFrames, context),
        log: (message, level = "info") => logs.push({ level, message })
      }, frame.args ?? {});

      details.push({
        type: "action",
        action: frame.action.name,
        detail: actionResult?.detail ?? null
      });

      if (actionResult?.ok === false) {
        return {
          ok: false,
          executed: executedFrames > 0,
          executedFrames,
          partial: true,
          skippedFrames,
          details,
          reason: actionResult.reason ?? "action_failed"
        };
      }

      executedFrames += 1;
      continue;
    }

    executedFrames += 1;
  }

  return {
    ok: true,
    executed: executedFrames > 0,
    executedFrames,
    partial: skippedFrames.length > 0,
    skippedFrames,
    details,
    reason: skippedFrames.length ? "partial" : "completed"
  };
}

async function settleAsyncScenario() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const executor = new ToolExecutor({
  lifeEngine,
  face,
  robotClient,
  commandQueue,
  cameraInput,
  embodiedActionRouter: {
    async execute(action, context) {
      routedSequences.push({ action, context });
      const result = await runMockFrames(action.args?.frames, context);
      return {
        ok: true,
        status: "completed",
        sequence: action.args?.name ?? action.args?.scenario ?? "scenario_sequence",
        result
      };
    }
  },
  logger: (message, level = "info") => logs.push({ level, message }),
  getExecutionPolicy: () => ({ ...policy }),
  getRuntimeContext: () => ({
    lifeState: lifeEngine.getState(),
    robotTelemetry: robotClient.getLatestTelemetry(),
    connectionState: "connected",
    localMotionArmed: policy.localMotionArmed,
    cameraStatus,
    recentLifeEvents: []
  })
});

const rejectedUnsupported = await executor.executeAction({
  id: "unsupported_express",
  source: "gemini_live",
  type: "express",
  args: { emotion: "happy" }
});
assert.equal(rejectedUnsupported.status, "rejected");
assert.match(rejectedUnsupported.message, /Unknown action type/i);

const rejectedInternalFromGemini = await executor.executeAction({
  id: "internal_pose_gemini",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "pose_happy" }
});
assert.equal(rejectedInternalFromGemini.status, "rejected");

const internalPose = await executor.executeAction({
  id: "internal_pose_ui",
  source: "local",
  type: "run_scenario",
  args: { name: "pose_happy" }
});
assert.equal(internalPose.status, "queued");
assert.equal(internalPose.detail.scenario, "pose_happy");
assert.equal(internalPose.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(faceEvents.some((event) => event.type === "expression" && event.expression === "happy"), true);

const disarmedScenario = await executor.executeAction({
  id: "scenario_disarmed",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "body_talking" }
});
assert.equal(disarmedScenario.status, "rejected");
assert.equal(disarmedScenario.executed, false);
assert.match(disarmedScenario.message, /local_motion_not_armed/i);
assert.equal(routedSequences.length, 1);

policy.localMotionArmed = true;
const bodyScenario = await executor.executeAction({
  id: "scenario_body",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "body_talking" }
});
assert.equal(bodyScenario.status, "queued");
assert.equal(bodyScenario.physical, true);
assert.equal(bodyScenario.detail.execution, "parallel");
assert.equal("scenarioMovement" in bodyScenario.detail, false);
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.frames.some((frame) => frame.label === "scenario_tiny_turn_left"), true);
assert.equal(motions.some((motion) => motion.label === "scenario_tiny_turn_left"), true);

const photoScenario = await executor.executeAction({
  id: "scenario_photo",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "take_picture" }
});
assert.equal(photoScenario.status, "queued");
assert.equal(photoScenario.detail.scenario, "take_picture");
assert.equal(photoScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "take_picture");
assert.equal(routedSequences.at(-1).action.args.frames.at(-1).args.camera, "auto");
assert.equal(cameraCalls.some((call) => call.type === "snapshot"), true);
assert.equal(faceEvents.some((event) => event.type === "take_picture"), true);
assert.equal(faceEvents.some((event) => event.type === "show_photo"), true);

const frontSnapshotsBeforeExplicitFrontPhoto = cameraCalls.filter((call) => call.type === "snapshot").length;
const explicitFrontPhotoScenario = await executor.executeAction({
  id: "scenario_photo_front",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "take_picture", camera: "front" }
});
assert.equal(explicitFrontPhotoScenario.status, "queued");
assert.equal(explicitFrontPhotoScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "take_picture");
assert.equal(routedSequences.at(-1).action.args.frames.at(-1).args.camera, "front");
assert.equal(
  cameraCalls.filter((call) => call.type === "snapshot").length,
  frontSnapshotsBeforeExplicitFrontPhoto + 1
);

const frontSnapshotsBeforeBackPhoto = cameraCalls.filter((call) => call.type === "snapshot").length;
const backPhotoScenario = await executor.executeAction({
  id: "scenario_photo_back",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "take_picture", camera: "back" }
});
assert.equal(backPhotoScenario.status, "queued");
assert.equal(backPhotoScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "take_picture");
assert.equal(routedSequences.at(-1).action.args.frames.at(-1).args.camera, "back");
assert.equal(cameraCalls.filter((call) => call.type === "snapshot").length, frontSnapshotsBeforeBackPhoto);
assert.equal(backCameraCalls.some((call) => call.type === "start"), true);
assert.equal(backCameraCalls.some((call) => call.type === "snapshot"), true);
assert.equal(backCameraCalls.some((call) => call.type === "stop" && call.reason === "capture_complete"), true);

const eatingScenario = await executor.executeAction({
  id: "scenario_eating",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "eating" }
});
assert.equal(eatingScenario.status, "queued");
assert.equal(eatingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(eatingActive, true);
assert.equal(routedSequences.at(-1).action.args.scenario, "eating");
assert.equal(faceEvents.some((event) => event.type === "take_bite"), true);

const routesBeforeEatingExit = routedSequences.length;
const backUpAfterEating = await executor.executeAction({
  id: "scenario_after_eating",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "back_up" }
});
assert.equal(backUpAfterEating.status, "queued");
assert.equal(backUpAfterEating.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(eatingActive, false);
assert.equal(routedSequences.length, routesBeforeEatingExit + 2);
assert.equal(routedSequences.at(-2).action.args.scenario, "finish_burger");
assert.equal(routedSequences.at(-1).action.args.scenario, "back_up");
assert.equal(faceEvents.some((event) => event.type === "finish_burger"), true);

const secondEatingScenario = await executor.executeAction({
  id: "scenario_eating_again",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "eating" }
});
assert.equal(secondEatingScenario.status, "queued");
assert.equal(secondEatingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(eatingActive, true);
const routesBeforeDirectFinish = routedSequences.length;
const directFinishBurger = await executor.executeAction({
  id: "scenario_direct_finish_burger",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "finish_burger" }
});
assert.equal(directFinishBurger.status, "queued");
assert.equal(directFinishBurger.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(eatingActive, false);
assert.equal(routedSequences.length, routesBeforeDirectFinish + 1);
assert.equal(routedSequences.at(-1).action.args.scenario, "finish_burger");

const drinkingScenario = await executor.executeAction({
  id: "scenario_drinking",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "drinking" }
});
assert.equal(drinkingScenario.status, "queued");
assert.equal(drinkingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(drinkingActive, true);
assert.equal(routedSequences.at(-1).action.args.scenario, "drinking");
assert.equal(faceEvents.some((event) => event.type === "open_drink"), true);

const routesBeforeDrinkExit = routedSequences.length;
const comeCloserAfterDrinking = await executor.executeAction({
  id: "scenario_after_drinking",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "come_closer" }
});
assert.equal(comeCloserAfterDrinking.status, "queued");
assert.equal(comeCloserAfterDrinking.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(drinkingActive, false);
assert.equal(routedSequences.length, routesBeforeDrinkExit + 2);
assert.equal(routedSequences.at(-2).action.args.scenario, "finish_drink");
assert.equal(routedSequences.at(-1).action.args.scenario, "come_closer");
assert.equal(faceEvents.some((event) => event.type === "finish_drink"), true);

const secondDrinkingScenario = await executor.executeAction({
  id: "scenario_drinking_again",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "drinking" }
});
assert.equal(secondDrinkingScenario.status, "queued");
assert.equal(secondDrinkingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(drinkingActive, true);
const routesBeforeDuplicateDrink = routedSequences.length;
const duplicateDrinkingScenario = await executor.executeAction({
  id: "scenario_drinking_duplicate",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "drinking" }
});
assert.equal(duplicateDrinkingScenario.status, "completed");
assert.equal(duplicateDrinkingScenario.executed, true);
assert.equal(duplicateDrinkingScenario.detail.alreadyActive, true);
assert.equal(drinkingActive, true);
assert.equal(routedSequences.length, routesBeforeDuplicateDrink);
const routesBeforeDirectFinishDrink = routedSequences.length;
const directFinishDrink = await executor.executeAction({
  id: "scenario_direct_finish_drink",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "finish_drink" }
});
assert.equal(directFinishDrink.status, "queued");
assert.equal(directFinishDrink.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(drinkingActive, false);
assert.equal(routedSequences.length, routesBeforeDirectFinishDrink + 1);
assert.equal(routedSequences.at(-1).action.args.scenario, "finish_drink");

const questionScenario = await executor.executeAction({
  id: "scenario_question",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "question" }
});
assert.equal(questionScenario.status, "queued");
assert.equal(questionScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "question");
assert.equal(faceEvents.some((event) => event.type === "question"), true);

const angryScenario = await executor.executeAction({
  id: "scenario_angry",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "angry" }
});
assert.equal(angryScenario.status, "queued");
assert.equal(angryScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "angry");
assert.equal(faceEvents.some((event) => event.type === "angry"), true);

const lovingScenario = await executor.executeAction({
  id: "scenario_loving",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "loving" }
});
assert.equal(lovingScenario.status, "queued");
assert.equal(lovingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "loving");
assert.equal(faceEvents.some((event) => event.type === "loving"), true);

const shockedScenario = await executor.executeAction({
  id: "scenario_shocked",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "shocked" }
});
assert.equal(shockedScenario.status, "queued");
assert.equal(shockedScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "shocked");
assert.equal(faceEvents.some((event) => event.type === "shocked"), true);

const tellMeAboutYourselfScenario = await executor.executeAction({
  id: "scenario_tell_me_about_yourself",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "tell_me_about_yourself" }
});
assert.equal(tellMeAboutYourselfScenario.status, "queued");
assert.equal(tellMeAboutYourselfScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "tell_me_about_yourself");
assert.equal(faceEvents.some((event) => event.type === "tell_me_about_yourself"), true);
assert.equal(tellingActive, true);

const kissScenario = await executor.executeAction({
  id: "scenario_kiss",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "kiss" }
});
assert.equal(kissScenario.status, "queued");
assert.equal(kissScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-2).action.args.scenario, "finish_telling");
assert.equal(faceEvents.some((event) => event.type === "finish_telling"), true);
assert.equal(routedSequences.at(-1).action.args.scenario, "kiss");
assert.equal(faceEvents.some((event) => event.type === "kiss"), true);
assert.equal(tellingActive, false);

tellingActive = true;
const directFinishTellingScenario = await executor.executeAction({
  id: "scenario_direct_finish_telling",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "finish_telling" }
});
assert.equal(directFinishTellingScenario.status, "queued");
assert.equal(directFinishTellingScenario.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(routedSequences.at(-1).action.args.scenario, "finish_telling");
assert.equal(faceEvents.some((event) => event.type === "finish_telling"), true);
assert.equal(tellingActive, false);

const followStarted = [];
const followStops = [];
let followRunning = false;
let followTargetLabel = "";
let followMode = "gentle";
executor.setVisionControllers({
  visionScenarioManager: {
    async startFollowTarget(payload) {
      followStarted.push(payload);
      followRunning = true;
      followTargetLabel = payload.label;
      followMode = payload.mode ?? "gentle";
      return {
        status: "completed",
        executed: true,
        message: `Started following ${payload.label}.`,
        detail: { targetLabel: payload.label, scenario: "follow_object" }
      };
    },
    stopFollowing(reason) {
      followStops.push(reason);
      followRunning = false;
      followTargetLabel = "";
      return { ok: true, reason };
    }
  },
  followTargetController: {
    isRunning() {
      return followRunning;
    },
    getStatus() {
      return {
        running: followRunning,
        targetLabel: followTargetLabel,
        mode: followMode
      };
    },
    stop(reason) {
      followRunning = false;
      followTargetLabel = "";
      return { ok: true, reason };
    }
  }
});
const followScenario = await executor.executeAction({
  id: "follow_1",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "follow_target", label: "bottle", mode: "gentle" }
});
assert.equal(followScenario.status, "completed");
assert.equal(followStarted.at(-1).label, "bottle");

const followStartsBeforeDuplicate = followStarted.length;
const followStopsBeforeDuplicate = followStops.length;
const duplicateFollowScenario = await executor.executeAction({
  id: "follow_duplicate",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "follow_target", label: "bottle", mode: "gentle" }
});
assert.equal(duplicateFollowScenario.status, "completed");
assert.equal(duplicateFollowScenario.executed, true);
assert.equal(duplicateFollowScenario.detail.alreadyActive, true);
assert.equal(followStarted.length, followStartsBeforeDuplicate);
assert.equal(followStops.length, followStopsBeforeDuplicate);
assert.equal(followRunning, true);

const followModeUpdate = await executor.executeAction({
  id: "follow_mode_update",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "follow_target", label: "bottle", mode: "curious" }
});
assert.equal(followModeUpdate.status, "completed");
assert.equal(followStarted.length, followStartsBeforeDuplicate + 1);
assert.equal(followStops.length, followStopsBeforeDuplicate);
assert.equal(followMode, "curious");

const activeFollowStopsBefore = followStops.length;
const activeFollowStop = await executor.executeAction({
  id: "follow_stop_active",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "stop_following", reason: "conversation_continues" }
});
assert.equal(activeFollowStop.status, "completed");
assert.equal(followStops.length, activeFollowStopsBefore + 1);

const followScenarioAgain = await executor.executeAction({
  id: "follow_2",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "follow_target", label: "bottle", mode: "gentle" }
});
assert.equal(followScenarioAgain.status, "completed");
assert.equal(followRunning, true);

const routesBeforeFollowExit = routedSequences.length;
const backUpWhileFollowing = await executor.executeAction({
  id: "back_up_while_following",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "back_up" }
});
assert.equal(backUpWhileFollowing.status, "queued");
assert.equal(backUpWhileFollowing.detail.execution, "parallel");
await settleAsyncScenario();
assert.equal(followRunning, false);
assert.equal(routedSequences.length, routesBeforeFollowExit + 1);
assert.equal(routedSequences.at(-1).action.args.scenario, "back_up");
assert.equal(followStops.at(-1), "before:back_up");

executor.getRuntimeContext = () => ({
  geminiLive: { lastInputTranscript: "stop following it" }
});
const stoppedFollow = await executor.executeAction({
  id: "follow_stop",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "stop_following", reason: "user_request" }
});
assert.equal(stoppedFollow.status, "completed");

const stopResult = await executor.executeAction({
  id: "stop_1",
  source: "local",
  type: "stop",
  args: { reason: "smoke_stop" }
});
assert.equal(stopResult.status, "completed");
assert.equal(stopResult.executed, true);
assert.equal(routedSequences.some((entry) => entry.action.type === "stop"), true);

const unknownResult = await executor.executeAction({
  id: "unknown_1",
  source: "test",
  type: "raw_pwm",
  args: {}
});
assert.equal(unknownResult.status, "rejected");

console.log(
  JSON.stringify({
    ok: true,
    results: routedSequences.length,
    routed: routedSequences.length,
    logs: logs.length
  })
);
