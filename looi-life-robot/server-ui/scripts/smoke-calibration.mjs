import assert from "node:assert/strict";
import { BodyCalibration } from "../public/js/robot/bodyCalibration.js";
import { CommandQueue } from "../public/js/robot/commandQueue.js";
import { LifeEngine } from "../public/js/life/lifeEngine.js";
import { curiousScan, excitedWiggle } from "../public/js/life/motionStyles.js";
import { SimulatedESP32Client } from "../public/js/robot/simulatedEsp32Client.js";

const logs = [];
const calibration = new BodyCalibration({
  logger: (message, level = "info") => logs.push({ level, message })
});

const defaults = calibration.getSettings();
assert.equal(defaults.maxSpeed, 0.4);
assert.equal(defaults.rampMs, 150);

const clamped = calibration.patchSettings({
  maxSpeed: 2,
  leftTrim: 9,
  rightTrim: 0,
  rampMs: 999,
  minPwm: 999,
  motionIntensityScale: 9
});
assert.equal(clamped.maxSpeed, 0.4);
assert.equal(clamped.leftTrim, 1.3);
assert.equal(clamped.rightTrim, 0.5);
assert.equal(clamped.rampMs, 500);
assert.equal(clamped.minPwm, 90);
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

const simulator = new SimulatedESP32Client({
  logger: (message, level = "info") => logs.push({ level, message })
});
await simulator.connect();
const applyResult = await calibration.applyToRobot(simulator);
assert.equal(applyResult.ok, true);
assert.equal(simulator.getLatestConfig().max_speed, 0.4);

const commandEvents = [];
const queue = new CommandQueue({
  robotClient: simulator,
  maxSpeed: calibration.getSettings().maxSpeed,
  logger: (message, level = "info") => logs.push({ level, message })
});
queue.onCommand((entry) => commandEvents.push(entry));

await queue.enqueueMotion({
  linear: 0.12,
  angular: 0,
  durationMs: 80,
  rampMs: 30,
  label: "smoke_calibration_motion"
});
assert.equal(commandEvents.some((entry) => entry.label === "smoke_calibration_motion"), true);
assert.equal(simulator.getLatestTelemetry().motion_label, "");

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
  robotClient: simulator,
  commandQueue: queue,
  calibration,
  logger: (message, level = "info") => logs.push({ level, message })
});
lifeEngine.setConnectionState("simulated_connected");

const context = {
  state: lifeEngine.getState(),
  face: lifeEngine.face,
  robotClient: simulator,
  commandQueue: queue,
  calibration,
  limits: {
    maxSpeed: calibration.getSettings().maxSpeed
  },
  logger: (message, level = "info") => logs.push({ level, message })
};

const scan = await curiousScan(context, { direction: "center", intensity: 0.4 });
assert.equal(scan.behavior, "curious_scan");

const wiggle = await excitedWiggle(context, { intensity: 0.25 });
assert.equal(wiggle.behavior, "excited_wiggle");
assert.ok(wiggle.labels.length >= 1);

const lifeResult = await lifeEngine.requestBehavior("approach_user", {
  style: "gentle",
  distance: "tiny"
});
assert.equal(lifeResult.allowed, true);

await queue.emergencyStop("smoke_done");
simulator.disconnect();

console.log(
  JSON.stringify({
    ok: true,
    config: simulator.getLatestConfig(),
    commandEvents: commandEvents.length,
    faceEvents: faceEvents.length,
    logs: logs.length
  })
);
