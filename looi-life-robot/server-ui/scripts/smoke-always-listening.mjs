import assert from "node:assert/strict";
import { LocalEventBus } from "../public/js/core/localEventBus.js";
import { AttentionSystem } from "../public/js/localBrain/attentionSystem.js";
import { AutonomousScheduler } from "../public/js/localBrain/autonomousScheduler.js";
import { BrainLatencyBudget } from "../public/js/localBrain/brainLatencyBudget.js";
import { createDefaultBrainPolicy } from "../public/js/localBrain/brainPolicy.js";
import { LocalBrainEngine } from "../public/js/localBrain/localBrainEngine.js";
import { RuleBrainFallback } from "../public/js/localBrain/ruleBrainFallback.js";
import { SpeechGate } from "../public/js/perception/speechGate.js";

const speechGate = new SpeechGate({ logger: () => {} });

assert.equal(speechGate.processTranscript({ text: "stop", confidence: 1 }).classification, "safety_stop");
assert.equal(speechGate.processTranscript({ text: "freeze", confidence: 1 }).shouldImmediateStop, true);
assert.equal(speechGate.processTranscript({ text: "stopping by later", confidence: 1 }).classification !== "safety_stop", true);
assert.equal(speechGate.processTranscript({ text: "LOOI", confidence: 1 }).classification, "wake_name");
assert.equal(speechGate.processTranscript({ text: "LOOI come here", confidence: 1 }).classification, "direct_to_robot");
speechGate.openAttentionWindow("smoke");
assert.equal(speechGate.processTranscript({ text: "come here", confidence: 1 }).classification, "direct_to_robot");
speechGate.closeAttentionWindow("smoke");
assert.ok(["possible_direct_command", "background"].includes(speechGate.processTranscript({ text: "come here", confidence: 1 }).classification));
const liveGate = new SpeechGate({
  logger: () => {},
  getContext: () => ({
    localPolicy: { localBrainEnabled: true },
    speechStatus: { alwaysListening: true }
  })
});
const liveGreeting = liveGate.processTranscript({ text: "hi can you me", confidence: 1 });
assert.equal(liveGreeting.accepted, true);
assert.equal(liveGreeting.shouldTriggerBrain, true);

const attention = new AttentionSystem({ logger: () => {} });
attention.wake("smoke", 1000);
assert.equal(attention.getStatus().mode, "attentive");
attention.attentionUntil = Date.now() - 1;
assert.equal(attention.update().mode, "idle");
attention.enterStopCooldown("smoke", 1000);
assert.equal(attention.canAutonomouslyAct({ autonomousMode: true }), false);

const budget = new BrainLatencyBudget({ eventThoughtTimeoutMs: 5 });
const fallbackValue = await budget.withTimeout(new Promise(() => {}), 5, async () => "fallback");
assert.equal(fallbackValue, "fallback");

const schedulerBus = new LocalEventBus({ logger: () => {} });
const schedulerEvents = [];
schedulerBus.subscribe("autonomous_tick", (event) => schedulerEvents.push(event));
const scheduler = new AutonomousScheduler({
  eventBus: schedulerBus,
  getPolicy: () => ({ ...createDefaultBrainPolicy(), autonomousMode: false }),
  getContext: () => ({ lifeState: { boredom: 0.95, isSpeaking: false, stopRespectUntil: 0 } }),
  logger: () => {}
});
scheduler.start();
assert.equal(scheduler.tick().allowed, false);
scheduler.stop();
const activeScheduler = new AutonomousScheduler({
  eventBus: schedulerBus,
  getPolicy: () => ({
    ...createDefaultBrainPolicy(),
    autonomousMode: true,
    minAutonomousThoughtIntervalMs: 1
  }),
  getContext: () => ({ lifeState: { boredom: 0.95, isSpeaking: false, stopRespectUntil: 0 } }),
  logger: () => {}
});
activeScheduler.start();
assert.equal(schedulerEvents.length > 0, true);
activeScheduler.stop();

let policy = createDefaultBrainPolicy();
let adapterCalls = 0;
const executedActions = [];
const engineBus = new LocalEventBus({ logger: () => {} });
const engine = new LocalBrainEngine({
  eventBus: engineBus,
  attentionSystem: new AttentionSystem({ logger: () => {} }),
  lifeEngine: {
    getState() {
      return { mood: "neutral", boredom: 0.1, stopRespectUntil: 0 };
    }
  },
  toolExecutor: {
    async executeBridgeAction(action) {
      executedActions.push(action);
      return {
        status: "completed",
        type: action.type,
        executed: true,
        physical: action.type === "stop",
        message: `${action.type} executed`
      };
    }
  },
  getPolicy: () => policy,
  getRuntimeContext: () => ({
    lifeState: { mood: "neutral", boredom: 0.1, stopRespectUntil: 0 },
    simulatorMode: true,
    robotConnected: true
  }),
  adapter: {
    async isAvailable() {
      return true;
    },
    async think() {
      adapterCalls += 1;
      return {
        ok: true,
        source: "smoke",
        actions: [{ type: "approach_user", args: { style: "gentle", distance: "short" } }],
        reason: "approach"
      };
    }
  },
  fallback: new RuleBrainFallback(),
  logger: () => {}
});

engine.start();
engineBus.publish("user_speech", {
  text: "background talking",
  classification: "background",
  accepted: false,
  shouldTriggerBrain: false
});
await wait(20);
assert.equal(adapterCalls, 0);

const rejected = await engine.thinkNow("manual", {
  type: "user_text",
  payload: { text: "come here", accepted: true, shouldTriggerBrain: true }
});
assert.equal(rejected.results[0].status, "rejected");
assert.equal(rejected.results[0].physical, true);

engine.setAdapter({
  async isAvailable() {
    return true;
  },
  async think() {
    return {
      ok: true,
      source: "smoke",
      actions: [{ type: "stop", args: { reason: "smoke_stop" } }],
      reason: "stop"
    };
  }
});
const stopped = await engine.thinkNow("manual");
assert.equal(stopped.results[0].status, "completed");
assert.equal(executedActions.some((action) => action.type === "stop"), true);
engine.stop();

policy = {
  ...policy,
  localMotionArmed: true
};

console.log(JSON.stringify({
  ok: true,
  speechGateRecent: speechGate.getRecentTranscripts().length,
  schedulerEvents: schedulerEvents.length,
  thoughts: engine.getRecentThoughts().length
}));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
