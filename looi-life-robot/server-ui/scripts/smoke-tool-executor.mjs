import assert from "node:assert/strict";
import { ToolExecutor } from "../public/js/robot/toolExecutor.js";

const logs = [];
const faceEvents = [];
const behaviorRequests = [];
const stops = [];
const policy = {
  cloudMotionArmed: false,
  cloudCameraAllowed: false,
  simulatorMode: true,
  robotConnected: true,
  allowSpeak: true,
  allowNonPhysical: true
};

const face = {
  setExpression(expression, intensity) {
    faceEvents.push({ type: "expression", expression, intensity });
  },
  setEyeDirection(direction) {
    faceEvents.push({ type: "eye", direction });
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
  async emergencyStop(reason) {
    stops.push(reason);
    return { ok: true, reason };
  }
};

const cameraCalls = [];
const cameraStatus = {
  supported: true,
  secureContext: true,
  running: true,
  facingMode: "user",
  hasStream: true,
  lastError: null,
  lastFrameAt: Date.now(),
  lastSnapshotAt: null,
  visionSupported: {
    faceDetector: false
  },
  observation: {
    timestamp: new Date().toISOString(),
    cameraRunning: true,
    facingMode: "user",
    detector: "none",
    userVisible: false,
    faceCount: null,
    userPosition: "unknown",
    userDistance: "unknown",
    brightness: null,
    motion: null,
    note: "mock camera"
  }
};

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
  async switchCamera() {
    cameraCalls.push({ type: "switch" });
    cameraStatus.facingMode = cameraStatus.facingMode === "user" ? "environment" : "user";
    return { ok: true, status: cameraStatus };
  },
  async stopCamera() {
    cameraCalls.push({ type: "stop" });
    cameraStatus.running = false;
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
      recentEvents: []
    };
  },
  patchState(partialState, reason) {
    return { partialState, reason };
  },
  receiveEvent(event) {
    return event;
  },
  async executeKimiAction(toolName, args) {
    behaviorRequests.push({ toolName, args });
    return {
      ok: true,
      executed: true,
      queued: toolName !== "express",
      rejected: false,
      reason: `${toolName}_accepted`,
      detail: { toolName, args }
    };
  }
};

const executor = new ToolExecutor({
  lifeEngine,
  face,
  robotClient,
  commandQueue,
  cameraInput,
  logger: (message, level = "info") => logs.push({ level, message }),
  getExecutionPolicy: () => ({ ...policy }),
  getRuntimeContext: () => ({
    lifeState: lifeEngine.getState(),
    robotTelemetry: robotClient.getLatestTelemetry(),
    connectionState: "simulated_connected",
    simulatorMode: true,
    cloudMotionArmed: policy.cloudMotionArmed,
    cloudCameraAllowed: policy.cloudCameraAllowed,
    cameraStatus,
    recentLifeEvents: []
  })
});

const expressResult = await executor.executeBridgeAction({
  id: "express_1",
  source: "test",
  type: "express",
  args: {
    emotion: "happy",
    intensity: 0.8
  }
});
assert.equal(expressResult.status, "completed");
assert.equal(expressResult.executed, true);
assert.equal(expressResult.physical, false);
assert.equal(faceEvents.some((event) => event.expression === "happy"), true);

const observeResult = await executor.executeBridgeAction({
  id: "observe_1",
  source: "test",
  type: "observe_scene",
  args: {}
});
assert.equal(observeResult.status, "completed");
assert.equal(observeResult.detail.connectionState, "simulated_connected");
assert.equal(observeResult.detail.cloudCameraAllowed, false);
assert.equal(observeResult.detail.cameraStatus.running, true);

const rejectedCamera = await executor.executeBridgeAction({
  id: "camera_rejected_1",
  source: "test",
  type: "open_front_camera",
  args: {}
});
assert.equal(rejectedCamera.status, "rejected");
assert.match(rejectedCamera.message, /not allowed/i);

policy.cloudCameraAllowed = true;
const openCamera = await executor.executeBridgeAction({
  id: "camera_open_1",
  source: "test",
  type: "open_front_camera",
  args: {}
});
assert.equal(openCamera.status, "completed");
assert.equal(openCamera.physical, false);
assert.equal(cameraCalls.some((call) => call.type === "start" && call.facingMode === "user"), true);

const snapshot = await executor.executeBridgeAction({
  id: "camera_snapshot_1",
  source: "test",
  type: "capture_snapshot",
  args: {
    includeDataUrl: true,
    maxWidth: 320
  }
});
assert.equal(snapshot.status, "completed");
assert.equal(snapshot.detail.snapshot.width, 320);

