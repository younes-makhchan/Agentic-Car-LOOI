import { findMentionedObjectLabels as findLabels, canonicalObjectLabel } from "./objectLabelUtils.js";
import { summarizeObjects } from "./visionState.js";

export function buildVisionContext({ visionState, cameraInput, objectTracker } = {}) {
  const metadata = visionState?.getObjectMetadataForBrain?.() ?? {
    summary: "No objects detected.",
    objects: [],
    activeTarget: null
  };
  const cameraStatus = cameraInput?.getCameraStatus?.() ?? {};
  const trackerStatus = objectTracker?.getStatus?.() ?? {};

  return {
    summary: metadata.summary ?? summarizeVisibleObjects(metadata.objects),
    objects: Array.isArray(metadata.objects) ? metadata.objects.map(compactObject) : [],
    activeTarget: metadata.activeTarget ? compactActiveTarget(metadata.activeTarget) : null,
    scenario: metadata.scenario ?? null,
    detectorRunning: Boolean(metadata.detectorRunning),
    cameraRunning: Boolean(metadata.cameraRunning ?? cameraStatus.running),
    currentCameraFacingMode: metadata.currentCameraFacingMode ?? cameraStatus.facingMode ?? "unknown",
    lastDetectionAgeMs: finiteOrNull(metadata.lastDetectionAgeMs),
    tracker: {
      trackCount: finiteOrNull(trackerStatus.trackCount),
      visibleCount: finiteOrNull(trackerStatus.visibleCount)
    }
  };
}

export function summarizeVisibleObjects(objects = []) {
  return summarizeObjects(
    objects.map((object) => ({
      ...object,
      visible: object.visible !== false
    }))
  );
}

export function findMentionedObjectLabels(text, knownLabels = []) {
  return findLabels(text, knownLabels).map(canonicalObjectLabel).filter(Boolean);
}

function compactObject(object = {}) {
  return {
    label: canonicalObjectLabel(object.label),
    visible: Boolean(object.visible),
    confidence: finiteOrNull(object.confidence),
    position: object.position ?? "unknown",
    distance: object.distance ?? "unknown",
    trackId: object.trackId ?? object.id ?? null,
    lastSeenMs: finiteOrNull(object.lastSeenMs)
  };
}

function compactActiveTarget(target = {}) {
  return {
    label: canonicalObjectLabel(target.label),
    visible: Boolean(target.visible),
    position: target.position ?? "unknown",
    distance: target.distance ?? "unknown",
    trackId: target.trackId ?? null,
    lostForMs: finiteOrNull(target.lostForMs)
  };
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
