export async function takeBite(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 400, 5000, 3200);

  ctx.face?.takeBite?.();
  await ctx.wait?.(durationMs);

  if (ctx.isInterrupted?.()) {
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  return {
    ok: true,
    type: "action",
    detail: { state: "bitten" }
  };
}

export async function finishBurger(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 2200);

  if (ctx.face?.isEatingActive?.() === false) {
    return {
      ok: true,
      type: "action",
      detail: { state: "idle", alreadyIdle: true }
    };
  }

  ctx.face?.finishBurger?.();
  await ctx.wait?.(durationMs);

  if (ctx.isInterrupted?.()) {
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  return {
    ok: true,
    type: "action",
    detail: { state: "idle" }
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
