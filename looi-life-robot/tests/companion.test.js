import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CONFIG,
  validateConfig,
  saveConfiguration,
  loadConfiguration,
  validateProfile,
  profileInstruction,
} from "../frontend/js/companion/configuration.js";
import {
  SessionCoordinator,
  MotionAuthority,
  WakePolicy,
  FollowPolicy,
  ScenePolicy,
  BoundedDiagnostics,
} from "../frontend/js/companion/policies.js";
import { sanitizeBrainContext } from "../backend/lib/localBrain/brainContextSanitizer.js";
const clone = (x) => structuredClone(x),
  catalog = JSON.parse(
    readFileSync(
      new URL("../frontend/models/idle-scenes.json", import.meta.url),
    ),
  ),
  ids = new Set(catalog.map((s) => s.id));
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    key: (n) => [...m.keys()][n],
    get length() {
      return m.size;
    },
  };
};
test("portable Android 1.3.0 configuration round trips without field loss", () => {
  const native = JSON.parse(
    readFileSync(
      new URL("../frontend/models/default-companion.json", import.meta.url),
    ),
  );
  assert.deepEqual(validateConfig(native, ids), native);
  assert.deepEqual(
    validateConfig(JSON.stringify(DEFAULT_CONFIG), ids),
    DEFAULT_CONFIG,
  );
});
test("invalid import never overwrites persisted configuration", () => {
  const s = storage();
  saveConfiguration(s, DEFAULT_CONFIG, ids);
  const before = s.getItem("looi.companion.v1");
  for (const edit of [
    (c) => (c.profile.coreTraits.curiosity = "1"),
    (c) => (c.wake.silenceTimeout = 1),
    (c) => (c.idle.scenes.unknown = {}),
    (c) => (c.idle.silent.maximum = 0),
    (c) => (c.behavior.enabled = "true"),
  ]) {
    const c = clone(DEFAULT_CONFIG);
    edit(c);
    assert.throws(() => saveConfiguration(s, c, ids));
    assert.equal(s.getItem("looi.companion.v1"), before);
  }
});
test("legacy persona migration creates backup without deleting stored settings", () => {
  const s = storage();
  s.setItem(
    "looi.personalityProfile.v1",
    JSON.stringify({ ...DEFAULT_CONFIG.profile, name: "Test" }),
  );
  s.setItem("looi.device.records", "original");
  const c = loadConfiguration(s, ids);
  assert.equal(c.profile.name, "Test");
  assert.equal(s.getItem("looi.device.records"), "original");
  assert.ok(s.getItem("looi.migration.130.backup"));
});
test("persona safety boundaries cannot be disabled and Live uses same profile", () => {
  const p = validateProfile({
    ...DEFAULT_CONFIG.profile,
    boundaries: { doNotMoveWhenUnarmed: false },
  });
  assert.equal(p.boundaries.doNotMoveWhenUnarmed, true);
  assert.match(profileInstruction(p), /"curiosity":0.75/);
  assert.deepEqual(
    sanitizeBrainContext({ personality: p }).personality.coreTraits,
    p.coreTraits,
  );
  assert.throws(() =>
    sanitizeBrainContext({
      personality: { ...p, coreTraits: { curiosity: 2 } },
    }),
  );
});
test("session cancellation invalidates delayed starts and duplicate play", () => {
  const s = new SessionCoordinator(),
    t = s.begin();
  assert.equal(s.begin(), null);
  s.stop();
  assert.equal(s.valid(t), false);
  const n = s.begin();
  s.suspend();
  assert.equal(s.valid(n), false);
});
test("stop ACK barrier invalidates slow acquisition and late replies", async () => {
  const sends = [],
    acks = [];
  const a = new MotionAuthority({
    ready: () => true,
    send: (p) => {
      sends.push(p);
      return new Promise((resolve) => acks.push(resolve));
    },
  });
  const first = a.acquire("idle");
  await new Promise(setImmediate);
  const stop = a.stop();
  acks.shift()();
  await assert.rejects(first, /Cancelled/);
  await new Promise(setImmediate);
  acks.shift()();
  await stop;
  assert.equal(a.armed, false);
  assert.deepEqual(
    sends.map((p) => p.type),
    ["stop", "stop"],
  );
});
test("motion priorities and cancelled leases cannot restart motion", async () => {
  const sent = [],
    a = new MotionAuthority({
      ready: () => true,
      send: async (p) => sent.push(p),
    });
  const manual = await a.acquire("manual");
  await assert.rejects(a.acquire("idle"), /busy/);
  await a.motion({ linear: 0.2, angular: 0, duration_ms: 150 }, manual);
  await a.stop();
  await assert.rejects(
    a.motion({ linear: 0.2, angular: 0 }, manual),
    /Expired/,
  );
  assert.equal(sent.filter((p) => p.type === "motion").length, 1);
});
test("failed stop ACK prevents a new owner and disconnect rejects acquire", async () => {
  const a = new MotionAuthority({
    ready: () => true,
    send: async () => {
      throw Error("slow ACK");
    },
  });
  await assert.rejects(a.acquire("manual"));
  assert.equal(a.armed, false);
  const b = new MotionAuthority({
    ready: () => false,
    send: async () => {
      throw Error("should not send");
    },
  });
  await assert.rejects(b.acquire("manual"));
});
test("wake prerecording is bounded to one second and handoff is ordered once", () => {
  const w = new WakePolicy();
  w.wait(0);
  w.append(new Int16Array(16000).fill(7), 0);
  w.append(new Int16Array(1600).fill(8), 0.1);
  assert.equal(w.buffer.length, 32000);
  const token = w.wake(1);
  assert.equal(w.wake(1), null);
  w.append(new Int16Array(1600).fill(9), 1.1);
  const data = w.connected(token, 2);
  assert.equal(new Int16Array(data.buffer).at(-1), 9);
  assert.equal(w.connected(token, 3), null);
  assert.equal(w.buffer.length, 0);
});
test("wake overflow clears entire question; pause cancels late connect", () => {
  const w = new WakePolicy();
  w.wait(0);
  const t = w.wake(1);
  for (let n = 0; n < 81; n++) w.append(new Int16Array(1600), 1 + n * 0.1);
  assert.equal(w.overflow, true);
  assert.equal(w.buffer.length, 0);
  w.stop("paused");
  assert.equal(w.connected(t, 10), null);
  assert.equal(w.phase, "paused");
});
test("wake silence excludes processing and playback", () => {
  const w = new WakePolicy();
  w.phase = "conversation";
  w.lastActivity = 20;
  assert.equal(w.timedOut(100, 60, true), false);
  assert.equal(w.timedOut(79, 60, false), false);
  assert.equal(w.timedOut(80, 60, false), true);
});
const d = (time = 0, x = 0.4, area = 0.04) => ({
  id: "1",
  label: "person",
  confidence: 0.9,
  time,
  box: { x, y: 0.4, w: 0.2, h: area / 0.2 },
});
test("follow hysteresis, 14% turn and 300ms freshness", () => {
  const f = new FollowPolicy();
  f.select(d());
  assert.equal(f.calibrate(0), true);
  f.start(0);
  f.update([d(0.1, 0.4, 0.02)], 0.1);
  assert.equal(f.intent(0.1).linear, 0.1);
  f.update([d(0.2, 0.4, 0.034)], 0.2);
  assert.equal(f.intent(0.2).linear, 0.1);
  f.update([d(0.3, 0.4, 0.04)], 0.3);
  assert.equal(f.intent(0.3).linear, 0);
  assert.equal(f.intent(0.61).linear, 0);
  assert.equal(f.enabled, false);
});
test("follow never automatically swaps ambiguous target or reverses", () => {
  const f = new FollowPolicy();
  f.select(d());
  f.calibrate(0);
  f.start(0);
  f.update([d(0.1), { ...d(0.1), id: "2" }], 0.1);
  assert.equal(f.enabled, false);
  assert.equal(f.target, null);
  f.select(d());
  f.calibrate(0);
  f.start(0);
  f.target = d(0.1, 0.4, 0.1);
  assert.equal(f.intent(0.1).linear, 0);
});
test("scenes respect cooldown, empty candidates, speech and body permission", () => {
  const p = new ScenePolicy();
  const config = clone(DEFAULT_CONFIG);
  p.reset(0, config.idle);
  assert.equal(p.select(1, catalog, config), null);
  const onlyBody = catalog.filter((s) => s.body);
  assert.equal(
    p.select(30, onlyBody, config, { manual: true, body: false }),
    null,
  );
  assert.equal(
    p.select(31, onlyBody, config, {
      manual: true,
      body: true,
      speaking: true,
    }),
    null,
  );
  const s = p.select(40, catalog, config, { manual: true, body: false }, 0.5);
  assert.equal(s.body, false);
  assert.equal(p.eligible(s, 41, config.idle), false);
  assert.equal(p.eligible(s, 80, config.idle), true);
});
test("diagnostics cap events and decisions separately", () => {
  const d = new BoundedDiagnostics();
  for (let n = 0; n < 600; n++) {
    d.add("event", "generic", false, n);
    d.add("decision", "allowed_scene", true, n);
  }
  assert.equal(d.events.length, 500);
  assert.equal(d.decisions.length, 100);
  assert.equal(d.events[0].time, 100);
});
import { LifeEngine } from "../frontend/js/life/lifeEngine.js";
test("Life Engine uses elapsed monotonic time and never catches up background decay", (t) => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const life = new LifeEngine({ logger: () => {} });
  life.start();
  const first = life.getState().energy;
  clock = 1000;
  life.tickDrives();
  assert.ok(Math.abs(life.getState().energy - (first - 0.001)) < 1e-9);
  life.stop();
  const paused = life.getState().energy;
  clock = 300000;
  life.start();
  life.tickDrives();
  assert.equal(life.getState().energy, paused);
  life.stop();
});
test("disabled scenes and zero weights never get selected", () => {
  const p = new ScenePolicy(),
    c = clone(DEFAULT_CONFIG);
  for (const s of catalog) c.idle.scenes[s.id] = { enabled: true, weight: 0 };
  assert.equal(
    p.select(100, catalog, c, { manual: true, body: true }, 0.5),
    null,
  );
});
test("follow commands turn without reverse and expired calibration fails", () => {
  const f = new FollowPolicy();
  f.select(d());
  assert.equal(f.calibrate(0.31), false);
  f.select(d(1));
  f.calibrate(1);
  f.start(1);
  f.target = d(1.1, 0.7);
  assert.deepEqual(f.intent(1.1), { linear: 0, angular: 0.1 });
});
import { buildLocalBrainMessages } from "../backend/lib/localBrain/brainPromptBuilder.js";
test("provider text prompt contains all saved personality fields", () => {
  const messages = buildLocalBrainMessages(
    sanitizeBrainContext({ personality: DEFAULT_CONFIG.profile }),
  );
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.personality.coreTraits.curiosity, 0.75);
  assert.equal(payload.personality.pronouns, "she/her");
});
test("backend autonomous scene suggestions reject arbitrary identifiers", () => {
  const c = sanitizeBrainContext({
    reason: "proactive_scene_suggestion",
    allowedSceneIds: ["pose_happy", "raw_motor_command", "../../secret"],
  });
  assert.deepEqual(c.allowedSceneIds, ["pose_happy"]);
});
import { SharedMicrophone } from "../frontend/js/companion/audio.js";
test("shared microphone has one recorder and tap; stop ignores old frames", async (t) => {
  let captures = 0,
    nodes = 0,
    stops = 0,
    received = 0,
    lastNode;
  const previous = new Map(
    ["navigator", "AudioContext", "AudioWorkletNode"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  t.after(() => {
    for (const [k, d] of previous)
      d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k];
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          captures++;
          return {
            getTracks: () => [
              {
                stop() {
                  stops++;
                },
              },
            ],
          };
        },
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      constructor() {
        this.state = "running";
        this.audioWorklet = { addModule: async () => {} };
      }
      async resume() {}
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      async close() {
        this.state = "closed";
      }
    },
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    value: class {
      constructor() {
        nodes++;
        this.port = {};
        lastNode = this;
      }
      connect() {}
      disconnect() {}
    },
  });
  const microphone = new SharedMicrophone();
  microphone.subscribe(() => received++);
  await Promise.all([microphone.start(), microphone.start()]);
  assert.equal(captures, 1);
  assert.equal(nodes, 1);
  lastNode.port.onmessage({ data: new Float32Array(1600) });
  assert.equal(received, 1);
  microphone.stop();
  lastNode.port.onmessage({ data: new Float32Array(1600) });
  assert.equal(received, 1);
  assert.equal(stops, 1);
});
import { GeminiLiveRuntime } from "../frontend/js/gemini/geminiLiveRuntime.js";
import { CompanionRuntime } from "../frontend/js/companion/runtime.js";
function fakeLive(
  executeAction = async () => ({ executed: true, status: "completed" }),
) {
  const connections = [];
  const runtime = new GeminiLiveRuntime({
    toolExecutor: { executeAction },
    logger: () => {},
    fetchToken: async () => ({
      ok: true,
      transport: "server_relay",
      websocketUrl: "wss://example.invalid/api/gemini-live/relay",
    }),
    transportFactory: (callbacks) => {
      const connection = {
        callbacks,
        sent: [],
        readyState: 1,
        send(value) {
          this.sent.push(value);
        },
        close() {
          this.readyState = 3;
        },
      };
      connections.push(connection);
      queueMicrotask(callbacks.onOpen);
      return connection;
    },
  });
  runtime.configure({ geminiLiveEnabled: true, geminiLiveConfigured: true });
  return { runtime, connections };
}
test("old transport messages/errors/close cannot affect a stopped or replacement Live session", async () => {
  let actions = 0,
    audio = 0;
  const { runtime, connections } = fakeLive(async () => {
    actions++;
  });
  runtime.enqueueOutputAudio = () => audio++;
  await runtime.start({ captureAudio: false });
  const old = connections[0];
  await runtime.stop();
  await runtime.start({ captureAudio: false });
  old.callbacks.onError(Error("stale error"));
  old.callbacks.onClose();
  old.callbacks.onMessage(
    JSON.stringify({
      toolCall: {
        functionCalls: [
          { id: "old", name: "run_scenario", args: { name: "back_up" } },
        ],
      },
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } },
          ],
        },
      },
    }),
  );
  await new Promise(setImmediate);
  assert.equal(actions, 0);
  assert.equal(audio, 0);
  assert.equal(runtime.getStatus().connected, true);
  assert.equal(runtime.getStatus().lastError, "");
  await runtime.stop();
});
test("inflight tool completion after Stop cannot send a response to the replacement socket", async () => {
  let finish,
    started = false;
  const { runtime, connections } = fakeLive(() => {
    started = true;
    return new Promise((resolve) => (finish = resolve));
  });
  await runtime.start({ captureAudio: false });
  connections[0].callbacks.onMessage(
    JSON.stringify({
      toolCall: {
        functionCalls: [
          { id: "late", name: "run_scenario", args: { name: "back_up" } },
        ],
      },
    }),
  );
  await new Promise(setImmediate);
  assert.equal(started, true);
  await runtime.stop();
  await runtime.start({ captureAudio: false });
  finish({ executed: true, status: "completed" });
  await new Promise(setImmediate);
  assert.equal(
    connections[1].sent.some((v) => JSON.stringify(v).includes("toolResponse")),
    false,
  );
  assert.equal(runtime.pendingToolCalls.size, 0);
  await runtime.stop();
});
test("wake results require both current worker and current audio generation", () => {
  const current = {},
    old = {},
    state = { wakeWorker: current, wake: { generation: 8 } };
  const check = CompanionRuntime.prototype.isCurrentWakeMessage;
  assert.equal(check.call(state, old, { generation: 8 }), false);
  assert.equal(check.call(state, current, { generation: 7 }), false);
  assert.equal(check.call(state, current, { generation: 8 }), true);
  let terminated = 0;
  state.wakeWorker = {
    terminate() {
      terminated++;
    },
  };
  state.wakeQueue = [new Float32Array(1600)];
  state.wakeBusy = true;
  CompanionRuntime.prototype.stopWakeWorker.call(state);
  assert.equal(terminated, 1);
  assert.equal(state.wakeWorker, null);
  assert.equal(state.wakeQueue.length, 0);
});
test("backup persistence failure preserves both runtime config and old storage", async (t) => {
  const oldConfig = clone(DEFAULT_CONFIG),
    next = clone(DEFAULT_CONFIG);
  next.profile.name = "Replacement";
  const values = new Map([
    ["looi.companion.v1", JSON.stringify(oldConfig)],
    ["looi.advanced", "7"],
  ]);
  let failed = false;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        if (k === "looi.advanced" && !failed) {
          failed = true;
          throw Error("Quota exceeded");
        }
        values.set(k, v);
      },
      removeItem: (k) => values.delete(k),
    },
  });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, "localStorage", previous)
      : delete globalThis.localStorage,
  );
  let reported = false,
    patched = false;
  const state = {
    config: oldConfig,
    catalog,
    readFile: async () => ({
      size: 500,
      text: async () =>
        JSON.stringify({
          format: "looi-web-backup",
          version: 1,
          configuration: next,
          advanced: { "looi.advanced": 9 },
        }),
    }),
    backupKeys: () => ["looi.advanced"],
    personality: {
      patchProfile() {
        patched = true;
      },
    },
    error() {
      reported = true;
    },
    shell: { notice() {} },
    refreshConfigInputs() {},
  };
  await CompanionRuntime.prototype.importBackup.call(state);
  assert.equal(reported, true);
  assert.equal(patched, false);
  assert.deepEqual(state.config, oldConfig);
  assert.equal(values.get("looi.advanced"), "7");
  assert.deepEqual(JSON.parse(values.get("looi.companion.v1")), oldConfig);
});
test("message decoding begun before Stop cannot deliver delayed audio", async () => {
  let resolveText,
    audio = 0;
  const { runtime, connections } = fakeLive();
  runtime.enqueueOutputAudio = () => audio++;
  await runtime.start({ captureAudio: false });
  class DelayedBlob extends Blob {
    async text() {
      return new Promise((resolve) => (resolveText = resolve));
    }
  }
  connections[0].callbacks.onMessage(new DelayedBlob(["pending"]));
  await new Promise(setImmediate);
  await runtime.stop();
  resolveText(
    JSON.stringify({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } },
          ],
        },
      },
    }),
  );
  await new Promise(setImmediate);
  assert.equal(audio, 0);
  assert.equal(runtime.getStatus().connected, false);
});
test("slow keyword inference fails explicitly instead of silently dropping audio frames", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false, documentElement: { lang: "en" } },
  });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, "document", previous)
      : delete globalThis.document,
  );
  let terminated = 0,
    error = false;
  const wake = new WakePolicy();
  wake.wait(0);
  const state = {
    active: true,
    config: { wake: { enabled: true } },
    wake,
    wakeWorker: {
      terminate() {
        terminated++;
      },
    },
    wakeQueue: [],
    wakeBusy: true,
    error() {
      error = true;
    },
    stopWakeWorker: CompanionRuntime.prototype.stopWakeWorker,
  };
  for (let i = 0; i < 11; i++)
    CompanionRuntime.prototype.onPCM.call(state, new Float32Array(1600));
  assert.equal(error, true);
  assert.equal(wake.phase, "failed");
  assert.equal(terminated, 1);
  assert.equal(state.wakeQueue.length, 0);
});
test("old failed Live startup does not close a replacement connection", async () => {
  const { runtime } = fakeLive();
  let rejectOld;
  runtime.fetchToken = () => new Promise((_, reject) => (rejectOld = reject));
  const first = runtime.start({ captureAudio: false });
  await new Promise(setImmediate);
  await runtime.stop();
  runtime.fetchToken = async () => ({
    ok: true,
    transport: "server_relay",
    websocketUrl: "wss://example.invalid/api/gemini-live/relay",
  });
  await runtime.start({ captureAudio: false });
  rejectOld(Error("Old request failed"));
  await assert.rejects(first, /Old request/);
  assert.equal(runtime.getStatus().connected, true);
  assert.equal(runtime.getStatus().lastError, "");
  await runtime.stop();
});
test("companion Stop cancels the legacy executor and invalidates queued command tokens", async (t) => {
  const previous = new Map(
    ["document", "screen"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  t.after(() => {
    for (const [k, d] of previous)
      d ? Object.defineProperty(globalThis, k, d) : delete globalThis[k];
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: () => null, fullscreenElement: null },
  });
  Object.defineProperty(globalThis, "screen", {
    configurable: true,
    value: { orientation: { unlock() {} } },
  });
  let cancelled = 0,
    stopped = 0;
  const state = {
    session: { stop() {} },
    active: true,
    requestGeneration: 1,
    sceneGeneration: 1,
    stopWakeWorker() {},
    wake: { stop() {} },
    capture: { stop() {} },
    live: { stop() {} },
    brain: { stop() {} },
    life: { stop() {} },
    lifeEvents: { stop() {} },
    oldIdle: { stop() {} },
    queue: { executionToken: 3, clear() {} },
    follow: { clear() {} },
    followToggle: { checked: true },
    clearRemote() {},
    shell: { busy() {}, notice() {}, setRunning() {}, bringNotice() {} },
    motion: {
      async stop() {
        stopped++;
      },
    },
    updateButtons() {},
    diagnostics: { add() {} },
    async cancelLegacy(reason) {
      assert.equal(reason, "user_stop");
      cancelled++;
    },
    error(error) {
      throw error;
    },
  };
  await CompanionRuntime.prototype.stopInternal.call(state);
  assert.equal(cancelled, 1);
  assert.equal(stopped, 1);
  assert.equal(state.queue.executionToken, 4);
  assert.equal(state.active, false);
});
test("sound mute changes gain without suspending the playback clock", () => {
  const { runtime } = fakeLive();
  runtime.outputGain = { gain: { value: 1 } };
  runtime.setOutputMuted(true);
  assert.equal(runtime.outputGain.gain.value, 0);
  assert.equal(runtime.getStatus().outputMuted, true);
  runtime.setOutputMuted(false);
  assert.equal(runtime.outputGain.gain.value, 1);
});
