import { clampInteger, clampNumber } from "../core/runtimeUtils.js";

export function createDefaultBrainPolicy() {
  return {
    localMotionArmed: false,
    followLostTimeoutMs: 3000,
    followTargetCenterX: 0.5,
    followCenterDeadband: 0.115,
    followSteerGain: 0.9,
    maxObjectFollowSpeed: 0.036,
    followCommandDurationMs: 30,
    followCommandRefreshMs: 70,
    maxThoughtsPerMinute: 12,
    eventThoughtCooldownMs: 800,
    stopRespectCooldownMs: 8000
  };
}

export function clampBrainPolicy(policy = {}) {
  const defaults = createDefaultBrainPolicy();
  const value = isPlainObject(policy) ? policy : {};

  return {
    localMotionArmed: toBoolean(value.localMotionArmed, defaults.localMotionArmed),
    followLostTimeoutMs: clampInteger(
      value.followLostTimeoutMs,
      500,
      8000,
      defaults.followLostTimeoutMs
    ),
    followTargetCenterX: clampNumber(
      value.followTargetCenterX,
      0.25,
      0.75,
      defaults.followTargetCenterX
    ),
    followCenterDeadband: clampNumber(
      value.followCenterDeadband,
      0.005,
      0.2,
      defaults.followCenterDeadband
    ),
    followSteerGain: clampNumber(
      value.followSteerGain,
      0.05,
      2.5,
      defaults.followSteerGain
    ),
    maxObjectFollowSpeed: clampNumber(
      value.maxObjectFollowSpeed,
      0,
      0.12,
      defaults.maxObjectFollowSpeed
    ),
    followCommandDurationMs: clampInteger(
      value.followCommandDurationMs,
      0,
      600,
      defaults.followCommandDurationMs
    ),
    followCommandRefreshMs: clampInteger(
      value.followCommandRefreshMs,
      0,
      300,
      defaults.followCommandRefreshMs
    ),
    maxThoughtsPerMinute: clampInteger(
      value.maxThoughtsPerMinute,
      1,
      60,
      defaults.maxThoughtsPerMinute
    ),
    eventThoughtCooldownMs: clampInteger(
      value.eventThoughtCooldownMs,
      0,
      10000,
      defaults.eventThoughtCooldownMs
    ),
    stopRespectCooldownMs: clampInteger(
      value.stopRespectCooldownMs,
      1000,
      30000,
      defaults.stopRespectCooldownMs
    )
  };
}

function toBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
