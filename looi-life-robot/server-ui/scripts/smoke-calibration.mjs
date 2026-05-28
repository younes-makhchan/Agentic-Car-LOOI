import assert from "node:assert/strict";
import { BodyCalibration } from "../public/js/robot/bodyCalibration.js";
import { CommandQueue } from "../public/js/robot/commandQueue.js";
import { LifeEngine } from "../public/js/life/lifeEngine.js";

class TestRobotClient {
  constructor() {
    this.connected = false;
    this.latestConfig = {};
    this.latestTelemetry = {
      motor_state: "stopped",
      motion_label: ""
    };
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  sendConfigUpdate(config) {
    this.latestConfig = { ...config };
    return "test_config_update";
  }

  getLatestConfig() {
    return { ...this.latestConfig };
  }

  sendMotion({ durationMs = 0, label = "motion" } = {}) {
    this.latestTelemetry = {
      ...this.latestTelemetry,
      motor_state: "moving",
      motion_label: label
    };
    setTimeout(() => {
      this.latestTelemetry = {
        ...this.latestTelemetry,
        motor_state: "stopped",
        motion_label: ""
      };
    }, Math.max(0, Number(durationMs) || 0));
    return "test_motion";
  }

  stop() {
    this.latestTelemetry = {
      ...this.latestTelemetry,
      motor_state: "stopped",
      motion_label: ""
    };
    return "test_stop";
  }

  getLatestTelemetry() {
    return { ...this.latestTelemetry };
  }
}

const logs = [];
const calibration = new BodyCalibration({
  logger: (message, level = "info") => logs.push({ level, message })
});

const defaults = calibration.getSettings();
assert.equal(defaults.maxSpeed, 0.5);
assert.equal(defaults.rampMs, 150);

const clamped = calibration.importJson({
  maxSpeed: 2,
  leftTrim: 9,
  rightTrim: 0,
  rampMs: 999,
  minPwm: 999,
  motionIntensityScale: 9
});
assert.equal(clamped.maxSpeed, 0.5);
assert.equal(clamped.leftTrim, 1.3);
assert.equal(clamped.rightTrim, 0.5);
assert.equal(clamped.rampMs, 500);
assert.equal(clamped.minPwm, 255);
assert.equal(clamped.motionIntensityScale, 1.2);

const exported = calibration.exportJson();
calibration.importJson(exported);
const esp32Config = calibration.buildEsp32Config();
assert.deepEqual(Object.keys(esp32Config).sort(), [
  "deadband",
  "default_ramp_ms",
  "left_trim",
  "max_speed",
  "min_pwm",
  "right_trim"
]);

const robot = new TestRobotClient();
robot.connect();
const applyResult = await calibration.applyToRobot(robot);
assert.equal(applyResult.ok, true);
assert.equal(robot.getLatestConfig().max_speed, 0.5);

const commandEvents = [];
const queue = new CommandQueue({
  robotClient: robot,
  maxSpeed: calibration.getSettings().maxSpeed,
  logger: (message, level = "info") => logs.push({ level, message })
});

await queue.enqueueMotion({
  linear: 0.12,
  angular: 0,
  durationMs: 80,
  rampMs: 30,
  label: "smoke_calibration_motion"
});
commandEvents.push(...queue.getRecentCommands({ limit: 5 }));
assert.equal(commandEvents.some((entry) => entry.label === "smoke_calibration_motion"), true);
assert.equal(robot.getLatestTelemetry().motion_label, "");

const faceEvents = [];
const lifeEngine = new LifeEngine({
  face: {
    setExpression(expression) {
      faceEvents.push({ type: "expression", expression });
    },
    setEyeDirection(direction) {
      faceEvents.push({ type: "eye", direction });
    },
    blink() {
      faceEvents.push({ type: "blink" });
    }
  },
  robotClient: robot,
  commandQueue: queue,
  calibration,
  logger: (message, level = "info") => logs.push({ level, message })
});
lifeEngine.setConnectionState("connected");

lifeEngine.receiveObservation({
  timestamp: new Date().toISOString(),
  cameraRunning: true,
  userVisible: true,
  userPosition: "center",
  userDistance: "near",
  detector: "mock"
});
assert.equal(lifeEngine.getState().userVisible, true);

await queue.stopMotion("smoke_done");
robot.disconnect();

console.log(
  JSON.stringify({
    ok: true,
    config: robot.getLatestConfig(),
    commandEvents: commandEvents.length,
    faceEvents: faceEvents.length,
    logs: logs.length
  })
);
