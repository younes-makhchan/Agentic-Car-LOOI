import assert from "node:assert/strict";
import { ToolExecutor } from "../public/js/robot/toolExecutor.js";

const logs = [];
const faceEvents = [];
const stops = [];
const motions = [];
const routedSequences = [];
const policy = {
  cloudMotionArmed: false,
  cloudCameraAllowed: false,
  simulatorMode: true,
  robotConnected: true,
  allowSpeak: true,
  allowNonPhysical: true,
  localMotionArmed: false,
  localCameraAllowed: false,
  localSpeechAllowed: true
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
      simulated: true,
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
    connectionState: "simulated_connected",
    simulatorMode: true,
    localMotionArmed: policy.localMotionArmed,
    localCameraAllowed: policy.localCameraAllowed,
    cameraStatus,
    recentLifeEvents: []
  })
});

const rejectedLegacy = await executor.executeBridgeAction({
  id: "legacy_express",
  source: "gemini_live",
  type: "express",
  args: { emotion: "happy" }
});
assert.equal(rejectedLegacy.status, "rejected");
assert.match(rejectedLegacy.message, /Unknown action type/i);

const rejectedInternalFromGemini = await executor.executeBridgeAction({
  id: "internal_pose_gemini",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "pose_happy" }
});
assert.equal(rejectedInternalFromGemini.status, "rejected");

const internalPose = await executor.executeBridgeAction({
  id: "internal_pose_ui",
  source: "local",
  type: "run_scenario",
  args: { name: "pose_happy" }
});
assert.equal(internalPose.status, "completed");
assert.equal(internalPose.detail.scenario, "pose_happy");
assert.equal(faceEvents.some((event) => event.type === "expression" && event.expression === "happy"), true);

const disarmedScenario = await executor.executeBridgeAction({
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
const bodyScenario = await executor.executeBridgeAction({
  id: "scenario_body",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "body_talking" }
});
assert.equal(bodyScenario.status, "completed");
assert.equal(bodyScenario.physical, true);
assert.equal("scenarioMovement" in bodyScenario.detail, false);
assert.equal(routedSequences.at(-1).action.args.frames.some((frame) => frame.label === "scenario_tiny_turn_left"), true);
assert.equal(motions.some((motion) => motion.label === "scenario_tiny_turn_left"), true);

policy.localCameraAllowed = true;
const photoScenario = await executor.executeBridgeAction({
  id: "scenario_photo",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "take_picture" }
});
assert.equal(photoScenario.status, "completed");
assert.equal(photoScenario.detail.scenario, "take_picture");
assert.equal(photoScenario.detail.actionDetails.some((entry) => entry.action === "photoPoseAndCapture"), true);
assert.equal(cameraCalls.some((call) => call.type === "snapshot"), true);
assert.equal(faceEvents.some((event) => event.type === "take_picture"), true);
assert.equal(faceEvents.some((event) => event.type === "show_photo"), true);

const followStarted = [];
executor.setVisionControllers({
  visionScenarioManager: {
    async startFollowTarget(payload) {
      followStarted.push(payload);
      return {
        status: "completed",
        executed: true,
        message: `Started following ${payload.label}.`,
        detail: { targetLabel: payload.label, scenario: "follow_object" }
      };
    },
    stopFollowing(reason) {
      return { ok: true, reason };
    }
  },
  followTargetController: {
    isRunning() {
      return true;
    },
    stop(reason) {
      return { ok: true, reason };
    }
  }
});
const followScenario = await executor.executeBridgeAction({
  id: "follow_1",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "follow_target", label: "bottle", mode: "gentle" }
});
assert.equal(followScenario.status, "completed");
assert.equal(followStarted.at(-1).label, "bottle");

const rejectedFollowStop = await executor.executeBridgeAction({
  id: "follow_stop_rejected",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "stop_following", reason: "conversation_continues" }
});
assert.equal(rejectedFollowStop.status, "rejected");

executor.getRuntimeContext = () => ({
  geminiLive: { lastInputTranscript: "stop following it" }
});
const stoppedFollow = await executor.executeBridgeAction({
  id: "follow_stop",
  source: "gemini_live",
  type: "run_scenario",
  args: { name: "stop_following", reason: "user_request" }
});
assert.equal(stoppedFollow.status, "completed");

const stopResult = await executor.executeBridgeAction({
  id: "stop_1",
  source: "local",
  type: "stop",
  args: { reason: "smoke_stop" }
});
assert.equal(stopResult.status, "completed");
assert.equal(stopResult.executed, true);
assert.equal(routedSequences.some((entry) => entry.action.type === "stop"), true);

const unknownResult = await executor.executeBridgeAction({
  id: "unknown_1",
  source: "test",
  type: "raw_pwm",
  args: {}
});
assert.equal(unknownResult.status, "rejected");

console.log(
  JSON.stringify({
    ok: true,
    results: executor.getActionHistory().length,
    routed: routedSequences.length,
    logs: logs.length
  })
);
