import assert from "node:assert/strict";
import { ObjectTracker } from "../public/js/vision/objectTracker.js";
import { VisionState } from "../public/js/vision/visionState.js";
import {
  buildVisionContext,
  findMentionedObjectLabels,
  summarizeVisibleObjects
} from "../public/js/vision/visionMetadataBuilder.js";
import { FollowTargetController } from "../public/js/vision/followTargetController.js";
import { VisionScenarioManager } from "../public/js/vision/visionScenarioManager.js";
import { validateBrainAction, LOCAL_BRAIN_ALLOWED_ACTIONS } from "../public/js/localBrain/actionParser.js";
import { ToolExecutor } from "../public/js/robot/toolExecutor.js";
import { setVisionIndicator } from "../public/js/ui/faceCanvas.js";

const baseTime = Date.now();

function detection(label, centerX, { confidence = 0.82, areaRatio = 0.08, distance = "medium" } = {}) {
  return {
    label,
    displayName: label,
    confidence,
    bbox: {
      x: centerX * 640 - 40,
      y: 180,
      width: 80,
      height: 80
    },
    centerX,
    centerY: 0.5,
    areaRatio,
    position: centerX < 0.4 ? "left" : centerX > 0.6 ? "right" : "center",
    verticalPosition: "middle",
    distance,
    rawCategoryIndex: null
  };
}

function detectionResult(offsetMs, detections) {
  return {
    timestamp: new Date(baseTime + offsetMs).toISOString(),
    frameWidth: 640,
    frameHeight: 480,
    detections
  };
}

function createVisionRuntime({ policy = {} } = {}) {
  const events = [];
  const motions = [];
  const tracker = new ObjectTracker({ maxLostMs: 2000 });
  const visionState = new VisionState();
  const commandQueue = {
    isBusy: () => false,
    getQueueLength: () => 0,
    enqueueMotion: async (motion) => {
      motions.push(motion);
      return motion;
    },
    emergencyStop: async (reason) => {
      events.push({ type: "emergency_stop", reason });
    }
  };
  const eventBus = {
    publish: (type, payload) => {
      events.push({ type, payload });
      return { type, payload };
    }
  };
  const voiceOutput = {
    spoken: [],
    speak(payload) {
      this.spoken.push(payload);
      return Promise.resolve({ executed: true });
    },
    cancel() {}
  };
  const controller = new FollowTargetController({
    visionState,
    objectTracker: tracker,
    commandQueue,
    eventBus,
    voiceOutput,
    lifeEngine: { getState: () => ({ obstacle: false, stopRespectUntil: 0 }) },
    getPolicy: () => ({
      localMotionArmed: false,
      followModeArmed: false,
      allowFollowMovement: false,
      robotConnected: true,
      localSpeechAllowed: true,
      maxObjectFollowSpeed: 0.18,
      ...policy
    })
  });

  return { tracker, visionState, controller, commandQueue, eventBus, voiceOutput, events, motions };
}

function updateVision({ tracker, visionState }, result) {
  const tracks = tracker.update(result);
  visionState.updateFromDetections(result, tracks);
  return tracks;
}

{
  const tracker = new ObjectTracker({ maxLostMs: 2000 });
  const first = tracker.update(detectionResult(0, [detection("apple", 0.5)]));
  assert.equal(first.length, 1);
  const trackId = first[0].id;
  const second = tracker.update(detectionResult(500, [detection("apple", 0.52)]));
  assert.equal(second[0].id, trackId);
  assert.equal(second[0].visible, true);
  const lost = tracker.update(detectionResult(3000, []));
  assert.equal(lost[0].id, trackId);
  assert.equal(lost[0].visible, false);
  const reacquired = tracker.update(detectionResult(3500, [detection("apple", 0.51)]));
  assert.equal(reacquired[0].id, trackId);
  assert.equal(reacquired[0].visible, true);
}

{
  const runtime = createVisionRuntime();
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5), detection("person", 0.25)]));
  const metadata = runtime.visionState.getObjectMetadataForBrain();
  assert.match(metadata.summary, /apple/);
  assert.equal(runtime.visionState.isObjectVisible("apple"), true);
  runtime.visionState.setActiveTarget({ label: "apple" });
  assert.equal(runtime.visionState.getActiveTarget().label, "apple");
  runtime.visionState.clearActiveTarget("test_clear");
  assert.equal(runtime.visionState.getActiveTarget(), null);
}

{
  assert.deepEqual(findMentionedObjectLabels("can you see this apple?", []), ["apple"]);
  assert.deepEqual(findMentionedObjectLabels("follow the remote controller", []), ["remote"]);
  assert.match(summarizeVisibleObjects([{ label: "banana", visible: true, position: "center", distance: "near" }]), /banana/);
}

