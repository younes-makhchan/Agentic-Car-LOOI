import assert from "node:assert/strict";
import { createLocalBrainServerFromEnv } from "../lib/localBrain/localBrainServer.js";
import {
  normalizeBrainResponse,
  parseBrainResponse,
  stripMarkdownCodeFence,
  validateBrainAction
} from "../lib/localBrain/brainResponseParser.js";
import { sanitizeBrainContext } from "../lib/localBrain/brainContextSanitizer.js";
import { sanitizeBrainRequestValue } from "../public/js/localBrain/localServerBrainAdapter.js";

process.env.LOCAL_BRAIN_ENABLED = "true";
process.env.LOCAL_BRAIN_PROVIDER = "mock";
process.env.LOCAL_BRAIN_MODEL = "";

const localBrain = createLocalBrainServerFromEnv(process.env, () => {});
const status = await localBrain.status();
assert.equal(status.enabled, true);
assert.equal(status.provider, "mock");
assert.equal(status.available, true);

const cases = [
  ["come here", "come_closer"],
  ["move forward", "come_closer"],
  ["give me space", "back_up"],
  ["look left", "look_left"]
];

for (const [text, expectedScenario] of cases) {
  const response = await localBrain.think({
    reason: "manual",
    triggerEvent: {
      type: "user_text",
      payload: { text }
    },
    context: {
      lifeState: { mood: "curious", energy: 0.8, boredom: 0.4 },
      policy: {
        localMotionArmed: true
      }
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.provider, "mock");
  assert.equal(response.action.type, "run_scenario");
  assert.equal(response.action.args.name, expectedScenario);
}

const pictureResponse = await localBrain.think({
  reason: "manual",
  triggerEvent: {
    type: "user_text",
    payload: { text: "take a picture of me" }
  },
  context: {
    policy: {
      localMotionArmed: true
    }
  }
});
assert.equal(pictureResponse.ok, true);
assert.equal(pictureResponse.action.type, "run_scenario");
assert.equal(pictureResponse.action.args.name, "take_picture");

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
assert.equal(parseBrainResponse('{"action":{"type":"run_scenario","args":{"name":"still"}}}').action.type, "run_scenario");
const scenarioResponse = normalizeBrainResponse(parseBrainResponse({
  action: {
    type: "run_scenario",
    args: {
      name: "take_picture",
      reason: "photo_request"
    }
  }
}), { provider: "test", model: "test" });
assert.equal(scenarioResponse.ok, true);
assert.equal(scenarioResponse.action.type, "run_scenario");
assert.equal(scenarioResponse.action.args.name, "take_picture");
const rejectedPerformResponse = normalizeBrainResponse(parseBrainResponse({
  action: {
    type: "perform",
    args: {
      movement: ["look_left"]
    }
  }
}), { provider: "test", model: "test" });
assert.equal(rejectedPerformResponse.ok, false);
assert.equal(rejectedPerformResponse.action, null);
assert.match(rejectedPerformResponse.reason, /Unknown action type/);
assert.equal(stripMarkdownCodeFence("```json\n{\"ok\":true}\n```"), '{"ok":true}');
assert.equal(parseBrainResponse("```json\n{\"action\":{\"type\":\"run_scenario\",\"args\":{\"name\":\"still\"}}}\n```").action.type, "run_scenario");
const invalid = normalizeBrainResponse(parseBrainResponse("not json"), { provider: "test", model: "test" });
assert.equal(invalid.ok, true);
assert.equal(invalid.action, null);
assert.equal(invalid.reason, "invalid_json_from_model");
const unsafeAction = validateBrainAction({
  type: "run_scenario",
  args: {
    name: "come_closer",
    left_motor: 1
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
assert.equal("memory" in sanitized, false);
assert.equal("learnedPhraseCount" in sanitized, false);

const browserSanitized = sanitizeBrainRequestValue({
  recentThoughts: [
    {
      results: [
        {
          detail: {
            snapshot: {
              width: 640,
              dataUrl: `data:image/jpeg;base64,${"A".repeat(160000)}`
            }
          }
        }
      ]
    }
  ]
});
assert.equal(JSON.stringify(browserSanitized).includes("data:image"), false);
assert.equal("dataUrl" in browserSanitized.recentThoughts[0].results[0].detail.snapshot, false);

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
        policy: { localMotionArmed: true }
      }
    })
  });
  const thinkPayload = await thinkResponse.json();
  assert.equal(thinkResponse.ok, true);
  assert.equal(thinkPayload.ok, true);
  assert.equal(thinkPayload.action.type, "run_scenario");
  assert.equal(thinkPayload.action.args.name, "come_closer");

  const chatResponse = await fetch(`${baseUrl}/api/local-brain/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "look left",
      context: {
        policy: { localMotionArmed: true }
      }
    })
  });
  const chatPayload = await chatResponse.json();
  assert.equal(chatResponse.ok, true);
  assert.equal(chatPayload.action.type, "run_scenario");
  assert.equal(chatPayload.action.args.name, "look_left");
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
