import assert from "node:assert/strict";
import { AttentionMotorController } from "../public/js/embodiment/attentionMotorController.js";
import { normalizeBodyLanguage } from "../public/js/embodiment/bodyLanguageNormalizer.js";
import { EmbodiedActionRouter } from "../public/js/embodiment/embodiedActionRouter.js";
import { IdleMicroBehavior } from "../public/js/embodiment/idleMicroBehavior.js";
import {
  listMacros,
  validateMacro
} from "../public/js/embodiment/motionMacroLibrary.js";
import { MotionMacroSequencer } from "../public/js/embodiment/motionMacroSequencer.js";
import { PriorityScheduler } from "../public/js/embodiment/priorityScheduler.js";
import { PerformanceMonitor } from "../public/js/runtime/performanceMonitor.js";
import { WakeLockManager } from "../public/js/runtime/wakeLockManager.js";

const requiredMacros = [
  "soft_idle",
  "soft_listen",
  "thinking_pose",
  "curious_scan",
  "happy_approach",
  "gentle_approach",
  "shy_retreat",
  "scared_stop",
  "excited_wiggle",
  "user_returned_greeting",
  "sleepy_idle",
  "surprised_back",
  "soft_recenter",
  "tiny_yes",
  "tiny_no",
  "look_around_only"
];

