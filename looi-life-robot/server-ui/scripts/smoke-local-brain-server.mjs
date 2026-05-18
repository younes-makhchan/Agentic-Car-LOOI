import assert from "node:assert/strict";
import { createLocalBrainServerFromEnv } from "../lib/localBrain/localBrainServer.js";
import {
  normalizeBrainResponse,
  parseBrainResponse,
  stripMarkdownCodeFence,
  validateBrainAction
} from "../lib/localBrain/brainResponseParser.js";
import { sanitizeBrainContext } from "../lib/localBrain/brainContextSanitizer.js";

process.env.LOCAL_BRAIN_ENABLED = "true";
process.env.LOCAL_BRAIN_PROVIDER = "mock";
process.env.LOCAL_BRAIN_MODEL = "";

const localBrain = createLocalBrainServerFromEnv(process.env, () => {});
const status = await localBrain.status();
assert.equal(status.enabled, true);
assert.equal(status.provider, "mock");
assert.equal(status.available, true);

const cases = [
  ["come here", "move_forward_tiny"],
  ["move forward", "move_forward_tiny"],
  ["give me space", "move_backward_tiny"],
  ["look around", "curious_shift"],
  ["stop", "still"]
];

for (const [text, expectedAction] of cases) {
  const response = await localBrain.think({
    reason: "manual",
    triggerEvent: {
      type: "user_text",
      payload: { text }
    },
    context: {
      lifeState: { mood: "curious", energy: 0.8, boredom: 0.4 },
      policy: {
        localBrainEnabled: true,
        localMotionArmed: true,
        localSpeechAllowed: true
      }
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.provider, "mock");
  assert.equal(response.action.type, "perform");
  assert.equal(response.action.args.movement.includes(expectedAction), true);
}

const fallbackServer = createLocalBrainServerFromEnv({
  LOCAL_BRAIN_ENABLED: "true",
  LOCAL_BRAIN_PROVIDER: "bad-provider"
}, () => {});
const fallbackStatus = await fallbackServer.status();
assert.equal(fallbackStatus.provider, "mock");
assert.equal(fallbackStatus.available, true);

const groqServer = createLocalBrainServerFromEnv({
  LOCAL_BRAIN_ENABLED: "true",
  LOCAL_BRAIN_PROVIDER: "groq",
  LOCAL_BRAIN_MODEL: "llama-3.1-8b-instant",
  GROQ_API_KEY: ""
}, () => {});
const groqStatus = await groqServer.status();
assert.equal(groqStatus.provider, "groq");
assert.equal(groqStatus.model, "llama-3.1-8b-instant");
assert.equal(groqStatus.available, false);
assert.match(groqStatus.details.error, /GROQ_API_KEY/);

const fireworksServer = createLocalBrainServerFromEnv({
  LOCAL_BRAIN_ENABLED: "true",
  LOCAL_BRAIN_PROVIDER: "fireworks",
  LOCAL_BRAIN_MODEL: "accounts/fireworks/models/gpt-oss-20b",
  FIREWORKS_API_KEY: ""
}, () => {});
const fireworksStatus = await fireworksServer.status();
assert.equal(fireworksStatus.provider, "fireworks");
assert.equal(fireworksStatus.model, "accounts/fireworks/models/gpt-oss-20b");
assert.equal(fireworksStatus.available, false);
assert.match(fireworksStatus.details.error, /FIREWORKS_API_KEY/);

assert.equal(parseBrainResponse({ text: null, action: null }).action, null);
assert.equal(parseBrainResponse('{"action":{"type":"perform","args":{"movement":["still"]}}}').action.type, "perform");
const performResponse = normalizeBrainResponse(parseBrainResponse({
  action: {
    type: "perform",
    args: {
      speech: { text: "I can come closer.", tone: "happy" },
      movement: ["excited_wiggle", "move_forward_tiny"],
      iterateMovement: true,
      timing: "parallel"
    }
  }
}), { provider: "test", model: "test" });
assert.equal(performResponse.ok, true);
assert.equal(performResponse.action.type, "perform");
assert.equal(performResponse.action.args.speech.text, "I can come closer.");
assert.equal(performResponse.action.args.movement[0], "excited_wiggle");
const legacyMovementResponse = normalizeBrainResponse(parseBrainResponse({
  action: {
    type: "movement",
    args: {
      movement: ["excited_wiggle", "move_forward_tiny"],
      iterateMovement: false,
      timing: "sequence"
    }
  }
}), { provider: "test", model: "test" });
assert.equal(legacyMovementResponse.ok, false);
assert.equal(legacyMovementResponse.action, null);
assert.match(legacyMovementResponse.reason, /Unknown action type/);
assert.equal(stripMarkdownCodeFence("```json\n{\"ok\":true}\n```"), '{"ok":true}');
assert.equal(parseBrainResponse("```json\n{\"action\":{\"type\":\"perform\",\"args\":{\"movement\":[\"still\"]}}}\n```").action.type, "perform");
const invalid = normalizeBrainResponse(parseBrainResponse("not json"), { provider: "test", model: "test" });
assert.equal(invalid.ok, true);
assert.equal(invalid.action, null);
assert.equal(invalid.reason, "invalid_json_from_model");
const unsafeAction = validateBrainAction({
  type: "perform",
  args: {
    left_motor: 1,
    movement: ["move_forward_tiny"]
  }
});
assert.equal(unsafeAction.ok, false);
assert.match(unsafeAction.error, /unsafe/i);

const sanitized = sanitizeBrainContext({
  triggerEvent: {
    type: "user_text",
    payload: {
      text: "hello",
      dataUrl: "data:image/jpeg;base64,AAAA"
    }
  },
  camera: {
    running: true,
    latestObservation: {
      userVisible: true,
      dataUrl: "data:image/jpeg;base64,BBBB"
    }
  },
  memorySummary: "x".repeat(1400),
  recentEvents: Array.from({ length: 30 }, (_, index) => ({
    type: "system",
    payload: {
      text: `event ${index}`,
      dataUrl: "data:image/jpeg;base64,CCCC"
    }
  })),
  secret: "api key should be removed"
});
assert.equal(JSON.stringify(sanitized).includes("data:image"), false);
assert.equal(JSON.stringify(sanitized).includes("api key"), false);
assert.equal(sanitized.recentEvents.length, 20);
assert.equal(String(sanitized.memory).length <= 1000, true);

const { app } = await import("../server.js");
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  const statusResponse = await fetch(`${baseUrl}/api/local-brain/status`);
  const statusPayload = await statusResponse.json();
  assert.equal(statusResponse.ok, true);
  assert.equal(statusPayload.ok, true);
  assert.equal(statusPayload.brain.provider, "mock");

  const thinkResponse = await fetch(`${baseUrl}/api/local-brain/think`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: "manual",
      triggerEvent: {
        type: "user_text",
        payload: { text: "come here" }
      },
      context: {
        lifeState: { mood: "curious", energy: 0.8 },
        policy: { localMotionArmed: true, localSpeechAllowed: true }
      }
    })
  });
  const thinkPayload = await thinkResponse.json();
  assert.equal(thinkResponse.ok, true);
  assert.equal(thinkPayload.ok, true);
  assert.equal(thinkPayload.action.type, "perform");
  assert.equal(thinkPayload.action.args.movement.includes("move_forward_tiny"), true);

  const chatResponse = await fetch(`${baseUrl}/api/local-brain/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "look around",
      context: {
        policy: { localMotionArmed: true, localSpeechAllowed: true }
      }
    })
  });
  const chatPayload = await chatResponse.json();
  assert.equal(chatResponse.ok, true);
  assert.equal(chatPayload.action.type, "perform");
  assert.equal(chatPayload.action.args.movement.includes("curious_shift"), true);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(
  JSON.stringify({
    ok: true,
    provider: status.provider,
    parser: true,
    sanitizer: true
  })
);
