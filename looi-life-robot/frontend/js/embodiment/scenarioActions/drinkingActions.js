import { clampNumber } from "../../core/runtimeUtils.js";

export async function openDrink(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 1600);

  ctx.face?.openDrink?.();
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
    detail: { state: "drinking" }
  };
}

export async function finishDrink(ctx, args = {}) {
  const durationMs = clampNumber(args.durationMs, 300, 4000, 1800);

  if (ctx.face?.isDrinkingActive?.() === false) {
    return {
      ok: true,
      type: "action",
      detail: { state: "idle", alreadyIdle: true }
    };
  }

  ctx.face?.finishDrink?.();
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
