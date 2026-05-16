import assert from "node:assert/strict";
import { SpeechInput } from "../public/js/perception/speech.js";
import { VoiceOutput } from "../public/js/perception/voiceOutput.js";

const logs = [];
const faceEvents = [];
const lifeEvents = [];

const speech = new SpeechInput({
  logger: (message, level = "info") => logs.push({ level, message })
});
assert.equal(speech.isSupported(), false);
speech.start();
speech.stop();

const voice = new VoiceOutput({
  logger: (message, level = "info") => logs.push({ level, message }),
  face: {
    setSpeaking(value) {
      faceEvents.push(value);
    }
  },
  lifeEngine: {
    setSpeaking(value) {
      lifeEvents.push(value);
    }
  }
});

assert.equal(voice.isSupported(), false);
let result = await voice.speak({ text: "hi", tone: "soft" });
assert.equal(result.executed, false);
assert.equal(result.reason, "unsupported");

voice.setMuted(true);
result = await voice.speak({ text: "hi", tone: "soft" });
assert.equal(result.executed, false);
assert.equal(result.reason, "muted");

voice.cancel("smoke");
assert.equal(voice.isSpeaking(), false);

console.log(
  JSON.stringify({
    ok: true,
    speechSupported: speech.isSupported(),
    voiceSupported: voice.isSupported(),
    logs: logs.length,
    faceEvents: faceEvents.length,
    lifeEvents: lifeEvents.length
  })
);