{
  const runtime = createVisionRuntime();
  const leftMotion = runtime.controller.computeMotionForTarget({ label: "apple", centerX: 0.2, distance: "medium" });
  const rightMotion = runtime.controller.computeMotionForTarget({ label: "apple", centerX: 0.8, distance: "medium" });
  const forwardMotion = runtime.controller.computeMotionForTarget({ label: "apple", centerX: 0.5, distance: "far" });
  assert.ok(leftMotion.angular < 0);
  assert.ok(rightMotion.angular > 0);
  assert.ok(forwardMotion.linear > 0);

  updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.tick();
  assert.equal(runtime.motions.length, 0, "disarmed follow must not enqueue movement");
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true,
      followModeArmed: true,
      allowFollowMovement: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.tick();
  assert.equal(runtime.motions.length, 1);
  assert.match(runtime.motions[0].label, /follow_target_apple_left/);
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true,
      followModeArmed: true,
      allowFollowMovement: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  runtime.controller.start({ label: "apple" });
  updateVision(runtime, detectionResult(3000, []));
  runtime.controller.tick();
  assert.ok(runtime.events.some((event) => event.type === "vision_target_lost"));
  assert.match(runtime.voiceOutput.spoken[0].text, /can't see the apple/);
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime();
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  const manager = new VisionScenarioManager({
    cameraInput: { isRunning: () => true },
    objectDetectorEngine: { isRunning: () => true },
    objectTracker: runtime.tracker,
    visionState: runtime.visionState,
    followTargetController: runtime.controller,
    eventBus: runtime.eventBus,
    getPolicy: () => ({ localVisionEnabled: true }),
    face: { setVisionIndicator() {} }
  });
  const started = await manager.startFollowTarget({ label: "apple" });
  assert.equal(started.executed, true);
  assert.equal(runtime.controller.isRunning(), true);
  const stopped = manager.stopScenario("test_stop");
  assert.equal(stopped.executed, true);
}

{
  const runtime = createVisionRuntime();
  let detectorStopped = false;
  const manager = new VisionScenarioManager({
    cameraInput: { isRunning: () => true },
    objectDetectorEngine: {
      isRunning: () => true,
      detectOnce: async () => detectionResult(0, []),
      stop: () => {
        detectorStopped = true;
      }
    },
    objectTracker: runtime.tracker,
    visionState: runtime.visionState,
    followTargetController: runtime.controller,
    eventBus: runtime.eventBus,
    getPolicy: () => ({ localVisionEnabled: true }),
    face: { setVisionIndicator() {} }
  });
  const missing = await manager.startFollowTarget({ label: "banana" });
  assert.equal(missing.executed, false);
  assert.equal(missing.detail.scenarioState, "not_found");
  assert.equal(detectorStopped, true);
  assert.ok(runtime.events.some((event) => event.type === "vision_follow_starting"));
  assert.ok(runtime.events.some((event) => event.type === "vision_follow_not_found"));
}

{
  const runtime = createVisionRuntime();
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  const manager = new VisionScenarioManager({
    cameraInput: { isRunning: () => true },
    objectDetectorEngine: { isRunning: () => true },
    objectTracker: runtime.tracker,
    visionState: runtime.visionState,
    followTargetController: runtime.controller,
    eventBus: runtime.eventBus,
    getPolicy: () => ({ localVisionEnabled: true }),
    face: { setVisionIndicator() {} }
  });
  const executor = new ToolExecutor({
    visionScenarioManager: manager,
    followTargetController: runtime.controller,
    visionState: runtime.visionState,
    commandQueue: runtime.commandQueue,
    robotClient: { isConnected: () => true },
    lifeEngine: { getState: () => ({ stopRespectUntil: 0 }), receiveEvent() {} },
    face: { dismissPhoto() {}, setExpression() {} },
    voiceOutput: { cancel() {} },
    getRuntimeContext: () => ({
      geminiLive: { lastInputTranscript: "do you still see it" }
    }),
    getExecutionPolicy: () => ({ localMotionArmed: true, localSpeechAllowed: true, robotConnected: true })
  });
  const setResult = await executor.executeBridgeAction({
    type: "set_follow_target",
    source: "local_brain",
    args: { label: "apple" }
  });
  assert.equal(setResult.status, "completed");
  const rejectedStop = await executor.executeBridgeAction({
    type: "follow_target_stop",
    source: "gemini_live",
    args: { reason: "conversation_turn" }
  });
  assert.equal(rejectedStop.status, "rejected");
  const stopResult = await executor.executeBridgeAction({
    type: "follow_target_stop",
    source: "local_brain",
    args: { reason: "test_stop" }
  });
  assert.equal(stopResult.status, "completed");
}

{
  assert.equal(LOCAL_BRAIN_ALLOWED_ACTIONS.has("perform"), true);
  assert.equal(LOCAL_BRAIN_ALLOWED_ACTIONS.has("set_follow_target"), true);
  assert.equal(LOCAL_BRAIN_ALLOWED_ACTIONS.has("follow_target_stop"), true);
  assert.equal(validateBrainAction({ type: "set_follow_target", args: { label: "apple" } }).ok, true);
  assert.equal(validateBrainAction({ type: "raw_motor", args: { pwm: 255 } }).ok, false);
  assert.equal(validateBrainAction({ type: "perform", args: { pwm: 255 } }).ok, false);
}

{
  const runtime = createVisionRuntime();
  updateVision(runtime, detectionResult(0, [detection("cup", 0.5)]));
  const context = buildVisionContext({
    visionState: runtime.visionState,
    cameraInput: { getCameraStatus: () => ({ running: true, facingMode: "user" }) },
    objectTracker: runtime.tracker
  });
  assert.equal(context.objects[0].label, "cup");
  assert.equal(context.visibleLabels, "cup");
  assert.equal(Object.hasOwn(context, "summary"), false);
}

assert.equal(typeof setVisionIndicator, "function");

console.log("smoke:object-follow passed");
