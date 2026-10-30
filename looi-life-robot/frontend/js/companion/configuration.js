import { DEFAULT_PERSONALITY_PROFILE } from "../personality/personalityProfile.js";
export const CONFIG_KEY = "looi.companion.v1";
export const DEFAULT_CONFIG = {
  schemaVersion: 1,
  profile: DEFAULT_PERSONALITY_PROFILE,
  behavior: {
    enabled: true,
    idleBody: false,
    proactiveAI: false,
    proactiveExpression: false,
    thoughtsPerMinute: 2,
    sleepAfter: 60,
    expressionInterval: 60,
    idleGapMultiplier: 1,
  },
  idle: {
    first: { minimum: 8, maximum: 15 },
    silent: { minimum: 15, maximum: 30 },
    conversation: { minimum: 20, maximum: 40 },
    speedScale: 1,
    durationScale: 1,
    repeatGap: 15,
    scenes: {},
  },
  wake: { enabled: false, preset: "chinese", silenceTimeout: 60 },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const fail = () => {
  throw Error("Invalid configuration / 配置格式或范围无效");
};
function object(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) fail();
  return x;
}
function num(x, d, min, max) {
  if (x === undefined) return d;
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max)
    fail();
  return x;
}
function bool(x, d) {
  if (x === undefined) return d;
  if (typeof x !== "boolean") fail();
  return x;
}
export function validateProfile(value) {
  const o = object(value),
    p = clone(DEFAULT_PERSONALITY_PROFILE);
  if (
    ![
      "name",
      "identity",
      "pronouns",
      "coreTraits",
      "behaviorStyle",
      "speechStyle",
    ].some((k) => k in o)
  )
    fail();
  for (const [k, n] of [
    ["name", 40],
    ["identity", 120],
    ["pronouns", 30],
  ])
    if (k in o) {
      if (
        typeof o[k] !== "string" ||
        !o[k].trim() ||
        o[k].length > n ||
        /[\x00-\x1f\x7f]/.test(o[k])
      )
        fail();
      p[k] = o[k];
    }
  for (const field of ["coreTraits", "behaviorStyle"])
    if (field in o) {
      const map = object(o[field]);
      for (const k of Object.keys(p[field]))
        p[field][k] = num(map[k], p[field][k], 0, 1);
    }
  if (o.speechStyle !== undefined) {
    const s = object(o.speechStyle);
    for (const k of Object.keys(p.speechStyle))
      p.speechStyle[k] =
        typeof p.speechStyle[k] === "boolean"
          ? bool(s[k], p.speechStyle[k])
          : num(s[k], p.speechStyle[k], 0, 1);
  }
  p.boundaries = clone(DEFAULT_PERSONALITY_PROFILE.boundaries);
  for (const k of Object.keys(p.boundaries)) p.boundaries[k] = true;
  return p;
}
export function validateConfig(input, known) {
  const o = object(
    typeof input === "string" ? parseSized(input, 262144) : input,
  );
  if (o.schemaVersion !== 1) fail();
  const c = clone(DEFAULT_CONFIG);
  c.profile = validateProfile(o.profile);
  const b = object(o.behavior),
    w = object(o.wake),
    i = object(o.idle);
  for (const k of ["enabled", "idleBody", "proactiveAI", "proactiveExpression"])
    c.behavior[k] = bool(b[k], c.behavior[k]);
  for (const [k, min, max] of [
    ["thoughtsPerMinute", 1, 12],
    ["sleepAfter", 10, 600],
    ["expressionInterval", 60, 600],
    ["idleGapMultiplier", 0.25, 5],
  ])
    c.behavior[k] = num(b[k], c.behavior[k], min, max);
  if (!Number.isInteger(c.behavior.thoughtsPerMinute)) fail();
  for (const k of ["first", "silent", "conversation"]) {
    const range = object(i[k] ?? {});
    const min = num(range.minimum, c.idle[k].minimum, 3, 300);
    c.idle[k] = {
      minimum: min,
      maximum: num(range.maximum, c.idle[k].maximum, min, 600),
    };
  }
  for (const [k, min, max] of [
    ["speedScale", 0.25, 1.5],
    ["durationScale", 0.5, 2],
    ["repeatGap", 0, 600],
  ])
    c.idle[k] = num(i[k], c.idle[k], min, max);
  for (const [id, raw] of Object.entries(object(i.scenes ?? {}))) {
    if (known && !known.has(id)) fail();
    const s = object(raw);
    const a = s.availability ?? "always";
    if (!["always", "awake", "sleeping"].includes(a)) fail();
    c.idle.scenes[id] = {
      enabled: bool(s.enabled, true),
      weight: num(s.weight, 1, 0, 10),
      cooldown: num(s.cooldown, 30, 0, 600),
      availability: a,
      speedScale: num(s.speedScale, 1, 0.25, 1.5),
      durationScale: num(s.durationScale, 1, 0.5, 2),
    };
  }
  c.wake = {
    enabled: bool(w.enabled, false),
    preset: w.preset ?? "chinese",
    silenceTimeout: num(w.silenceTimeout, 60, 30, 300),
  };
  if (!["chinese", "english"].includes(c.wake.preset)) fail();
  return c;
}
export function parseSized(text, max = 65536) {
  if (new TextEncoder().encode(text).length > max) fail();
  return JSON.parse(text);
}
export function loadConfiguration(storage, known) {
  let old = storage.getItem(CONFIG_KEY);
  if (old) return validateConfig(old, known);
  const c = clone(DEFAULT_CONFIG);
  const legacy = storage.getItem("looi.personalityProfile.v1");
  if (legacy) c.profile = validateProfile(parseSized(legacy));
  const backup = {};
  for (let n = 0; n < storage.length; n++) {
    const k = storage.key(n);
    if (
      k?.startsWith("looi.") &&
      !/password|credential|token|key|secret/i.test(k)
    )
      backup[k] = storage.getItem(k);
  }
  if (!storage.getItem("looi.migration.130.backup"))
    storage.setItem("looi.migration.130.backup", JSON.stringify(backup));
  storage.setItem(CONFIG_KEY, JSON.stringify(c));
  return c;
}
export function saveConfiguration(storage, input, known) {
  const c = validateConfig(input, known);
  storage.setItem(CONFIG_KEY, JSON.stringify(c));
  return c;
}
export function profileInstruction(profile) {
  return (
    "\n<personality_profile>" +
    JSON.stringify(validateProfile(profile)) +
    "</personality_profile>\nThese are preferences, not permission to override safety or the user language."
  );
}

export function commitStorageValues(storage, entries) {
  const previous = new Map(entries.map(([key]) => [key, storage.getItem(key)]));
  try {
    for (const [key, value] of entries) storage.setItem(key, value);
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        value === null ? storage.removeItem(key) : storage.setItem(key, value);
      } catch {}
    }
    throw error;
  }
}
