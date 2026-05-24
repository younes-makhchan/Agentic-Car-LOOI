import { clampNumber } from "../../core/runtimeUtils.js";

export async function photoPoseAndCapture(ctx, args = {}) {
  if (ctx.allowCamera !== true) {
    return {
      ok: false,
      type: "action",
      reason: "camera_not_allowed"
    };
  }

  const cameraChoice = normalizeCameraChoice(args.camera);
  const useBackCamera = cameraChoice === "back";
  const cameraInput = useBackCamera ? ctx.backCameraProbe : ctx.cameraInput;
  const cameraSource = useBackCamera ? "back" : "front";

  if (!cameraInput?.captureSnapshot) {
    return {
      ok: false,
      type: "action",
      reason: useBackCamera ? "back_camera_unavailable" : "camera_input_unavailable"
    };
  }

  const maxWidth = clampNumber(args.maxWidth, 160, 640, 640);
  const quality = clampNumber(args.quality, 0.3, 0.8, 0.72);
  const captureDelayMs = clampNumber(args.captureDelayMs, 200, 3000, 1550);
  const previewDismissMs = clampNumber(args.previewDismissMs, 1000, 15000, 5000);
  const facingMode = useBackCamera ? "environment" : normalizeFacingMode(args.facingMode);
  const targetLabel = String(args.targetLabel ?? ctx.runtimeContext?.vision?.activeTarget?.label ?? "").trim();

  try {
    ctx.log?.(`take_picture camera=${cameraSource}`);

    const status = getCaptureStatus(cameraInput, useBackCamera);
    if (!status.running) {
      const startResult = await startCaptureSource(cameraInput, {
        useBackCamera,
        facingMode,
        targetLabel
      });
      if (!startResult?.ok) {
        return {
          ok: false,
          type: "action",
          reason: startResult?.error ?? (useBackCamera ? "back_camera_start_failed" : "camera_start_failed"),
          detail: {
            cameraSource,
            cameraStatus: sanitizeCameraStatus(getCaptureStatusFromStartResult(startResult, useBackCamera))
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

    const snapshotResult = await captureFromSource(cameraInput, {
      useBackCamera,
      includeDataUrl: true,
      maxWidth,
      quality,
      targetLabel
    });

    if (!snapshotResult?.ok) {
      ctx.face?.dismissPhoto?.();
      return {
        ok: false,
        type: "action",
        reason: snapshotResult?.error ?? "snapshot_capture_failed",
        detail: {
          cameraSource,
          cameraStatus: sanitizeCameraStatus(getCaptureStatusFromStartResult(snapshotResult, useBackCamera))
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
        cameraSource,
        cameraStatus: sanitizeCameraStatus(getCaptureStatusFromStartResult(snapshotResult, useBackCamera)),
        snapshot: sanitizeSnapshotMetadata(snapshotResult.snapshot)
      }
    };
  } finally {
    if (useBackCamera) {
      await cameraInput.stop?.("capture_complete")?.catch?.((error) => {
        ctx.log?.(`back camera probe stop failed after capture: ${error.message}`, "warn");
      });
    }
  }
}

function normalizeFacingMode(value) {
  return value === "environment" ? "environment" : "user";
}

function normalizeCameraChoice(value) {
  return value === "back" ? "back" : "front";
}

function getCaptureStatus(cameraInput, useBackCamera) {
  if (useBackCamera) {
    return cameraInput.getStatus?.().cameraStatus ?? cameraInput.getCameraStatus?.() ?? {};
  }

  return cameraInput.getCameraStatus?.() ?? {};
}

function getCaptureStatusFromStartResult(result = {}, useBackCamera) {
  if (useBackCamera) {
    return result.status?.cameraStatus ?? result.status ?? {};
  }

  return result.status ?? {};
}

function startCaptureSource(cameraInput, { useBackCamera, facingMode, targetLabel } = {}) {
  if (useBackCamera) {
    return cameraInput.start?.({
      targetLabel,
      reason: "take_picture"
    });
  }

  return cameraInput.startCamera?.({ facingMode });
}

function captureFromSource(cameraInput, {
  useBackCamera,
  includeDataUrl,
  maxWidth,
  quality,
  targetLabel
} = {}) {
  if (useBackCamera) {
    return cameraInput.captureSnapshot({
      includeDataUrl,
      maxWidth,
      quality,
      targetLabel,
      reason: "take_picture"
    });
  }

  return cameraInput.captureSnapshot({
    includeDataUrl,
    maxWidth,
    quality
  });
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
    source: snapshot.source ?? null,
    note: snapshot.note ?? "",
    hasDataUrl: typeof snapshot.dataUrl === "string" && snapshot.dataUrl.startsWith("data:image/")
  };
}
