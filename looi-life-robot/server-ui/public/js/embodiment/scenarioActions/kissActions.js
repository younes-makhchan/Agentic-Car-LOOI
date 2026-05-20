export async function showKiss(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 5000, 2600);
  const started = ctx.face?.showKiss?.();

  if (started === false) {
    return {
      ok: true,
      type: "action",
      detail: { state: "skipped", reason: "speaking" }
    };
  }

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
    detail: { state: "kissed" }
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
