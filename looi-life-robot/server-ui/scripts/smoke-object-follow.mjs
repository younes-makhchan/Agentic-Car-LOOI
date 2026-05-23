import assert from "node:assert/strict";
import { ObjectDetectorEngine } from "../public/js/vision/objectDetectorEngine.js";
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
import { startFollow, stopFollow } from "../public/js/ui/faceCanvas.js";

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

function detectionResult(offsetMs, detections, extra = {}) {
  return {
    timestamp: new Date(baseTime + offsetMs).toISOString(),
    frameWidth: 640,
    frameHeight: 480,
    detections,
    ...extra
  };
}

function createVisionRuntime({ policy = {} } = {}) {
  const events = [];
  const motions = [];
  const tracker = new ObjectTracker({ maxLostMs: 3000 });
  const visionState = new VisionState();
  const commandQueue = {
    isBusy: () => false,
    getQueueLength: () => 0,
    sendRealtimeMotion: async (motion) => {
      motions.push({ ...motion, realtime: true });
      return motion;
    },
    enqueueMotion: async (motion) => {
      motions.push(motion);
      return motion;
    },
    stopMotion: async (reason) => {
      events.push({ type: "motion_stop", reason });
    }
  };
  const eventBus = {
    publish: (type, payload) => {
      events.push({ type, payload });
      return { type, payload };
    }
  };
  const controller = new FollowTargetController({
    visionState,
    objectTracker: tracker,
    commandQueue,
    eventBus,
    lifeEngine: { getState: () => ({ obstacle: false, stopRespectUntil: 0 }) },
    getPolicy: () => ({
      localMotionArmed: false,
      robotConnected: true,
      maxObjectFollowSpeed: 0.036,
      followCommandDurationMs: 30,
      followCommandRefreshMs: 70,
      ...policy
    })
  });

  return { tracker, visionState, controller, commandQueue, eventBus, events, motions };
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
  assert.equal(runtime.visionState.findObject("apple")?.visible, true);
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
  const leftSteering = runtime.controller.computeSteeringForTarget({ label: "apple", centerX: 0.2 });
  const rightSteering = runtime.controller.computeSteeringForTarget({ label: "apple", centerX: 0.8 });
  const centeredSteering = runtime.controller.computeSteeringForTarget({ label: "apple", centerX: 0.5, distance: "far" });
  assert.equal(leftSteering.direction, "left");
  assert.ok(leftSteering.angular < 0);
  assert.equal(rightSteering.direction, "right");
  assert.ok(rightSteering.angular > 0);
  assert.equal(centeredSteering.centered, true);
  assert.equal(centeredSteering.angular, 0);

  updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.tick();
  assert.equal(runtime.motions.length, 0, "disarmed follow must not send steering motion");
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.tick();
  assert.equal(runtime.motions.length, 1);
  assert.equal(runtime.motions[0].label, "roboflow_follow_turn_left");
  assert.equal(runtime.motions[0].linear, 0);
  assert.equal(runtime.motions[0].angular, -0.036);
  assert.equal(runtime.motions[0].durationMs, 30);
  assert.equal(runtime.motions[0].rampMs, 0);
  assert.equal(runtime.motions[0].realtime, true);
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  const first = updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple", trackId: first[0].id });
  updateVision(runtime, detectionResult(200, []));
  const duplicate = updateVision(runtime, detectionResult(300, [detection("apple", 0.82)]));
  const resolved = runtime.controller.resolveTrack();
  assert.equal(resolved.id, duplicate.find((track) => track.visible && !track.lostAt)?.id);
  assert.equal(runtime.controller.getTarget().trackId, resolved.id);
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  updateVision(runtime, detectionResult(-5000, [detection("cup", 0.7)], {
    receivedAt: new Date().toISOString()
  }));
  runtime.controller.start({ label: "cup" });
  runtime.controller.tick();
  const status = runtime.visionState.getStatus();
  assert.equal(status.activeTarget.visible, true);
  assert.notEqual(status.scenario.state, "lost");
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  const first = updateVision(runtime, detectionResult(0, [detection("cup", 0.1)]));
  runtime.controller.start({ label: "cup", trackId: first[0].id });
  updateVision(runtime, detectionResult(3000, []));
  runtime.controller.tick();
  assert.equal(runtime.visionState.getStatus().scenario.state, "lost");
  const reacquired = updateVision(runtime, detectionResult(3500, [detection("cup", 0.9)]));
  const visibleCup = reacquired.find((track) => track.visible && track.label === "cup");
  runtime.controller.tick();
  const status = runtime.visionState.getStatus();
  assert.equal(status.activeTarget.visible, true);
  assert.equal(status.activeTarget.trackId, visibleCup.id);
  assert.equal(status.scenario.state, "following");
  assert.ok(runtime.events.some((event) => event.type === "vision_target_reacquired"));
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.2)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.followMotionActive = true;
  updateVision(runtime, detectionResult(200, []));
  runtime.controller.tick();
  assert.equal(runtime.visionState.getStatus().scenario.state, "searching");
  assert.equal(runtime.events.some((event) => event.type === "vision_target_lost"), false);
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  runtime.controller.start({ label: "apple" });
  runtime.controller.followMotionActive = true;
  runtime.controller.tick();
  assert.ok(runtime.events.some((event) => event.type === "motion_stop" && event.reason === "follow_target_centered"));
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime({
    policy: {
      localMotionArmed: true
    }
  });
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  runtime.controller.start({ label: "apple" });
  updateVision(runtime, detectionResult(3000, []));
  runtime.controller.tick();
  assert.ok(runtime.events.some((event) => event.type === "vision_target_lost"));
  runtime.controller.stop("test_stop");
}

