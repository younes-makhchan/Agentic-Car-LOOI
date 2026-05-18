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
const bus = new LocalEventBus({
  logger: () => {}
});
const unsubscribe = bus.subscribe("user_text", (event) => {
  busEvents.push(event);
});
const allEvents = [];
bus.subscribeAll((event) => {
  allEvents.push(event);
});

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
assert.equal(defaultPolicy.autonomousMode, false);
assert.equal(defaultPolicy.localMotionArmed, false);
assert.equal(defaultPolicy.localCameraAllowed, false);
assert.equal(defaultPolicy.allowAutonomousMovement, false);
const clampedPolicy = clampBrainPolicy({
  localMotionArmed: true,
  maxThoughtsPerMinute: 999,
  minAutonomousThoughtIntervalMs: -1
});
assert.equal(clampedPolicy.localMotionArmed, true);
assert.equal(clampedPolicy.maxThoughtsPerMinute, 60);
assert.equal(clampedPolicy.minAutonomousThoughtIntervalMs, 1000);

const mock = new MockBrainAdapter();
const comeHere = await mock.think(contextForText("come here", { localMotionArmed: true }));
assert.equal(comeHere.actions[0].type, "perform");
assert.equal(comeHere.actions[0].args.movement.includes("move_forward_tiny"), true);
const giveSpace = await mock.think(contextForText("please give me space", { localMotionArmed: true }));
assert.equal(giveSpace.actions[0].type, "perform");
assert.equal(giveSpace.actions[0].args.movement.includes("move_backward_tiny"), true);
const lookAround = await mock.think(contextForText("look around", { localMotionArmed: true }));
assert.equal(lookAround.actions[0].type, "perform");
assert.equal(lookAround.actions[0].args.movement.includes("curious_shift"), true);
const stop = await mock.think(contextForText("freeze"));
assert.equal(stop.actions[0].type, "perform");
assert.equal(stop.actions[0].args.movement.includes("still"), true);

const fallback = new RuleBrainFallback();
assert.equal(fallback.classifyText("freeze"), "safety_stop");
assert.equal(fallback.classifyText("come closer"), "direct_command_approach");
assert.equal(fallback.classifyText("give me room"), "direct_command_retreat");
assert.equal(fallback.classifyText("look around"), "direct_command_look");
assert.equal(fallback.classifyText("hello looi"), "greeting");
assert.equal(fallback.classifyText("why are you alive?"), "direct_question");

const unknownAction = validateBrainAction({ type: "raw_pwm", args: {} });
assert.equal(unknownAction.ok, false);
assert.match(unknownAction.error, /unknown/i);
const rawMotorAction = validateBrainAction({
  type: "drive",
  args: { left_motor: 1, linear: 0.1, angular: 0, duration_ms: 100 }
});
assert.equal(rawMotorAction.ok, false);
assert.match(rawMotorAction.error, /motor|PWM/i);
const invalidJson = parseBrainResponse("{not json");
assert.equal(invalidJson.actions[0].type, "none");
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
        physical: ["drive", "approach_user", "retreat", "curious_scan", "excited_wiggle", "stop"].includes(action.type),
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
      return {
        ok: true,
        source: "test",
        actions: [
          {
            type: "approach_user",
            args: { style: "gentle", distance: "short" }
          }
        ],
        reason: "test physical rejection"
      };
    }
  },
  fallback,
  logger: () => {}
});

const disarmedThought = await engine.thinkNow("manual");
assert.equal(disarmedThought.results[0].status, "completed");
assert.equal(disarmedThought.results[0].type, "perform");
assert.equal(executedActions[0].type, "perform");

engine.setAdapter({
  async isAvailable() {
    return true;
  },
  async think() {
    return {
      ok: true,
      source: "test",
      actions: [
        {
          type: "stop",
          args: { reason: "smoke_local_stop" }
        }
      ],
      reason: "test stop allowed"
    };
  }
});
const stopThought = await engine.thinkNow("manual");
assert.equal(stopThought.results[0].status, "completed");
assert.equal(executedActions.at(-1).type, "perform");

policy = {
  ...policy,
  localMotionArmed: true
};
engine.setAdapter({
  async isAvailable() {
    return true;
  },
  async think() {
    return {
      ok: true,
      source: "test",
      actions: [
        {
          type: "retreat",
          args: { style: "gentle", distance: "short" }
        }
      ],
      reason: "test armed motion"
    };
  }
});
const armedThought = await engine.thinkNow("manual");
assert.equal(armedThought.results[0].status, "completed");
assert.equal(executedActions.some((action) => action.type === "perform" && action.args.movement.includes("move_backward_tiny")), true);

console.log(
  JSON.stringify({
    ok: true,
    busEvents: allEvents.length,
    thoughts: engine.getRecentThoughts().length,
    executedActions: executedActions.length
  })
);

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
