export async function showTellMeAboutYourself(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 3000, 1400);

  ctx.face?.showTellMeAboutYourself?.();
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
    detail: { state: "telling_open" }
  };
}

export async function finishTellMeAboutYourself(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 3000, 1200);

  ctx.face?.finishTellMeAboutYourself?.();
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
    detail: { state: "telling_finished" }
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
