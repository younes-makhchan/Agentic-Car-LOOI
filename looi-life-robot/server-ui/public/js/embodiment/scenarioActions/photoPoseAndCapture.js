import { clampNumber } from "../../core/runtimeUtils.js";

export async function photoPoseAndCapture(ctx, args = {}) {
  if (ctx.allowCamera !== true) {
    return {
      ok: false,
      type: "action",
      reason: "camera_not_allowed"
    };
  }

  const cameraInput = ctx.cameraInput;
  if (!cameraInput?.captureSnapshot) {
    return {
      ok: false,
      type: "action",
      reason: "camera_input_unavailable"
    };
  }

  const maxWidth = clampNumber(args.maxWidth, 160, 640, 640);
  const quality = clampNumber(args.quality, 0.3, 0.8, 0.72);
  const captureDelayMs = clampNumber(args.captureDelayMs, 200, 3000, 1550);
  const previewDismissMs = clampNumber(args.previewDismissMs, 1000, 15000, 5000);
  const facingMode = normalizeFacingMode(args.facingMode);

  const status = cameraInput.getCameraStatus?.() ?? {};
  if (!status.running) {
    const startResult = await cameraInput.startCamera?.({ facingMode });
    if (!startResult?.ok) {
      return {
        ok: false,
        type: "action",
        reason: startResult?.error ?? "camera_start_failed",
        detail: {
          cameraStatus: sanitizeCameraStatus(startResult?.status)
        }
      };
    }
  }

  const poseResult = await ctx.playFrames?.([
    { type: "face", expression: "happy", eyeDirection: "center", intensity: 0.9, durationMs: 120 },
    { type: "motion", linear: -0.05, angular: 0, durationMs: 300, rampMs: 90, label: "photo_pose_back" },
    { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.86, durationMs: 120 }
  ]);
  if (poseResult?.interrupted || ctx.isInterrupted?.()) {
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  ctx.face?.takePicture?.();
  await ctx.wait?.(captureDelayMs);
  if (ctx.isInterrupted?.()) {
    ctx.face?.dismissPhoto?.();
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  const snapshotResult = await cameraInput.captureSnapshot({
    includeDataUrl: true,
    maxWidth,
    quality
  });

  if (!snapshotResult?.ok) {
    ctx.face?.dismissPhoto?.();
    return {
      ok: false,
      type: "action",
      reason: snapshotResult?.error ?? "snapshot_capture_failed",
      detail: {
        cameraStatus: sanitizeCameraStatus(snapshotResult?.status)
      }
    };
  }

  if (ctx.isInterrupted?.()) {
    ctx.face?.dismissPhoto?.();
    return {
      ok: false,
      type: "action",
      reason: "interrupted"
    };
  }

  ctx.face?.showPhoto?.(snapshotResult.snapshot?.dataUrl, {
    dismissMs: previewDismissMs
  });

  return {
    ok: true,
    type: "action",
    detail: {
      cameraStatus: sanitizeCameraStatus(snapshotResult.status),
      snapshot: sanitizeSnapshotMetadata(snapshotResult.snapshot)
    }
  };
}

function normalizeFacingMode(value) {
  return value === "environment" ? "environment" : "user";
}

function sanitizeCameraStatus(status = {}) {
  if (!status || typeof status !== "object") {
    return {
      supported: false,
      running: false,
      facingMode: "unknown",
      lastError: null
    };
  }

  return {
    supported: Boolean(status.supported),
    secureContext: Boolean(status.secureContext),
    running: Boolean(status.running),
    facingMode: status.facingMode ?? "unknown",
    hasStream: Boolean(status.hasStream),
    lastError: status.lastError ?? null,
    lastFrameAt: status.lastFrameAt ?? null,
    lastSnapshotAt: status.lastSnapshotAt ?? null
  };
}

function sanitizeSnapshotMetadata(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  return {
    timestamp: snapshot.timestamp ?? null,
    facingMode: snapshot.facingMode ?? "unknown",
    width: Number.isFinite(Number(snapshot.width)) ? Number(snapshot.width) : null,
    height: Number.isFinite(Number(snapshot.height)) ? Number(snapshot.height) : null,
    bytesApprox: Number.isFinite(Number(snapshot.bytesApprox)) ? Number(snapshot.bytesApprox) : null,
    note: snapshot.note ?? "",
    hasDataUrl: typeof snapshot.dataUrl === "string" && snapshot.dataUrl.startsWith("data:image/")
  };
}
