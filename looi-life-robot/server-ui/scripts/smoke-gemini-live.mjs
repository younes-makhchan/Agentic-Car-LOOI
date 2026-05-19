import assert from "node:assert/strict";
import {
  GeminiLiveRuntime,
  arrayBufferToBase64,
  float32ToPcm16
} from "../public/js/gemini/geminiLiveRuntime.js";
import {
  buildGeminiLiveSetup,
  geminiFunctionCallToAction
} from "../public/js/gemini/geminiLiveTools.js";
import { compileMovementFrames } from "../public/js/embodiment/movementCatalog.js";

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

if (typeof globalThis.atob !== "function") {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}

const sentMessages = [];
const actions = [];
const stops = [];
let fakeTransport = null;

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
  }

  createBuffer(_channels, length, sampleRate) {
    return {
      duration: length / sampleRate,
      copyToChannel() {}
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect() {},
      start() {
        setTimeout(() => this.onended?.(), 0);
      },
      stop() {
        this.onended?.();
      }
    };
  }

  close() {
    return Promise.resolve();
  }
}

function createFakeTransport({ onOpen, onMessage, onClose }) {
  fakeTransport = {
    send(data) {
      sentMessages.push(JSON.parse(data));
    },
    close() {
      onClose?.({});
    },
    emit(message) {
      onMessage?.({ data: JSON.stringify(message) });
    }
  };
  setTimeout(() => onOpen?.({}), 0);
  return fakeTransport;
}

const toolExecutor = {
  executeBridgeAction(action) {
    actions.push(action);
    return Promise.resolve({
      status: "completed",
      type: action.type,
      executed: true,
      physical: action.type === "perform",
      message: "mock accepted"
    });
  },
  emergencyStop(reason) {
    stops.push(reason);
    return Promise.resolve({
      status: "completed",
      type: "stop",
      executed: true,
      physical: true,
      message: reason
    });
  }
};

const face = {
  setExpression() {},
  setSpeaking() {}
};

const lifeEngine = {
  setListening() {},
  setSpeaking() {}
};

const setup = buildGeminiLiveSetup({
  model: "gemini-3.1-flash-live-preview",
  voice: "Kore",
  thinkingLevel: "minimal"
});
assert.equal(setup.setup.model, "models/gemini-3.1-flash-live-preview");
assert.equal(setup.setup.generationConfig.responseModalities[0], "AUDIO");
assert.ok(setup.setup.tools[0].functionDeclarations.some((tool) => tool.name === "perform"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("move_forward_tiny"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("take_picture"));

const runtime = new GeminiLiveRuntime({
  toolExecutor,
  face,
  lifeEngine,
  fetchToken: async () => ({
    ok: true,
    token: "auth_tokens/test",
    websocketUrl: "wss://example.invalid/live",
    model: "gemini-3.1-flash-live-preview",
    voice: "Kore",
    thinkingLevel: "minimal"
  }),
  transportFactory: createFakeTransport,
  audioContextFactory: () => FakeAudioContext,
  logger: () => {}
});
runtime.configure({
  geminiLiveEnabled: true,
  geminiLiveConfigured: true,
  geminiLiveModel: "gemini-3.1-flash-live-preview",
  geminiLiveVoice: "Kore",
  geminiLiveThinkingLevel: "minimal"
});

await runtime.start({ captureAudio: false });
assert.equal(runtime.getStatus().connected, true);
assert.equal(sentMessages[0].setup.model, "models/gemini-3.1-flash-live-preview");

const pcm = float32ToPcm16(new Float32Array([0, 0.2, -0.2, 0.1]));
const audioData = arrayBufferToBase64(pcm.buffer);
fakeTransport.emit({
  setupComplete: {},
  serverContent: {
    inputTranscription: { text: "move backward more" },
    outputTranscription: { text: "I can move back a little." },
    modelTurn: {
      parts: [
        {
          inlineData: {
            mimeType: "audio/pcm;rate=24000",
            data: audioData
          }
        }
      ]
    }
  }
});
await wait(5);
assert.equal(runtime.getStatus().setupComplete, true);
assert.equal(runtime.getStatus().lastInputTranscript, "move backward more");
assert.equal(runtime.getStatus().lastOutputTranscript, "I can move back a little.");

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "perform_1",
        name: "perform",
        args: {
          movement: ["gentle_wiggle", "move_backward_tiny"],
          timing: "parallel",
          iterateMovement: false
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "perform");
assert.deepEqual(actions.at(-1).args.movement, ["gentle_wiggle", "move_backward_tiny"]);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "picture_1",
        name: "take_picture",
        args: {}
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "perform");
assert.equal(actions.at(-1).args.scenario, "take_picture");
assert.deepEqual(actions.at(-1).args.movement, []);

const mappedUnknown = geminiFunctionCallToAction({
  id: "unknown_move",
  name: "perform",
  args: {
    movement: ["not_a_movement", "move_forward_tiny"]
  }
});
assert.equal(mappedUnknown.ok, true);
const compiled = compileMovementFrames(mappedUnknown.action.args.movement);
assert.deepEqual(compiled.names, ["move_forward_tiny"]);
assert.deepEqual(compiled.ignored, ["not_a_movement"]);

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "stop_1",
        name: "stop",
        args: { reason: "user_stop" }
      }
    ]
  }
});
await wait(5);
assert.deepEqual(stops, ["user_stop"]);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);

await runtime.stop("smoke_done");
assert.equal(runtime.getStatus().running, false);

console.log("smoke:gemini-live passed");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
