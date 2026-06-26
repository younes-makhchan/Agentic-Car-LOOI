import { clampNumber } from "../../core/runtimeUtils.js";

export async function showAngry(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 1800);

  ctx.face?.showAngry?.();
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
    detail: { state: "angry" }
  };
}
