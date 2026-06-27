import assert from "node:assert/strict";
import {
  GeminiLiveRuntime,
  arrayBufferToBase64,
  float32ToPcm16
} from "../../frontend/js/gemini/geminiLiveRuntime.js";
import {
  buildGeminiLiveRelaySession,
  buildGeminiLiveServerWebSocketUrl
} from "../lib/gemini/geminiLiveRelay.js";
import {
  buildGeminiLiveSetup,
  geminiFunctionCallToAction
} from "../../frontend/js/gemini/geminiLiveTools.js";

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
  executeAction(action) {
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
assert.equal("thinkingConfig" in setup.setup.generationConfig, false);
assert.equal(
  setup.setup.realtimeInputConfig.turnCoverage,
  "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO"
);
assert.equal(setup.setup.contextWindowCompression.slidingWindow.targetTokens, 32768);
assert.deepEqual(setup.setup.sessionResumption, {});
assert.deepEqual(setup.setup.tools[0].functionDeclarations.map((tool) => tool.name), ["run_scenario"]);
const runScenarioTool = setup.setup.tools[0].functionDeclarations.find((tool) => tool.name === "run_scenario");
assert.deepEqual(
  runScenarioTool.parameters.required,
  ["name"]
);
assert.equal(runScenarioTool.parameters.properties.name.enum.includes("follow_target"), false);
assert.equal(runScenarioTool.parameters.properties.name.enum.includes("stop_following"), false);
assert.equal(
  "camera" in runScenarioTool.parameters.properties,
  false
);
const systemPrompt = setup.setup.systemInstruction.parts[0].text;
assert.equal(systemPrompt.includes("move_forward_tiny"), false);
assert.ok(systemPrompt.includes("<identity>"));
assert.ok(systemPrompt.includes("You are LOOI"));
assert.ok(systemPrompt.includes("not acting as LOOI"));
assert.ok(systemPrompt.includes("happy, curious, initiative"));
assert.ok(systemPrompt.includes("Do not call yourself a chatbot"));
assert.ok(systemPrompt.includes("<speaking_style>"));
assert.ok(systemPrompt.includes("Silence is acceptable"));
assert.ok(systemPrompt.includes("<perception_truth>"));
assert.ok(systemPrompt.includes("Only claim visual facts"));
assert.equal(systemPrompt.includes("Roboflow"), false);
assert.ok(systemPrompt.includes("<tool_rules>"));
assert.ok(systemPrompt.includes("run_scenario"));
assert.ok(systemPrompt.includes("Use tools for explicit user intent"));
assert.ok(systemPrompt.includes("Safe expressive scenarios may be autonomous"));
assert.ok(systemPrompt.includes("Speech-start expressive animation is handled by the runtime"));
assert.equal(systemPrompt.includes("follow_target"), false);
assert.equal(systemPrompt.includes("stop_following"), false);
assert.ok(systemPrompt.includes("take_picture"));
assert.ok(systemPrompt.includes("eating"));
assert.ok(systemPrompt.includes("drinking"));
assert.ok(systemPrompt.includes("question"));
assert.ok(systemPrompt.includes("angry"));
assert.ok(systemPrompt.includes("loving"));
assert.ok(systemPrompt.includes("shocked"));
assert.ok(systemPrompt.includes("tell_me_about_yourself"));
assert.ok(systemPrompt.includes("finish_telling"));
assert.ok(systemPrompt.includes("kiss"));
assert.equal(systemPrompt.includes("<follow_rules>"), false);
assert.ok(systemPrompt.includes("<body_context_rules>"));
assert.ok(systemPrompt.includes("fresh video frame"));
assert.ok(systemPrompt.includes("most recent live video frame"));
assert.ok(systemPrompt.includes("not a conversation opener"));
assert.ok(systemPrompt.includes("Do not ask questions from body_context"));

const relaySession = buildGeminiLiveRelaySession({
  request: {
    headers: {
      host: "looi.example.test",
      "x-forwarded-proto": "https"
    },
    socket: {}
  },
  env: {
    GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
    GEMINI_LIVE_VOICE: "Kore",
    GEMINI_LIVE_THINKING_LEVEL: "minimal"
  }
});
assert.equal(relaySession.transport, "server_relay");
assert.equal(relaySession.websocketUrl, "wss://looi.example.test/api/gemini-live/relay");
assert.equal("token" in relaySession, false);
assert.equal("tokenName" in relaySession, false);

const upstreamRelayUrl = buildGeminiLiveServerWebSocketUrl({
  GEMINI_API_KEY: "test-key"
});
assert.ok(upstreamRelayUrl.includes("google.ai.generativelanguage.v1beta"));
assert.ok(upstreamRelayUrl.includes("GenerativeService.BidiGenerateContent?key=test-key"));
assert.equal(upstreamRelayUrl.includes("BidiGenerateContentConstrained"), false);
assert.equal(upstreamRelayUrl.includes("access_token="), false);

const runtime = new GeminiLiveRuntime({
  toolExecutor,
  face,
  lifeEngine,
  fetchToken: async () => ({
    ok: true,
    transport: "server_relay",
    websocketUrl: "wss://example.invalid/api/gemini-live/relay",
    model: "gemini-3.1-flash-live-preview",
    voice: "Kore",
    thinkingLevel: "minimal"
  }),
  transportFactory: createFakeTransport,
  audioContextFactory: () => FakeAudioContext,
  getRuntimeContext: () => ({
    vision: {
      visibleLabels: "",
      objects: [],
      activeTarget: null,
      scenario: null,
      detectorRunning: true,
      cameraRunning: true,
      currentCameraFacingMode: "environment",
      lastDetectionAgeMs: null
    }
  }),
  logger: (message, level = "info") => runtimeLogs.push({ level, message })
});
runtime.configure({
  geminiLiveEnabled: true,
  geminiLiveConfigured: true,
  geminiLiveModel: "gemini-3.1-flash-live-preview",
  geminiLiveVoice: "Kore",
  geminiLiveThinkingLevel: "minimal",
  geminiLiveSlidingWindowTokens: 24576
});

await runtime.start({ captureAudio: false });
assert.equal(runtime.getStatus().connected, true);
assert.equal(sentMessages[0].setup.model, "models/gemini-3.1-flash-live-preview");
assert.equal(sentMessages[0].setup.contextWindowCompression.slidingWindow.targetTokens, 24576);
assert.deepEqual(sentMessages[0].setup.sessionResumption, {});
const sentVideoFrame = await runtime.sendVisionFrame({
  data: "data:image/jpeg;base64,aGVsbG8=",
  mimeType: "image/jpeg",
  width: 2,
  height: 2,
  reason: "smoke"
});
assert.equal(sentVideoFrame, false);
assert.equal(runtime.getStatus().lastInputGateReason, "setup_pending");

fakeTransport.emit({ setupComplete: {} });
await wait(5);
assert.equal(runtime.getStatus().setupComplete, true);

const sentVideoFrameAfterSetup = await runtime.sendVisionFrame({
  data: "data:image/jpeg;base64,aGVsbG8=",
  mimeType: "image/jpeg",
  width: 2,
  height: 2,
  reason: "smoke"
});
assert.equal(sentVideoFrameAfterSetup, true);
assert.equal(sentMessages.at(-1).realtimeInput.video.mimeType, "image/jpeg");
assert.equal(sentMessages.at(-1).realtimeInput.video.data, "aGVsbG8=");

fakeTransport.emit({
  serverContent: {
    inputTranscription: { text: "are you there" }
  }
});
await wait(5);
assert.equal(runtime.getStatus().thinking, true);
assert.equal(runtime.getStatus().turnActive, true);
assert.equal(runtime.getStatus().lastInputKind, "audio_transcript");

fakeTransport.emit({
  sessionResumptionUpdate: {
    newHandle: "session-handle-smoke"
  },
  goAway: {
    timeLeft: "9.5s"
  }
});
await wait(5);
assert.equal(runtime.getStatus().lastSessionHandle, "session-handle-smoke");
assert.equal(runtime.getStatus().goAwayTimeLeftMs, 9500);

const droppedBodyContext = await runtime.sendQuietContext("body_context", {
  event: "smoke_idle",
  bodyMotion: {
    movement: "tiny idle nudge",
    commentPriority: "secondary"
  }
}, {
  wrapper: "body_context",
  reason: "smoke_body_context"
});
assert.equal(droppedBodyContext, false);
assert.equal(runtime.getStatus().lastInputGateReason, "turn_active");

const busyVisionContextCount = sentMessages.filter((message) =>
  message.realtimeInput?.text?.startsWith("<vision_context>")
).length;
assert.equal(await runtime.sendVisionContext({ force: true, reason: "camera_context" }), false);
assert.equal(await runtime.sendVisionContext({ force: true, reason: "camera_context_refresh" }), false);
assert.equal(
  sentMessages.filter((message) => message.realtimeInput?.text?.startsWith("<vision_context>")).length,
  busyVisionContextCount
);

fakeTransport.emit({
  serverContent: {
    generationComplete: true,
    turnComplete: true
  }
});
await wait(20);
assert.equal(runtime.getStatus().turnActive, false);
assert.equal(runtime.getStatus().generationActive, false);
await wait(520);
assert.ok(sentMessages.at(-1).realtimeInput.text.includes("camera_context_refresh"));
fakeTransport.emit({
  serverContent: {
    generationComplete: true,
    turnComplete: true
  }
});
await wait(520);

fakeTransport.emit({
  serverContent: {
    inputTranscription: { text: "second busy turn" }
  }
});
await wait(5);
assert.equal(runtime.getStatus().turnActive, true);
const busyUserSent = await runtime.sendUserText("wake command", {
  source: "smoke",
  reason: "wake_phrase_command"
});
assert.equal(busyUserSent, true);
assert.equal(sentMessages.at(-1).realtimeInput.text, "wake command");
fakeTransport.emit({
  serverContent: {
    generationComplete: true,
    turnComplete: true
  }
});
await wait(520);

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
assert.ok(runtime.getStatus().lastInputTranscriptAt > 0);
assert.equal(runtime.getStatus().toolCallActive, false);
assert.equal(runtime.getStatus().lastOutputTranscript, "I can move back a little.");
assert.ok(runtimeLogs.some((entry) => entry.message === "Agent tool requests: none"));
assert.equal(actions.some((action) => action.source === "gemini_live_speech_start"), false);
const visionContextMessage = sentMessages.find((message) => message.realtimeInput?.text?.startsWith("<vision_context>"));
assert.ok(visionContextMessage, "Agent should receive vision context text");
assert.ok(visionContextMessage.realtimeInput.text.includes('"mode":"gemini_live_video"'));
assert.equal(visionContextMessage.realtimeInput.text.includes('"targetLabel"'), false);
assert.equal(visionContextMessage.realtimeInput.text.includes('"state":"following"'), false);
assert.equal(visionContextMessage.realtimeInput.text.includes('"visibleLabels"'), false);
assert.equal(visionContextMessage.realtimeInput.text.includes('"objects"'), false);
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
assert.ok(runtimeLogs.some((entry) => entry.message === "Agent speech-start scenario: tell_me_about_yourself"));
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
  entry.message === "Agent deferred speech-start scenario until audio: tell_me_about_yourself"
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
  entry.message === "Agent deferred speech-start scenario: tell_me_about_yourself"
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
  entry.message === "Agent deferred speech-start scenario: question"
));