{
  const runtime = createVisionRuntime();
  let armedFollow = null;
  let detectorStartCount = 0;
  let detectorStopCount = 0;
  updateVision(runtime, detectionResult(0, [detection("apple", 0.5)]));
  const manager = new VisionScenarioManager({
    cameraInput: { isRunning: () => true },
    objectDetectorEngine: {
      isRunning: () => true,
      getStatus: () => ({ running: true }),
      start: async () => {
        detectorStartCount += 1;
        return { running: true };
      },
      stop: () => {
        detectorStopCount += 1;
      }
    },
    objectTracker: runtime.tracker,
    visionState: runtime.visionState,
    followTargetController: runtime.controller,
    eventBus: runtime.eventBus,
    armMovement: (detail) => {
      armedFollow = detail;
    },
    face: { startFollow() {}, stopFollow() {} }
  });
  const started = await manager.startFollowTarget({ label: "apple" });
  assert.equal(started.executed, true);
  assert.equal(detectorStartCount, 0);
  assert.equal(detectorStopCount, 0);
  assert.equal(armedFollow?.reason, "follow_target_start");
  assert.equal(armedFollow?.resolvedLabel, "apple");
  assert.equal(runtime.controller.isRunning(), true);
  const stopped = manager.stopFollowing("test_stop");
  assert.equal(stopped.executed, true);
}

{
  const runtime = createVisionRuntime();
  const callbacks = new Set();
  const manager = new VisionScenarioManager({
    cameraInput: { isRunning: () => true },
    objectDetectorEngine: {
      isRunning: () => true,
      getStatus: () => ({ running: true }),
      onDetections: (callback) => {
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      }
    },
    objectTracker: runtime.tracker,
    visionState: runtime.visionState,
    followTargetController: runtime.controller,
    eventBus: runtime.eventBus,
    armMovement: () => {},
    face: { startFollow() {}, stopFollow() {} }
  });
  const startedPromise = manager.startFollowTarget({ label: "cup" });
  setTimeout(() => {
    updateVision(runtime, detectionResult(100, [detection("cup", 0.5)]));
    callbacks.forEach((callback) => callback());
  }, 0);
  const started = await startedPromise;
  assert.equal(started.executed, true);
  assert.equal(runtime.controller.getStatus().targetLabel, "cup");
  manager.stopFollowing("test_stop");
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
    face: { stopFollow() {} }
  });
  const missing = await manager.startFollowTarget({ label: "banana" });
  assert.equal(missing.executed, false);
  assert.equal(missing.detail.scenarioState, "not_found");
  assert.equal(detectorStopped, false);
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
    face: { startFollow() {}, stopFollow() {} }
  });
  const executor = new ToolExecutor({
    visionScenarioManager: manager,
    followTargetController: runtime.controller,
    visionState: runtime.visionState,
    commandQueue: runtime.commandQueue,
    robotClient: { isConnected: () => true },
    lifeEngine: { getState: () => ({ stopRespectUntil: 0 }), receiveEvent() {} },
    face: { dismissPhoto() {}, setExpression() {} },
    getRuntimeContext: () => ({
      geminiLive: { lastInputTranscript: "do you still see it" }
    }),
    getExecutionPolicy: () => ({ localMotionArmed: true, robotConnected: true })
  });
  const setResult = await executor.executeAction({
    type: "run_scenario",
    source: "local_brain",
    args: { name: "follow_target", label: "apple" }
  });
  assert.equal(setResult.status, "completed");
  const geminiStop = await executor.executeAction({
    type: "run_scenario",
    source: "gemini_live",
    args: { name: "stop_following", reason: "conversation_turn" }
  });
  assert.equal(geminiStop.status, "completed");
  const stopResult = await executor.executeAction({
    type: "run_scenario",
    source: "local_brain",
    args: { name: "stop_following", reason: "test_stop" }
  });
  assert.equal(stopResult.status, "completed");
}

