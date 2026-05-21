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

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

if (typeof globalThis.atob !== "function") {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}

const sentMessages = [];
const actions = [];
const stops = [];
const runtimeLogs = [];
let fakeTransport = null;
let holdNextAction = false;
let heldActionResolve = null;

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
    if (action.type === "run_scenario" && action.args?.name === "back_up") {
      return Promise.resolve({
        status: "rejected",
        type: action.type,
        executed: false,
        physical: true,
        message: "Scenario back_up did not move: local_motion_not_armed"
      });
    }

    if (holdNextAction) {
      holdNextAction = false;
      return new Promise((resolve) => {
        heldActionResolve = () => resolve({
          status: "completed",
          type: action.type,
          executed: true,
          physical: action.type === "run_scenario",
          message: "mock accepted"
        });
      });
    }

    return Promise.resolve({
      status: "completed",
      type: action.type,
      executed: true,
      physical: action.type === "run_scenario",
      message: "mock accepted"
    });
  },
  immediateStop(reason) {
    stops.push(reason);
    return Promise.resolve({
      status: "completed",
      type: "stop",
      executed: true,
      physical: true,
      message: reason
    });
  },
  cancelActiveScenario(reason) {
    stops.push(`cancel:${reason}`);
    return Promise.resolve({
      status: "completed",
      type: "cancel_scenario",
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
assert.equal(setup.setup.generationConfig.temperature, 0.15);
assert.equal(setup.setup.generationConfig.thinkingConfig.thinkingLevel, "minimal");
assert.equal(
  setup.setup.realtimeInputConfig.turnCoverage,
  "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"
);
assert.deepEqual(setup.setup.tools[0].functionDeclarations.map((tool) => tool.name), ["run_scenario"]);
assert.deepEqual(
  setup.setup.tools[0].functionDeclarations.find((tool) => tool.name === "run_scenario").parameters.required,
  ["name"]
);
assert.equal(setup.setup.systemInstruction.parts[0].text.includes("move_forward_tiny"), false);
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("run_scenario"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("follow_target"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("take_picture"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("eating"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("drinking"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("question"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("angry"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("loving"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("shocked"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("tell_me_about_yourself"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("finish_telling"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("kiss"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("autonomous vision"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("When nobody is speaking"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("do not ask for confirmation"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("Gemini output audio begins"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("do not duplicate"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("<vision_rules>"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("person"));
assert.ok(setup.setup.systemInstruction.parts[0].text.includes("runtime exits follow first"));

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
  getRuntimeContext: () => ({
    vision: {
      visibleLabels: "person, bottle",
      objects: [
        {
          label: "person",
          visible: true,
          confidence: 0.86,
          position: "center",
          distance: "near",
          trackId: "track_1",
          lastSeenMs: 120
        }
      ],
      activeTarget: {
        label: "bottle",
        visible: true,
        position: "left",
        distance: "medium",
        trackId: "track_2",
        lostForMs: 0
      },
      scenario: {
        active: true,
        type: "follow_object",
        targetLabel: "bottle",
        state: "following"
      },
      detectorRunning: true,
      cameraRunning: true,
      currentCameraFacingMode: "environment",
      lastDetectionAgeMs: 120
    },
    recentObjectReference: {
      label: "bottle",
      trackId: "track_2",
      lastMentionedByUserAt: new Date().toISOString()
    }
  }),
  logger: (message, level = "info") => runtimeLogs.push({ level, message })
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
const sentVideoFrame = await runtime.sendVideoFrame({
  data: "data:image/jpeg;base64,aGVsbG8=",
  mimeType: "image/jpeg",
  width: 2,
  height: 2,
  reason: "smoke"
});
assert.equal(sentVideoFrame, true);
assert.equal(sentMessages.at(-1).realtimeInput.video.mimeType, "image/jpeg");
assert.equal(sentMessages.at(-1).realtimeInput.video.data, "aGVsbG8=");

fakeTransport.emit({
  serverContent: {
    inputTranscription: { text: "are you there" }
  }
});
await wait(5);
assert.equal(runtime.getStatus().thinking, true);

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
assert.equal(runtime.getStatus().thinking, false);
assert.equal(runtime.getStatus().setupComplete, true);
assert.equal(runtime.getStatus().lastInputTranscript, "move backward more");
assert.equal(runtime.getStatus().lastOutputTranscript, "I can move back a little.");
assert.ok(runtimeLogs.some((entry) => entry.message === "Gemini tool requests: none"));
assert.equal(actions.some((action) => action.source === "gemini_live_speech_start"), false);
const visionContextMessage = sentMessages.find((message) => message.realtimeInput?.text?.startsWith("<vision_context>"));
assert.ok(visionContextMessage, "Gemini Live should receive vision context text");
assert.ok(visionContextMessage.realtimeInput.text.includes('"mode":"roboflow_follow"'));
assert.ok(visionContextMessage.realtimeInput.text.includes('"visibleLabels":"person, bottle"'));
assert.ok(visionContextMessage.realtimeInput.text.includes('"position":"center"'));
assert.equal(/"confidence"|"distance"|"lastSeenMs"|summary/i.test(visionContextMessage.realtimeInput.text), false);
assert.equal(/data:image|base64|dataUrl|imageData/i.test(visionContextMessage.realtimeInput.text), false);

fakeTransport.emit({
  serverContent: {
    inputTranscription: { text: "tell me about yourself" },
    outputTranscription: { text: "I am LOOI, your small companion robot." },
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
assert.ok(actions.some((action) =>
  action.source === "gemini_live_speech_start" &&
  action.type === "run_scenario" &&
  action.args?.name === "tell_me_about_yourself"
));
assert.ok(runtimeLogs.some((entry) => entry.message === "Gemini speech-start scenario: tell_me_about_yourself"));
const speechStartCount = actions.filter((action) => action.source === "gemini_live_speech_start").length;
fakeTransport.emit({
  serverContent: {
    inputTranscription: { text: "tell me about yourself" },
    outputTranscription: { text: "I am LOOI, your small companion robot." },
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
assert.equal(actions.filter((action) => action.source === "gemini_live_speech_start").length, speechStartCount);

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "Ugh, that is frustrating." },
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
assert.ok(actions.some((action) =>
  action.source === "gemini_live_speech_start" &&
  action.args?.name === "angry"
));

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "Wow, I just realized what happened." },
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
assert.ok(actions.some((action) =>
  action.source === "gemini_live_speech_start" &&
  action.args?.name === "shocked"
));

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "Aww, that is so sweet of you." },
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
assert.ok(actions.some((action) =>
  action.source === "gemini_live_speech_start" &&
  action.args?.name === "loving"
));

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "I am confused by that." },
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
assert.ok(actions.some((action) =>
  action.source === "gemini_live_speech_start" &&
  action.args?.name === "question"
));

const deferredActionsBeforeAudio = actions.length;
fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "deferred_telling",
        name: "run_scenario",
        args: {
          name: "tell_me_about_yourself"
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.length, deferredActionsBeforeAudio);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.queued, true);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.executed, false);
assert.ok(runtimeLogs.some((entry) =>
  entry.message === "Gemini deferred speech-start scenario until audio: tell_me_about_yourself"
));

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "I am LOOI, your small companion robot." },
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
assert.equal(actions.length, deferredActionsBeforeAudio + 1);
assert.equal(actions.at(-1).source, "gemini_live");
assert.equal(actions.at(-1).args.name, "tell_me_about_yourself");
assert.ok(runtimeLogs.some((entry) =>
  entry.message === "Gemini deferred speech-start scenario: tell_me_about_yourself"
));

const deferredQuestionActionsBeforeAudio = actions.length;
fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "deferred_question",
        name: "run_scenario",
        args: {
          name: "question"
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.length, deferredQuestionActionsBeforeAudio);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.queued, true);

fakeTransport.emit({
  serverContent: {
    outputTranscription: { text: "Could you clarify that for me?" },
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
assert.equal(actions.length, deferredQuestionActionsBeforeAudio + 1);
assert.equal(actions.at(-1).source, "gemini_live");
assert.equal(actions.at(-1).args.name, "question");
assert.ok(runtimeLogs.some((entry) =>
  entry.message === "Gemini deferred speech-start scenario: question"
));

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "scenario_1",
        name: "run_scenario",
        args: {
          name: "body_talking"
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "run_scenario");
assert.equal(actions.at(-1).args.name, "body_talking");
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);
assert.ok(runtimeLogs.some((entry) => /Gemini tool requests: run_scenario\(/.test(entry.message)));
assert.equal(runtimeLogs.some((entry) => /GEMINI RX/.test(entry.message)), false);

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "scenario_rejected",
        name: "run_scenario",
        args: {
          name: "back_up"
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "run_scenario");
assert.equal(actions.at(-1).args.name, "back_up");
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, false);
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.status, "rejected");
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.executed, false);

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "picture_1",
        name: "run_scenario",
        args: { name: "take_picture" }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "run_scenario");
assert.equal(actions.at(-1).args.name, "take_picture");

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "follow_1",
        name: "run_scenario",
        args: { name: "follow_target", label: "bottle", mode: "gentle" }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "run_scenario");
assert.equal(actions.at(-1).args.name, "follow_target");
assert.equal(actions.at(-1).args.label, "bottle");

holdNextAction = true;
fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "cancel_me",
        name: "run_scenario",
        args: {
          name: "come_closer"
        }
      }
    ]
  }
});
await wait(5);
fakeTransport.emit({
  toolCallCancellation: {
    ids: ["cancel_me"]
  }
});
await wait(5);
assert.ok(stops.includes("cancel:gemini_tool_call_cancelled"));
assert.equal(stops.includes("gemini_tool_call_cancelled"), false);
heldActionResolve?.();
await wait(5);

const cancelsBeforeFollow = stops.filter((entry) => entry === "cancel:gemini_tool_call_cancelled").length;
holdNextAction = true;
fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "cancel_follow",
        name: "run_scenario",
        args: {
          name: "follow_target",
          label: "bottle"
        }
      }
    ]
  }
});
await wait(5);
fakeTransport.emit({
  toolCallCancellation: {
    ids: ["cancel_follow"]
  }
});
await wait(5);
assert.equal(
  stops.filter((entry) => entry === "cancel:gemini_tool_call_cancelled").length,
  cancelsBeforeFollow
);
heldActionResolve?.();
await wait(5);

const mappedUnknown = geminiFunctionCallToAction({
  id: "unknown_scenario",
  name: "run_scenario",
  args: {
    name: "not_a_scenario"
  }
});
assert.equal(mappedUnknown.ok, false);
assert.equal(geminiFunctionCallToAction({
  id: "follow_missing_label",
  name: "run_scenario",
  args: { name: "follow_target" }
}).ok, false);

const mappedStopTool = geminiFunctionCallToAction({
  id: "stop_1",
  name: "stop",
  args: { reason: "user_stop" }
});
assert.equal(mappedStopTool.ok, false);

await runtime.stop("smoke_done");
assert.equal(runtime.getStatus().running, false);

console.log("smoke:gemini-live passed");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
