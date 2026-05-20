import assert from "node:assert/strict";
import { MOVEMENTS } from "../public/js/embodiment/movementCatalog.js";
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
  assert.equal(validateFrameSequence({ name: scenario.name, frames: scenario.sequence }).ok, true, `invalid sequence ${name}`);
  collectMotionFrames(scenario.sequence)
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
    if (event.type === "motion_stop") {
      lifeState.robotMotorState = "stopped";
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
  async stopMotion(reason) {
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
  name: "immediate_stop",
  priority: 100,
  interruptible: false,
  requiresMotion: false,
  frames: [{ type: "event", eventType: "motion_stop", payload: { reason: "smoke_stop" }, durationMs: 10 }]
}, { allowMotion: false });
assert.equal(stopResult.ok, true);
assert.equal(stops.includes("smoke_stop"), true);
assert.equal(lifeState.robotMotorState, "stopped");

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

assert.equal(Array.isArray(MOVEMENTS.look_left), true);
assert.equal(collectMotionFrames(MOVEMENTS.look_left).some((frame) => frame.label === "scenario_tiny_turn_left"), true);
assert.equal(collectMotionFrames(MOVEMENTS.move_forward_tiny).some((frame) => frame.label === "scenario_tiny_forward"), true);

const sequenceMapped = router.mapActionToSequence({
  type: "run_sequence",
  args: {
    frames: [
      { type: "speech", text: "I can move softly.", tone: "happy" },
      ...MOVEMENTS.look_left,
      ...MOVEMENTS.look_right
    ]
  }
});
assert.equal(sequenceMapped.ok, true);
assert.equal(sequenceMapped.sequence.name, "scenario_sequence");
assert.equal(validateFrameSequence(sequenceMapped.sequence).ok, true);

const sequenceDisarmed = await router.execute({
  type: "run_sequence",
  args: {
    frames: [
      { type: "speech", text: "I can wiggle softly.", tone: "happy" },
      ...MOVEMENTS.look_left,
      ...MOVEMENTS.look_right
    ],
    requiresMotion: true
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
    frames: [...MOVEMENTS.move_forward_tiny],
    requiresMotion: true
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

function collectMotionFrames(frames = []) {
  return (Array.isArray(frames) ? frames : []).flatMap((frame) => {
    if (frame?.type === "motion") {
      return [frame];
    }
    if (frame?.type === "composite") {
      return collectMotionFrames(frame.frames);
    }
    return [];
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
