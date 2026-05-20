import assert from "node:assert/strict";
import { MOVEMENTS, compileMovementFrames } from "../public/js/embodiment/movementCatalog.js";
import {
  MODEL_SCENARIO_NAMES,
  getScenarioDefinition
} from "../public/js/embodiment/scenarioCatalog.js";
import { EmbodiedActionRouter } from "../public/js/embodiment/embodiedActionRouter.js";
import {
  ScenarioFrameSequencer,
  validateFrameSequence
} from "../public/js/embodiment/scenarioFrameSequencer.js";
import { PriorityScheduler } from "../public/js/embodiment/priorityScheduler.js";
import { PerformanceMonitor } from "../public/js/runtime/performanceMonitor.js";
import { WakeLockManager } from "../public/js/runtime/wakeLockManager.js";

["still", "ack_yes", "ack_no", "come_closer", "back_up", "look_left", "look_right", "body_talking", "take_picture"].forEach((name) => {
  assert.equal(MODEL_SCENARIO_NAMES.includes(name), true, `missing scenario ${name}`);
  const scenario = getScenarioDefinition(name);
  assert.equal(Boolean(scenario), true, `missing scenario definition ${name}`);
  const frames = compileMovementFrames(scenario.movement, {
    iterate: Boolean(scenario.iterateMovement)
  }).frames;
  frames
    .filter((frame) => frame.type === "motion")
    .forEach((frame) => {
      assert.ok(Math.abs(frame.linear ?? 0) <= 0.22, `${name} linear too high`);
      assert.ok(Math.abs(frame.angular ?? 0) <= 0.22, `${name} angular too high`);
      assert.ok(Number(frame.durationMs) <= 700, `${name} duration too high`);
    });
});

const faceEvents = [];
const motions = [];
const spoken = [];
const stops = [];
const lifeState = {
  mood: "neutral",
  energy: 0.8,
  obstacle: false,
  connectionState: "simulated_connected",
  stopRespectUntil: 0
};
const lifeEngine = {
  face: {
    setExpression(expression, intensity) {
      faceEvents.push({ type: "expression", expression, intensity });
    },
    setEyeDirection(direction) {
      faceEvents.push({ type: "eye", direction });
    },
    setSpeaking(value) {
      faceEvents.push({ type: "speaking", value });
    },
    blink() {
      faceEvents.push({ type: "blink" });
    }
  },
  getState() {
    return lifeState;
  },
  patchState(partial) {
    Object.assign(lifeState, partial);
    return lifeState;
  },
  receiveEvent(event) {
    if (event.type === "stop") {
      lifeState.stopRespectUntil = Date.now() + 1000;
    }
    return event;
  },
  setSpeaking(value) {
    lifeState.isSpeaking = value;
  }
};
const commandQueue = {
  async enqueueMotion(command) {
    motions.push(command);
    return { ok: true, command };
  },
  async emergencyStop(reason) {
    stops.push(reason);
    return { ok: true, reason };
  },
  isBusy() {
    return false;
  }
};
const voiceOutput = {
  async speak(payload) {
    spoken.push(payload);
    await wait(20);
    return { executed: true, payload };
  },
  cancel() {}
};

const sequencer = new ScenarioFrameSequencer({
  face: lifeEngine.face,
  voiceOutput,
  commandQueue,
  lifeEngine,
  logger: () => {}
});

const faceOnly = await sequencer.playFrameSequence({
  name: "smoke_face",
  priority: 10,
  requiresMotion: false,
  frames: [{ type: "face", expression: "attentive", eyeDirection: "center", durationMs: 10 }]
}, { allowMotion: false });
assert.equal(faceOnly.ok, true);
assert.equal(faceEvents.some((event) => event.expression === "attentive"), true);

const motionSequence = {
  name: "smoke_motion",
  priority: 10,
  requiresMotion: true,
  frames: [{ type: "motion", linear: 0.05, angular: 0, durationMs: 80, rampMs: 40, label: "smoke_sequence_forward" }]
};
assert.equal(validateFrameSequence(motionSequence).ok, true);
const motionResult = await sequencer.playFrameSequence(motionSequence, { allowMotion: true });
assert.equal(motionResult.ok, true);
assert.equal(motions.some((motion) => motion.label === "smoke_sequence_forward"), true);

const skippedMotion = await sequencer.playFrameSequence({
  ...motionSequence,
  name: "smoke_motion_disarmed"
}, { allowMotion: false });
assert.equal(skippedMotion.partial, true);
assert.equal(skippedMotion.skippedFrames.includes("motion_not_allowed"), true);

