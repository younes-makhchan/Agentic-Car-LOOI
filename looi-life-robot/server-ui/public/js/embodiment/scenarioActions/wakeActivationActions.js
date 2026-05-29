import { clampNumber } from "../../core/runtimeUtils.js";

export async function showWakeActivation(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 1900);

  const started = ctx.face?.showWakeActivation?.();
  await ctx.wait?.(durationMs);

  if (ctx.isInterrupted?.()) {
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  return {
    ok: started !== false,
    type: "action",
    detail: { state: "wake_activation" }
  };
}
