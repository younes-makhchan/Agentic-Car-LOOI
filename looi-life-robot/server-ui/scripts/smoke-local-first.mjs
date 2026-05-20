import assert from "node:assert/strict";
import { LocalEventBus } from "../public/js/core/localEventBus.js";
import {
  parseBrainResponse,
  validateBrainAction
} from "../public/js/localBrain/actionParser.js";
import {
  clampBrainPolicy,
  createDefaultBrainPolicy
} from "../public/js/localBrain/brainPolicy.js";
import { LocalBrainEngine } from "../public/js/localBrain/localBrainEngine.js";
import { MockBrainAdapter } from "../public/js/localBrain/mockBrainAdapter.js";
import { RuleBrainFallback } from "../public/js/localBrain/ruleBrainFallback.js";

const busEvents = [];
const bus = new LocalEventBus({ logger: () => {} });
const unsubscribe = bus.subscribe("user_text", (event) => busEvents.push(event));
const allEvents = [];
bus.subscribeAll((event) => allEvents.push(event));

const event = bus.publish("user_text", { text: "hello" }, { priority: 2 });
assert.equal(event.type, "user_text");
assert.equal(busEvents.length, 1);
assert.equal(allEvents.length, 1);
assert.equal(bus.getRecentEvents({ limit: 1 })[0].payload.text, "hello");
unsubscribe();
bus.publish("user_text", { text: "after unsubscribe" });
assert.equal(busEvents.length, 1);
assert.equal(bus.clear() >= 2, true);
assert.equal(bus.getRecentEvents().length, 0);

const defaultPolicy = createDefaultBrainPolicy();
assert.equal(defaultPolicy.localBrainEnabled, true);
assert.equal(defaultPolicy.localMotionArmed, false);
assert.equal(defaultPolicy.localCameraAllowed, false);
assert.equal(defaultPolicy.maxThoughtsPerMinute, 12);
const clampedPolicy = clampBrainPolicy({
  localMotionArmed: true,
  maxThoughtsPerMinute: 999
});
assert.equal(clampedPolicy.localMotionArmed, true);
assert.equal(clampedPolicy.maxThoughtsPerMinute, 60);

const mock = new MockBrainAdapter();
const comeHere = await mock.think(contextForText("come here"));
assert.equal(comeHere.action.type, "run_scenario");
assert.equal(comeHere.action.args.name, "come_closer");
const giveSpace = await mock.think(contextForText("please give me space"));
assert.equal(giveSpace.action.args.name, "back_up");
const lookAround = await mock.think(contextForText("look around"));
assert.equal(lookAround.action.args.name, "body_talking");
const stop = await mock.think(contextForText("freeze"));
assert.equal(stop.action, null);

const fallback = new RuleBrainFallback();
assert.equal(fallback.classifyText("freeze"), "safety_stop");
assert.equal(fallback.classifyText("come closer"), "scenario_come_closer");
assert.equal(fallback.classifyText("give me room"), "scenario_back_up");
assert.equal(fallback.classifyText("look around"), "scenario_body_talking");
assert.equal(fallback.classifyText("hello looi"), "greeting");
assert.equal(fallback.classifyText("why are you alive?"), "direct_question");

const unknownAction = validateBrainAction({ type: "raw_pwm", args: {} });
assert.equal(unknownAction.ok, false);
assert.match(unknownAction.error, /unknown/i);
const rawMotorAction = validateBrainAction({
  type: "run_scenario",
  args: { name: "come_closer", left_motor: 1 }
});
assert.equal(rawMotorAction.ok, false);
assert.match(rawMotorAction.error, /motor|unsafe|PWM/i);
const invalidJson = parseBrainResponse("{not json");
assert.equal(invalidJson.action.type, "none");
assert.equal(invalidJson.ok, false);

let policy = createDefaultBrainPolicy();
const executedActions = [];
const engine = new LocalBrainEngine({
  eventBus: new LocalEventBus({ logger: () => {} }),
  lifeEngine: {
    getState() {
      return {
        mood: "neutral",
        boredom: 0.1,
        stopRespectUntil: 0
      };
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
  adapter: scenarioAdapter("come_closer"),
  fallback,
  logger: () => {}
});

const firstThought = await engine.thinkNow("manual");
assert.equal(firstThought.results[0].status, "completed");
assert.equal(firstThought.results[0].type, "run_scenario");
assert.equal(executedActions[0].args.name, "come_closer");

engine.setAdapter(scenarioAdapter("still"));
const stillThought = await engine.thinkNow("manual");
assert.equal(stillThought.results[0].status, "completed");
assert.equal(executedActions.at(-1).args.name, "still");

policy = {
  ...policy,
  localMotionArmed: true
};
engine.setAdapter(scenarioAdapter("back_up"));
const armedThought = await engine.thinkNow("manual");
assert.equal(armedThought.results[0].status, "completed");
assert.equal(executedActions.some((action) => action.type === "run_scenario" && action.args.name === "back_up"), true);

console.log(
  JSON.stringify({
    ok: true,
    busEvents: allEvents.length,
    thoughts: engine.getRecentThoughts().length,
    executedActions: executedActions.length
  })
);

function scenarioAdapter(name) {
  return {
    async isAvailable() {
      return true;
    },
    async think() {
      return {
        ok: true,
        source: "test",
        action: {
          type: "run_scenario",
          args: { name }
        },
        reason: `test_${name}`
      };
    }
  };
}

function contextForText(text, policyPatch = {}) {
  return {
    triggerEvent: {
      type: "user_text",
      payload: { text }
    },
    recentEvents: [],
    policy: {
      ...createDefaultBrainPolicy(),
      ...policyPatch
    },
    lifeState: { boredom: 0.1 }
  };
}