{
  assert.deepEqual([...LOCAL_BRAIN_ALLOWED_ACTIONS].sort(), ["run_scenario"]);
  assert.equal(validateBrainAction({ type: "run_scenario", args: { name: "follow_target", label: "apple" } }).ok, true);
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
  assert.equal(context.objects[0].position, "center");
  assert.equal(Object.hasOwn(context.objects[0], "confidence"), false);
  assert.equal(Object.hasOwn(context.objects[0], "distance"), false);
  assert.equal(Object.hasOwn(context.objects[0], "lastSeenMs"), false);
  assert.equal(context.visibleLabels, "cup");
  assert.equal(Object.hasOwn(context, "summary"), false);
}

{
  const engine = new ObjectDetectorEngine();
  const workflowStatus = await engine.setWorkflowId("rf-detr-2");
  assert.equal(workflowStatus.workflowId, "rf-detr-2");
  assert.ok(workflowStatus.workflowOptions.includes("rf-detr-2"));
  const wrtcParams = engine.buildWrtcParams();
  assert.equal(wrtcParams.workflowId, "rf-detr-2");
  assert.equal(wrtcParams.realtimeProcessing, true);
  assert.equal(wrtcParams.realtime_processing, true);
  const frameReceivedAt = new Date(Date.now() - 250).toISOString();
  const result = engine.normalizeRoboflowData([
    {
      video_metadata: {
        frame_id: 12,
        received_at: frameReceivedAt
      },
      predictions: {
        image: {
          width: 2048,
          height: 1272
        },
        predictions: [
          {
            width: 1280,
            height: 1054,
            x: 1157,
            y: 593,
            confidence: 0.9685842394828796,
            class_id: 1,
            class: "person",
            detection_id: "24c15c43-0671-4ca5-8edc-7abdbbf27116",
            parent_id: "image"
          },
          {
            width: 1260,
            height: 1040,
            x: 1155,
            y: 595,
            confidence: 0.7685842394828796,
            class_id: 1,
            class: "person",
            detection_id: "duplicate-person",
            parent_id: "image"
          },
          {
            width: 788,
            height: 437,
            x: 1329,
            y: 1043.5,
            confidence: 0.9630815386772156,
            class_id: 73,
            class: "laptop",
            detection_id: "bc92817d-65cd-4943-b9a5-ee296403bb78",
            parent_id: "image"
          }
        ]
      }
    }
  ]);

  assert.equal(result.frameWidth, 2048);
  assert.equal(result.frameHeight, 1272);
  assert.equal(result.timestamp, frameReceivedAt);
  assert.equal(result.videoMetadata.frame_id, 12);
  assert.ok(result.frameAgeMs >= 0);
  assert.equal(result.detections.length, 2);
  assert.equal(result.detections[0].label, "person");
  assert.equal(Math.round(result.detections[0].bbox.x), 517);
  assert.equal(Math.round(result.detections[0].bbox.y), 66);
  assert.equal(result.detections[0].position, "center");
  assert.equal(result.detections[1].label, "laptop");
  assert.equal(result.detections[1].position, "right");
}

assert.equal(typeof startFollow, "function");
assert.equal(typeof stopFollow, "function");

console.log("smoke:object-follow passed");