const observeSnapshot = await executor.executeBridgeAction({
  id: "observe_snapshot_1",
  source: "test",
  type: "observe_scene",
  args: {
    includeSnapshot: true,
    includeDataUrl: false
  }
});
assert.equal(observeSnapshot.status, "completed");
assert.equal(observeSnapshot.detail.snapshot.dataUrl, null);

policy.cloudCameraAllowed = false;

const speakResult = await executor.executeBridgeAction({
  id: "speak_1",
  source: "test",
  type: "speak",
  args: {
    text: "Short local smoke phrase.",
    tone: "curious"
  }
});
assert.equal(speakResult.status, "completed");
assert.equal(speakResult.physical, false);

const routedMovements = [];
executor.setEmbodiedActionRouter({
  async execute(action, context) {
    routedMovements.push({ action, context });
    return {
      ok: true,
      status: "completed",
      macro: "movement_embodied",
      result: { executed: true }
    };
  }
});
const faceOnlyMovement = await executor.executeBridgeAction({
  id: "movement_face_1",
  source: "test",
  type: "movement",
  args: {
    movement: ["look_up"]
  }
});
assert.equal(faceOnlyMovement.status, "completed");
assert.equal(routedMovements.at(-1).context.allowMotion, false);
executor.setEmbodiedActionRouter(null);

const curiousDisarmed = await executor.executeBridgeAction({
  id: "curious_1",
  source: "test",
  type: "curious_scan",
  args: {
    direction: "both",
    intensity: 0.7
  }
});
assert.equal(curiousDisarmed.status, "completed");
assert.equal(curiousDisarmed.physical, false);
assert.equal(curiousDisarmed.detail.partial, true);

const disarmedApproach = await executor.executeBridgeAction({
  id: "approach_1",
  source: "test",
  type: "approach_user",
  args: {
    style: "happy",
    distance: "short"
  }
});
assert.equal(disarmedApproach.status, "rejected");
assert.match(disarmedApproach.message, /not armed/i);

const stopResult = await executor.executeBridgeAction({
  id: "stop_1",
  source: "test",
  type: "stop",
  args: {
    reason: "smoke_stop"
  }
});
assert.equal(stopResult.status, "completed");
assert.equal(stopResult.executed, true);
assert.deepEqual(stops, ["smoke_stop"]);

policy.cloudMotionArmed = true;
executor.setEmbodiedActionRouter({
  async execute(action, context) {
    routedMovements.push({ action, context });
    return {
      ok: true,
      status: "completed",
      macro: "movement_embodied",
      result: { executed: true }
    };
  }
});
const physicalMovement = await executor.executeBridgeAction({
  id: "movement_physical_1",
  source: "test",
  type: "movement",
  args: {
    movement: ["move_forward_tiny"]
  }
});
assert.equal(physicalMovement.status, "completed");
assert.equal(routedMovements.at(-1).context.allowMotion, true);
executor.setEmbodiedActionRouter(null);

const armedApproach = await executor.executeBridgeAction({
  id: "approach_2",
  source: "test",
  type: "approach_user",
  args: {
    style: "happy",
    distance: "short"
  }
});
assert.equal(armedApproach.status, "completed");
assert.equal(armedApproach.physical, true);
assert.equal(behaviorRequests.some((request) => request.toolName === "approach_user"), true);

const retreatResult = await executor.executeBridgeAction({
  id: "retreat_1",
  source: "test",
  type: "retreat",
  args: {
    style: "gentle",
    distance: "short"
  }
});
assert.equal(retreatResult.status, "completed");

const driveResult = await executor.executeBridgeAction({
  id: "drive_1",
  source: "test",
  type: "drive",
  args: {
    linear: 0.1,
    angular: 0,
    duration_ms: 100
  }
});
assert.equal(driveResult.status, "completed");

const wiggleResult = await executor.executeBridgeAction({
  id: "wiggle_1",
  source: "test",
  type: "excited_wiggle",
  args: {
    intensity: 0.5
  }
});
assert.equal(wiggleResult.status, "completed");

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ ok: true })
});
try {
  const rememberResult = await executor.executeBridgeAction({
    id: "remember_1",
    source: "test",
    type: "remember",
    args: {
      memory_type: "learned_phrase",
      text: "Smoke memory should use mocked fetch.",
      importance: "medium"
    }
  });
  assert.equal(rememberResult.status, "completed");
} finally {
  globalThis.fetch = originalFetch;
}

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
    logs: logs.length
  })
);
