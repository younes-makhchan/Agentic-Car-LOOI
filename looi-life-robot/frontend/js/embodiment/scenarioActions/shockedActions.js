import { clampNumber } from "../../core/runtimeUtils.js";

export async function showShocked(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 1700);

  ctx.face?.showShocked?.();
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
    detail: { state: "shocked" }
  };
}
