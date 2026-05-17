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
  ["come here", "approach_user"],
  ["move forward", "drive"],
  ["give me space", "retreat"],
  ["look around", "curious_scan"],
  ["stop", "stop"]
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
  assert.equal(response.actions.some((action) => action.type === expectedAction), true);
}

const fallbackServer = createLocalBrainServerFromEnv({
  LOCAL_BRAIN_ENABLED: "true",
  LOCAL_BRAIN_PROVIDER: "bad-provider"
}, () => {});
const fallbackStatus = await fallbackServer.status();
assert.equal(fallbackStatus.provider, "mock");
assert.equal(fallbackStatus.available, true);

assert.deepEqual(parseBrainResponse({ text: null, actions: [] }).actions, []);
assert.equal(parseBrainResponse('{"actions":[{"type":"express","args":{"emotion":"happy"}}]}').actions[0].type, "express");
assert.equal(stripMarkdownCodeFence("```json\n{\"ok\":true}\n```"), '{"ok":true}');
assert.equal(parseBrainResponse("```json\n{\"actions\":[{\"type\":\"stop\",\"args\":{}}]}\n```").actions[0].type, "stop");
const invalid = normalizeBrainResponse(parseBrainResponse("not json"), { provider: "test", model: "test" });
assert.equal(invalid.ok, true);
assert.equal(invalid.actions.length, 0);
assert.equal(invalid.reason, "invalid_json_from_model");
const unsafeAction = validateBrainAction({
  type: "drive",
  args: {
    left_motor: 1,
    linear: 0.2
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
  assert.equal(thinkPayload.actions.some((action) => action.type === "approach_user"), true);

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
  assert.equal(chatPayload.actions.some((action) => action.type === "curious_scan"), true);
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