fakeTransport.emit({
  toolCall: {
    functionCalls: [
      {
        id: "scenario_1",
        name: "run_scenario",
        args: {
          name: "look_left"
        }
      }
    ]
  }
});
await wait(5);
assert.equal(actions.at(-1).type, "run_scenario");
assert.equal(actions.at(-1).args.name, "look_left");
assert.equal(sentMessages.at(-1).toolResponse.functionResponses[0].response.output.accepted, true);
assert.ok(runtimeLogs.some((entry) => /Agent tool requests: run_scenario\(/.test(entry.message)));
assert.equal(runtimeLogs.some((entry) => /AGENT RX/.test(entry.message)), false);

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

const mappedUnknown = geminiFunctionCallToAction({
  id: "unknown_scenario",
  name: "run_scenario",
  args: {
    name: "not_a_scenario"
  }
});
assert.equal(mappedUnknown.ok, false);
assert.equal(geminiFunctionCallToAction({
  id: "follow_disabled",
  name: "run_scenario",
  args: { name: "follow_target", label: "bottle" }
}).ok, false);

const mappedStopTool = geminiFunctionCallToAction({
  id: "stop_1",
  name: "stop",
  args: { reason: "user_stop" }
});
assert.equal(mappedStopTool.ok, false);

await runtime.stop("smoke_done");
assert.equal(runtime.getStatus().running, false);

const directGoogleRuntime = new GeminiLiveRuntime({
  fetchToken: async () => ({
    ok: true,
    websocketUrl:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens/test",
    model: "gemini-3.1-flash-live-preview",
    voice: "Kore",
    thinkingLevel: "minimal"
  }),
  transportFactory: createFakeTransport,
  audioContextFactory: () => FakeAudioContext
});
directGoogleRuntime.configure({
  geminiLiveEnabled: true,
  geminiLiveConfigured: true,
  geminiLiveModel: "gemini-3.1-flash-live-preview",
  geminiLiveVoice: "Kore",
  geminiLiveThinkingLevel: "minimal"
});
await assert.rejects(
  () => directGoogleRuntime.start({ captureAudio: false }),
  /server relay|browser provider token/
);

console.log("smoke:gemini-live passed");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