const interruptSequencer = new ScenarioFrameSequencer({
  face: lifeEngine.face,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const longSequence = interruptSequencer.playFrameSequence({
  name: "long_pause",
  priority: 10,
  interruptible: true,
  requiresMotion: false,
  frames: [{ type: "pause", durationMs: 500 }]
}, {});
setTimeout(() => interruptSequencer.interrupt("smoke_interrupt", 100), 20);
const interrupted = await longSequence;
assert.equal(interrupted.interrupted, true);

const stopSequencer = new ScenarioFrameSequencer({
  face: lifeEngine.face,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const stopResult = await stopSequencer.playFrameSequence({
  name: "safety_stop",
  priority: 100,
  interruptible: false,
  requiresMotion: false,
  frames: [{ type: "event", eventType: "emergency_stop", payload: { reason: "smoke_stop" }, durationMs: 10 }]
}, { allowMotion: false });
assert.equal(stopResult.ok, true);
assert.equal(stops.includes("smoke_stop"), true);
lifeState.stopRespectUntil = 0;

const scheduler = new PriorityScheduler();
const order = [];
const low = scheduler.submit({
  type: "low",
  priority: 10,
  interruptible: true,
  run: async () => {
    await wait(80);
    order.push("low");
    return { ok: true };
  }
});
const high = scheduler.submit({
  type: "high",
  priority: 100,
  run: async () => {
    order.push("high");
    return { ok: true };
  }
});
const highResult = await high;
assert.equal(highResult.ok, true);
assert.equal(order[0], "high");
await low;

const routerSequencer = new ScenarioFrameSequencer({
  face: lifeEngine.face,
  voiceOutput,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const router = new EmbodiedActionRouter({
  frameSequencer: routerSequencer,
  priorityScheduler: new PriorityScheduler(),
  lifeEngine,
  logger: () => {}
});
const unknown = router.mapActionToSequence({ type: "raw_pwm", args: {} });
assert.equal(unknown.ok, false);

const movementPlan = compileMovementFrames(["look_left", "look_right", "invented_dance"], { iterate: true });
assert.equal(movementPlan.names.includes("look_left"), true);
assert.equal(movementPlan.names.includes("look_right"), true);
assert.equal(movementPlan.ignored.includes("invented_dance"), true);
assert.equal(movementPlan.frames.filter((frame) => frame.type === "motion").length > 0, true);
const canonicalMovement = compileMovementFrames([MOVEMENTS.look_left, MOVEMENTS.move_forward_tiny], { iterate: false });
assert.equal(canonicalMovement.names.includes("look_left"), true);
assert.equal(canonicalMovement.names.includes("move_forward_tiny"), true);

const sequenceMapped = router.mapActionToSequence({
  type: "run_sequence",
  args: {
    speech: { text: "I can move softly.", tone: "happy" },
    movement: [MOVEMENTS.look_left, MOVEMENTS.look_right],
    iterateMovement: true,
    timing: "parallel"
  }
});
assert.equal(sequenceMapped.ok, true);
assert.equal(sequenceMapped.sequence.name, "scenario_sequence");
assert.equal(validateFrameSequence(sequenceMapped.sequence).ok, true);

const sequenceDisarmed = await router.execute({
  type: "run_sequence",
  args: {
    speech: { text: "I can wiggle softly.", tone: "happy" },
    movement: [MOVEMENTS.look_left, MOVEMENTS.look_right],
    iterateMovement: true,
    timing: "parallel"
  },
  source: "local"
}, {
  allowMotion: false,
  allowSpeech: true,
  reason: "smoke_sequence_disarmed"
});
assert.equal(sequenceDisarmed.ok, true);
assert.equal(sequenceDisarmed.result.partial, true);
assert.equal(sequenceDisarmed.result.skippedFrames.includes("motion_not_allowed"), true);
assert.equal(spoken.some((entry) => entry.text === "I can wiggle softly."), true);

const sequenceArmed = await router.execute({
  type: "run_sequence",
  args: {
    movement: [MOVEMENTS.move_forward_tiny],
    timing: "sequence"
  },
  source: "local"
}, {
  allowMotion: true,
  allowSpeech: false,
  reason: "smoke_sequence_armed"
});
assert.equal(sequenceArmed.ok, true);
assert.equal(motions.some((motion) => motion.label === "scenario_tiny_forward"), true);

const wakeLock = new WakeLockManager({ logger: () => {} });
assert.equal(wakeLock.getStatus().active, false);

const perf = new PerformanceMonitor({ logger: () => {} });
perf.start();
perf.recordBrainLatency(123);
assert.equal(perf.getStatus().running, true);
perf.stop();
assert.equal(perf.getStatus().running, false);

console.log(JSON.stringify({
  ok: true,
  scenarios: MODEL_SCENARIO_NAMES.length,
  motions: motions.length,
  stops: stops.length,
  faceEvents: faceEvents.length
}));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
