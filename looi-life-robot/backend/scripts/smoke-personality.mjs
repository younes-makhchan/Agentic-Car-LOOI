import assert from "node:assert/strict";
import {
  createPersonalityProfile,
  describePersonalityForRuntime
} from "../../frontend/js/personality/personalityProfile.js";
import { PersonalityTuning } from "../../frontend/js/personality/personalityTuning.js";
import { LifeEventEmitter } from "../../frontend/js/personality/lifeEvents.js";
import { LifeEngine } from "../../frontend/js/life/lifeEngine.js";

const logs = [];

globalThis.localStorage = createLocalStorageMock();

const profile = createPersonalityProfile({
  name: "  LOOI Test  ",
  coreTraits: {
    curiosity: 9,
    gentleness: -2
  },
  behaviorStyle: {
    idleActivity: 2,
    hesitation: -1
  }
});
assert.equal(profile.name, "LOOI Test");
assert.equal(profile.coreTraits.curiosity, 1);
assert.equal(profile.coreTraits.gentleness, 0);
assert.equal(profile.behaviorStyle.idleActivity, 1);
assert.equal(profile.behaviorStyle.hesitation, 0);
assert.equal(describePersonalityForRuntime(profile).name, "LOOI Test");

const tuning = new PersonalityTuning({
  logger: (message, level = "info") => logs.push({ level, message })
});
tuning.patchTrait("talkativeness", 4);
tuning.patchBehaviorStyle("movementSoftness", -2);
assert.equal(tuning.getProfile().coreTraits.talkativeness, 1);
assert.equal(tuning.getProfile().behaviorStyle.movementSoftness, 0);
tuning.save();
tuning.resetDefaults();
tuning.load();
assert.equal(tuning.getProfile().coreTraits.talkativeness, 1);

const faceEvents = [];
const lifeEngine = new LifeEngine({
  personalityProfile: tuning.getProfile(),
  face: {
    setExpression(expression) {
      faceEvents.push({ type: "expression", expression });
    },
    setEyeDirection(direction) {
      faceEvents.push({ type: "eye", direction });
    }
  },
  logger: (message, level = "info") => logs.push({ level, message })
});
lifeEngine.setPersonalityProfile(profile);
lifeEngine.receiveEvent({ type: "user_text", text: "hello" });
lifeEngine.receiveEvent({ type: "stop", reason: "smoke_stop" });
assert.equal(lifeEngine.getState().interactionCount >= 2, true);
assert.equal(lifeEngine.getState().stopRespectUntil > Date.now(), false);
assert.equal(lifeEngine.getState().robotMotorState, "stopped");

lifeEngine.state.stopRespectUntil = 0;
lifeEngine.state.boredom = 0.9;
lifeEngine.state.loneliness = 0.8;
lifeEngine.state.lastInteractionAt = Date.now() - 60_000;

const postedEvents = [];
const emitter = new LifeEventEmitter({
  lifeEngine,
  personalityTuning: {
    getProfile: () => ({
      coreTraits: {
        talkativeness: 0.8
      }
    })
  },
  postRobotEvent: async (event) => {
    postedEvents.push(event);
    return event;
  },
  minIntervalMs: 1000
});
emitter.start();
await emitter.maybeEmitLifeEvent();
const firstEventCount = postedEvents.length;
await emitter.maybeEmitLifeEvent();
assert.equal(postedEvents.length, firstEventCount);
assert.equal(firstEventCount >= 1, true);
emitter.stop();

console.log(
  JSON.stringify({
    ok: true,
    postedEvents: postedEvents.length,
    faceEvents: faceEvents.length,
    logs: logs.length
  })
);

function createLocalStorageMock() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}
