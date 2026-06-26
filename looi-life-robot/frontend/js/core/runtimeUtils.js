export function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

export function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function waitMs(ms, { maxMs = null } = {}) {
  const max = maxMs === null || maxMs === undefined
    ? Number.POSITIVE_INFINITY
    : Number(maxMs);
  const delay = clampNumber(ms, 0, max, 0);
  return delay > 0 ? new Promise((resolve) => globalThis.setTimeout(resolve, delay)) : Promise.resolve();
}

export function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

export function stopCommandQueueMotion(commandQueue, reason) {
  if (commandQueue?.stopMotion) {
    return commandQueue.stopMotion(reason);
  }

  return commandQueue?.cancelMotion?.(reason);
}
