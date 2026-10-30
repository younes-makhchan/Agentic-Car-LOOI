export class SessionCoordinator {
  constructor() {
    this.generation = 0;
    this.phase = "idle";
  }
  begin() {
    if (this.phase !== "idle") return null;
    this.phase = "starting";
    return ++this.generation;
  }
  valid(token) {
    return (
      token === this.generation &&
      !["idle", "stopping", "suspended"].includes(this.phase)
    );
  }
  active(token) {
    if (this.valid(token)) this.phase = "active";
  }
  suspend() {
    this.generation++;
    this.phase = "suspended";
  }
  stop() {
    this.generation++;
    this.phase = "idle";
  }
}
export class MotionAuthority {
  constructor({ send, ready }) {
    this.send = send;
    this.ready = ready;
    this.owner = null;
    this.generation = 0;
    this.armed = false;
    this.barrier = Promise.resolve();
  }
  async stop() {
    const epoch = ++this.generation;
    this.owner = null;
    this.armed = false;
    const task = this.barrier
      .catch(() => {})
      .then(async () => {
        if (this.ready()) await this.send({ type: "stop" });
      });
    this.barrier = task;
    await task;
    return epoch;
  }
  async acquire(source) {
    const ranks = { idle: 0, follow: 1, explicit: 2, test: 3, manual: 4 };
    if (!this.ready()) throw Error("Robot not connected / 机器人未连接");
    if (this.owner && ranks[this.owner] > ranks[source])
      throw Error("Motion busy / 运动控制忙");
    const epoch = ++this.generation;
    this.owner = null;
    this.armed = false;
    const task = this.barrier
      .catch(() => {})
      .then(() => this.send({ type: "stop" }));
    this.barrier = task;
    await task;
    if (epoch !== this.generation) throw Error("Cancelled / 已取消");
    this.owner = source;
    this.armed = true;
    return { source, epoch };
  }
  valid(lease) {
    return (
      !!lease &&
      this.armed &&
      lease.epoch === this.generation &&
      lease.source === this.owner
    );
  }
  async motion(payload, lease) {
    if (!this.valid(lease))
      throw Error("Expired motion lease / 运动许可已失效");
    const c = {
      type: "motion",
      linear: finite(payload.linear, -0.4, 0.4),
      angular: finite(payload.angular, -0.4, 0.4),
      duration_ms: finite(payload.duration_ms ?? 150, 50, 1000),
      ramp_ms: finite(payload.ramp_ms ?? 0, 0, 500),
    };
    c.ramp_ms = Math.min(c.ramp_ms, c.duration_ms / 2);
    await this.send(c);
    if (!this.valid(lease)) throw Error("Cancelled / 已取消");
  }
  release(lease) {
    if (this.valid(lease)) {
      this.owner = null;
      this.armed = false;
      this.generation++;
    }
  }
}
function finite(v, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw Error("Invalid motion");
  return Math.max(min, Math.min(max, v));
}
export class WakePolicy {
  constructor() {
    this.phase = "stopped";
    this.generation = 0;
    this.buffer = new Uint8Array();
    this.overflow = false;
    this.lastActivity = 0;
    this.lastWake = -Infinity;
  }
  wait(now) {
    this.generation++;
    this.phase = "waiting";
    this.buffer = new Uint8Array();
    this.overflow = false;
    this.lastActivity = now;
  }
  wake(now) {
    if (this.phase !== "waiting" || now - this.lastWake < 2) return null;
    this.phase = "connecting";
    this.lastWake = now;
    this.lastActivity = now;
    return this.generation;
  }
  append(pcm, now, voice = false) {
    const bytes = new Uint8Array(
      pcm.buffer ?? pcm,
      pcm.byteOffset ?? 0,
      pcm.byteLength,
    );
    if (voice) this.lastActivity = now;
    if (this.phase === "conversation") return bytes;
    if (!["waiting", "connecting"].includes(this.phase) || this.overflow)
      return null;
    if (
      this.phase === "connecting" &&
      this.buffer.length + bytes.length > 256000
    ) {
      this.buffer = new Uint8Array();
      this.overflow = true;
      return null;
    }
    const next = new Uint8Array(this.buffer.length + bytes.length);
    next.set(this.buffer);
    next.set(bytes, this.buffer.length);
    this.buffer = this.phase === "waiting" ? next.slice(-32000) : next;
    return null;
  }
  connected(token, now) {
    if (token !== this.generation || this.phase !== "connecting") return null;
    this.phase = "conversation";
    this.lastActivity = now;
    const b = this.buffer;
    this.buffer = new Uint8Array();
    return b;
  }
  timedOut(now, timeout, busy) {
    return (
      this.phase === "conversation" &&
      !busy &&
      now - this.lastActivity >= timeout
    );
  }
  stop(phase = "stopped") {
    this.generation++;
    this.phase = phase;
    this.buffer = new Uint8Array();
    this.overflow = false;
  }
}
export class FollowPolicy {
  constructor() {
    this.clear();
  }
  clear() {
    this.target = null;
    this.reference = null;
    this.enabled = false;
    this.advancing = false;
  }
  select(d) {
    this.clear();
    this.target = d;
  }
  calibrate(now) {
    if (!this.target || now - this.target.time > 0.3) return false;
    this.reference = this.target.box.w * this.target.box.h;
    return this.reference > 0;
  }
  start(now) {
    this.enabled =
      !!this.reference && !!this.target && now - this.target.time <= 0.3;
    return this.enabled;
  }
  update(values, now) {
    if (!this.target) return;
    const previous = this.target;
    const candidates = values
      .filter((d) => d.label === previous.label && now - d.time <= 0.3)
      .map((d) => ({ d, iou: iou(d.box, previous.box) }))
      .filter((v) => v.iou > 0.15)
      .sort((a, b) => b.iou - a.iou);
    if (
      !candidates[0] ||
      (candidates[1] && candidates[0].iou - candidates[1].iou < 0.15)
    ) {
      this.clear();
      return;
    }
    this.target = { ...candidates[0].d, id: previous.id };
  }
  intent(now) {
    if (!this.enabled || !this.target || now - this.target.time > 0.3) {
      this.enabled = false;
      return { linear: 0, angular: 0 };
    }
    const d = this.target,
      error = d.box.x + d.box.w / 2 - 0.5;
    if (Math.abs(error) > 0.14) {
      this.advancing = false;
      return { linear: 0, angular: error < 0 ? -0.1 : 0.1 };
    }
    const ratio = (d.box.w * d.box.h) / this.reference;
    if (ratio >= 0.95) this.advancing = false;
    else if (ratio < 0.8) this.advancing = true;
    return { linear: this.advancing ? 0.1 : 0, angular: 0 };
  }
}
function iou(a, b) {
  const area =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return area / Math.max(0.00001, a.w * a.h + b.w * b.h - area);
}
export class ScenePolicy {
  constructor() {
    this.reset(0, { first: { minimum: 8, maximum: 15 } });
  }
  reset(now, settings) {
    this.lastInteraction = now;
    this.next = now + (settings.first.minimum + settings.first.maximum) / 2;
    this.executions = new Map();
    this.last = null;
    this.lastAt = -Infinity;
  }
  interact(now) {
    this.lastInteraction = now;
  }
  eligible(
    s,
    now,
    settings,
    { body = false, speaking = false, sleeping = false } = {},
  ) {
    const o = settings.scenes[s.id] ?? {};
    return (
      o.enabled !== false &&
      (o.weight ?? 1) > 0 &&
      (!s.body || (body && !speaking && !sleeping)) &&
      (!o.availability ||
        o.availability === "always" ||
        (o.availability === "awake" && !sleeping) ||
        (o.availability === "sleeping" && sleeping)) &&
      now - (this.executions.get(s.id) ?? -Infinity) >= (o.cooldown ?? 30) &&
      (this.last !== s.id || now - this.lastAt >= settings.repeatGap)
    );
  }
  admit(s, now) {
    this.last = s.id;
    this.lastAt = now;
    this.executions.set(s.id, now);
  }
  select(now, catalog, config, flags = {}, sample = Math.random()) {
    if ((!flags.manual && now < this.next) || now - this.lastInteraction < 3)
      return null;
    const range = flags.conversation
      ? config.idle.conversation
      : config.idle.silent;
    this.next =
      now +
      (range.minimum + (range.maximum - range.minimum) * sample) *
        config.behavior.idleGapMultiplier *
        Math.max(
          0.25,
          (30 - 20 * config.profile.behaviorStyle.idleActivity) / 20,
        );
    const candidates = catalog.filter((s) =>
      this.eligible(s, now, config.idle, flags),
    );
    const weight = (s) =>
      (config.idle.scenes[s.id]?.weight ?? 1) *
      (s.pose === "pose_" + flags.mood ? 2 : 1);
    let n =
      candidates.reduce((v, s) => v + weight(s), 0) *
      Math.min(0.999999, sample);
    const s = candidates.find((s) => (n -= weight(s)) < 0);
    if (s) this.admit(s, now);
    return s ?? null;
  }
}
export class BoundedDiagnostics {
  constructor() {
    this.events = [];
    this.decisions = [];
  }
  add(kind, reason = "", decision = false, now = performance.now() / 1000) {
    const list = decision ? this.decisions : this.events;
    list.push({ time: now, kind, reason: String(reason).slice(0, 160) });
    if (list.length > (decision ? 100 : 500)) list.shift();
  }
  clear() {
    this.events = [];
    this.decisions = [];
  }
  export(state) {
    return JSON.stringify(
      {
        schemaVersion: 1,
        state,
        events: this.events,
        decisions: this.decisions,
      },
      null,
      2,
    );
  }
}
