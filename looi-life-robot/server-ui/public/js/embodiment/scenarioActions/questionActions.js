import { clampNumber } from "../../core/runtimeUtils.js";

export async function showQuestion(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 2200);

  ctx.face?.showQuestion?.();
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
    detail: { state: "questioned" }
  };
}
