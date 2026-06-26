import { clampNumber } from "../../core/runtimeUtils.js";

export async function showLoving(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 5000, 2400);

  ctx.face?.showLoving?.();
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
    detail: { state: "loving" }
  };
}
