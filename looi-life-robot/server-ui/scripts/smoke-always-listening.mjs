import assert from "node:assert/strict";
import { LocalEventBus } from "../public/js/core/localEventBus.js";
import { AttentionSystem } from "../public/js/localBrain/attentionSystem.js";
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
assert.equal(speechGate.processTranscript({ text: "come here", confidence: 1 }).classification, "direct_to_robot");
const openSpeech = speechGate.processTranscript({ text: "people talking about water", confidence: 1 });
assert.equal(openSpeech.classification, "open_speech");
assert.equal(openSpeech.accepted, true);
assert.equal(openSpeech.shouldTriggerBrain, true);
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
const liveMoveForward = liveGate.processTranscript({ text: "move forward", confidence: 1 });
assert.equal(liveMoveForward.classification, "direct_to_robot");
assert.equal(liveMoveForward.suggestedIntent.action, "run_scenario");
assert.equal(liveMoveForward.suggestedIntent.args.name, "come_closer");

const attention = new AttentionSystem({ logger: () => {} });
attention.wake("smoke", 1000);
assert.equal(attention.getStatus().mode, "attentive");
attention.attentionUntil = Date.now() - 1;
assert.equal(attention.update().mode, "idle");
attention.enterStopCooldown("smoke", 1000);
assert.equal(attention.shouldThinkAboutEvent({ type: "user_speech", payload: { classification: "open_speech" } }), false);

const budget = new BrainLatencyBudget({ eventThoughtTimeoutMs: 5 });
const fallbackValue = await budget.withTimeout(new Promise(() => {}), 5, async () => "fallback");
assert.equal(fallbackValue, "fallback");

let policy = {
  ...createDefaultBrainPolicy(),
  eventThoughtCooldownMs: 0
};
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
        physical: action.type === "run_scenario",
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
  adapter: scenarioAdapter("come_closer", () => {
    adapterCalls += 1;
  }),
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
assert.equal(adapterCalls, 1);

engine.setAdapter(scenarioAdapter("look_left", () => {
  adapterCalls += 1;
}));
engineBus.publish("camera_observation", {
  observation: { userVisible: true }
});
await wait(20);
assert.equal(adapterCalls, 1);
engineBus.publish("user_speech", {
  text: "random room speech",
  classification: "open_speech",
  accepted: true,
  shouldTriggerBrain: true
});
await wait(20);
assert.equal(adapterCalls, 2);

engine.setAdapter(scenarioAdapter("come_closer"));
const scenarioThought = await engine.thinkNow("manual", {
  type: "user_text",
  payload: { text: "come here", accepted: true, shouldTriggerBrain: true }
});
assert.equal(scenarioThought.results[0].status, "completed");
assert.equal(scenarioThought.results[0].type, "run_scenario");

engine.setAdapter(scenarioAdapter("still"));
const stopped = await engine.thinkNow("manual");
assert.equal(stopped.results[0].status, "completed");
assert.equal(executedActions.some((action) => action.type === "run_scenario" && action.args.name === "still"), true);
engine.stop();

policy = {
  ...policy,
  localMotionArmed: true
};

console.log(JSON.stringify({
  ok: true,
  speechGateRecent: speechGate.getRecentTranscripts().length,
  thoughts: engine.getRecentThoughts().length
}));

function scenarioAdapter(name, onThink = () => {}) {
  return {
    async isAvailable() {
      return true;
    },
    async think() {
      onThink();
      return {
        ok: true,
        source: "smoke",
        action: { type: "run_scenario", args: { name } },
        reason: name
      };
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
