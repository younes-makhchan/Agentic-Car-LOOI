import assert from "node:assert/strict";
import { KimiRobotAgent, parseKimiPlan, sanitizePlan } from "../lib/kimi/kimiRobotAgent.js";

const parsed = parseKimiPlan(`
{
  "say": "I will answer softly.",
  "actions": [
    {
      "type": "speak",
      "args": { "text": "I am here.", "tone": "happy" },
      "reason": "greeting"
    },
    {
      "type": "raw_pwm",
      "args": { "left": 255 },
      "reason": "unsafe"
    }
  ],
  "memory": [
    {
      "type": "long_term",
      "text": "The user prefers gentle movement.",
      "importance": "medium"
    }
  ],
  "ignore": false
}
`);

const safe = sanitizePlan(parsed);
assert.equal(safe.actions.length, 1);
assert.equal(safe.actions[0].type, "speak");
assert.equal(safe.memory.length, 1);

const mockClient = {
  async chat() {
    return {
      content: JSON.stringify({
        say: "short reply",
        actions: [
          {
            type: "express",
            args: {
              emotion: "curious",
              intensity: 0.6
            },
            reason: "user greeted robot"
          }
        ],
        memory: [],
        ignore: false
      }),
      usage: null,
      model: "mock"
    };
  }
};

const agent = new KimiRobotAgent({ kimiClient: mockClient });
const plan = await agent.planTurn({
  events: [
    {
      id: "event_1",
      type: "user_text",
      source: "phone-browser",
      text: "hello looi",
      payload: {}
    }
  ],
  runtime: {
    online: true,
    cloudMotionArmed: false
  },
  memory: {},
  learnedPhrases: []
});

assert.equal(plan.actions.length, 1);
assert.equal(plan.actions[0].type, "express");

console.log(JSON.stringify({ ok: true, actions: plan.actions.length }));