const macros = listMacros();
const macroNames = new Set(macros.map((macro) => macro.name));
requiredMacros.forEach((name) => assert.equal(macroNames.has(name), true, `missing ${name}`));
macros.forEach((macro) => {
  assert.equal(validateMacro(macro).ok, true, macro.name);
  macro.frames
    .filter((frame) => frame.type === "motion")
    .forEach((frame) => {
      assert.ok(Math.abs(frame.linear ?? 0) <= 0.22, `${macro.name} linear too high`);
      assert.ok(Math.abs(frame.angular ?? 0) <= 0.22, `${macro.name} angular too high`);
      assert.ok(Number(frame.durationMs) <= 700, `${macro.name} duration too high`);
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
  running: true,
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
const sequencer = new MotionMacroSequencer({
  face: lifeEngine.face,
  voiceOutput,
  commandQueue,
  lifeEngine,
  logger: () => {}
});

const faceOnly = await sequencer.playMacro("soft_listen", { allowMotion: false });
assert.equal(faceOnly.ok, true);
assert.equal(faceEvents.some((event) => event.expression === "attentive"), true);

const motionResult = await sequencer.playMacro("happy_approach", { allowMotion: true });
assert.equal(motionResult.ok, true);
assert.equal(motions.some((motion) => motion.label === "macro_happy_approach_forward"), true);

const skippedMotion = await new MotionMacroSequencer({
  face: lifeEngine.face,
  commandQueue,
  lifeEngine,
  logger: () => {}
}).playMacro("happy_approach", { allowMotion: false });
assert.equal(skippedMotion.partial, true);
assert.equal(skippedMotion.skippedFrames.includes("motion_not_allowed"), true);

const interruptSequencer = new MotionMacroSequencer({
  face: lifeEngine.face,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const longMacro = interruptSequencer.playMacroObject({
  name: "long_pause",
  priority: 10,
  interruptible: true,
  requiresMotion: false,
  frames: [{ type: "pause", durationMs: 500 }]
}, {});
setTimeout(() => interruptSequencer.interrupt("smoke_interrupt", 100), 20);
const interrupted = await longMacro;
assert.equal(interrupted.interrupted, true);

const stopSequencer = new MotionMacroSequencer({
  face: lifeEngine.face,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const stopResult = await stopSequencer.playMacro("scared_stop", { allowMotion: false });
assert.equal(stopResult.ok, true);
assert.equal(stops.length > 0, true);
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

const routerSequencer = new MotionMacroSequencer({
  face: lifeEngine.face,
  voiceOutput,
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const router = new EmbodiedActionRouter({
  macroSequencer: routerSequencer,
  priorityScheduler: new PriorityScheduler(),
  lifeEngine,
  logger: () => {}
});
const approach = router.mapActionToMacro({ type: "approach_user", args: { style: "happy" } });
assert.equal(approach.macroName, "happy_approach");
const retreat = router.mapActionToMacro({ type: "retreat", args: {} });
assert.equal(retreat.macroName, "shy_retreat");
const stop = router.mapActionToMacro({ type: "stop", args: {} });
assert.equal(stop.macroObject.name, "scared_stop");
const unknown = router.mapActionToMacro({ type: "raw_pwm", args: {} });
assert.equal(unknown.ok, false);

const bodyLanguage = normalizeBodyLanguage(["wiggle", "look up", "invented dance"], { iterate: true });
assert.equal(bodyLanguage.entries.some((entry) => entry.name === "tiny_wiggle"), true);
assert.equal(bodyLanguage.entries.some((entry) => entry.name === "look_up"), true);
assert.equal(bodyLanguage.ignored.includes("invented dance"), true);
assert.equal(bodyLanguage.frames.filter((frame) => frame.type === "motion").length > 0, true);

const performSpeechOnly = router.mapActionToMacro({
  type: "perform",
  args: {
    speech: { text: "Hi there.", tone: "happy" },
    bodyLanguage: [],
    movement: { intent: "none" },
    timing: "parallel"
  }
});
assert.equal(performSpeechOnly.macroObject.name, "perform_embodied");
assert.equal(validateMacro(performSpeechOnly.macroObject).ok, true);

const performDisarmed = await router.execute({
  type: "perform",
  args: {
    speech: { text: "I can wiggle softly.", tone: "happy" },
    bodyLanguage: ["wiggle"],
    iterateBodyLanguage: true,
    movement: { intent: "none" },
    timing: "parallel"
  },
  source: "local_brain"
}, {
  allowMotion: false,
  allowSpeech: true,
  reason: "smoke_perform_disarmed"
});
assert.equal(performDisarmed.ok, true);
assert.equal(performDisarmed.result.partial, true);
assert.equal(performDisarmed.result.skippedFrames.includes("motion_not_allowed"), true);
assert.equal(spoken.some((entry) => entry.text === "I can wiggle softly."), true);

const performArmed = await router.execute({
  type: "perform",
  args: {
    speech: { text: "Coming closer.", tone: "happy" },
    bodyLanguage: ["tiny forward"],
    movement: { intent: "approach_user", style: "gentle" },
    timing: "parallel"
  },
  source: "local_brain"
}, {
  allowMotion: true,
  allowSpeech: true,
  reason: "smoke_perform_armed"
});
assert.equal(performArmed.ok, true);
assert.equal(motions.some((motion) => motion.label === "perform_approach_user"), true);

const interruptPerformSequencer = new MotionMacroSequencer({
  face: lifeEngine.face,
  voiceOutput: {
    async speak(payload) {
      spoken.push(payload);
      await wait(160);
      return { executed: true, payload };
    },
    cancel() {}
  },
  commandQueue,
  lifeEngine,
  logger: () => {}
});
const interruptRouter = new EmbodiedActionRouter({
  macroSequencer: interruptPerformSequencer,
  lifeEngine,
  logger: () => {}
});
const runningPerform = interruptRouter.execute({
  type: "perform",
  args: {
    speech: { text: "This should be interrupted.", tone: "soft" },
    bodyLanguage: ["wiggle"],
    iterateBodyLanguage: true,
    timing: "parallel"
  },
  source: "local_brain"
}, {
  allowMotion: true,
  allowSpeech: true,
  reason: "smoke_perform_interrupt"
});
setTimeout(() => interruptPerformSequencer.interrupt("smoke_perform_stop", 100), 20);
const interruptedPerform = await runningPerform;
assert.equal(interruptedPerform.result.interrupted, true);

const idle = new IdleMicroBehavior({
  lifeEngine,
  macroSequencer: routerSequencer,
  getPolicy: () => ({ localMotionArmed: false, allowAutonomousMovement: false }),
  getContext: () => ({ lifeState: { ...lifeState, stopRespectUntil: Date.now() + 1000 } }),
  logger: () => {}
});
assert.equal(idle.chooseIdleMicroBehavior(idle.getContext?.() ?? { lifeState }, {}).allowed, false);

const attention = new AttentionMotorController({
  lifeEngine,
  macroSequencer: routerSequencer,
  getPolicy: () => ({ localMotionArmed: false, allowAutonomousMovement: false }),
  logger: () => {}
});
attention.start();
const tracked = attention.onObservation({ userVisible: true, userPosition: "left" });
assert.equal(tracked.moved, false);
assert.equal(faceEvents.some((event) => event.direction === "left"), true);

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
  macros: macros.length,
  motions: motions.length,
  stops: stops.length,
  faceEvents: faceEvents.length
}));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
