import { canonicalObjectLabel, getObjectAliases, labelsMatch } from "./objectLabelUtils.js";

const DEFAULT_SCENARIO = {
  active: false,
  type: null,
  targetLabel: null,
  targetTrackId: null,
  state: "idle",
  startedAt: null,
  lastUpdateAt: null,
  lostSince: null,
  reason: null
};

export class VisionState {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.state = {
      detectorRunning: false,
      cameraRunning: false,
      currentCameraFacingMode: "unknown",
      tracks: [],
      visibleObjects: [],
      activeTarget: null,
      lastDetectionAt: null,
      lastObjectSeenAt: null,
      summary: "No objects detected.",
      scenario: { ...DEFAULT_SCENARIO }
    };
  }

  updateFromDetections(detectionsResult = {}, tracks = []) {
    const timestamp = detectionsResult.timestamp ?? new Date().toISOString();
    this.state.lastDetectionAt = timestamp;
    this.state.tracks = normalizeTracks(tracks);
    this.state.visibleObjects = this.state.tracks.filter((track) => track.visible);

    if (this.state.visibleObjects.length > 0) {
      this.state.lastObjectSeenAt = timestamp;
    }

    this.refreshActiveTarget();
    this.state.summary = summarizeObjects(this.state.visibleObjects);
    return this.getStatus();
  }

  setDetectorStatus(status = {}) {
    this.state.detectorRunning = Boolean(status.running);
    if (status.lastDetectionAt) {
      this.state.lastDetectionAt = new Date(status.lastDetectionAt).toISOString();
    }
  }

  setCameraStatus(status = {}) {
    this.state.cameraRunning = Boolean(status.running);
    this.state.currentCameraFacingMode = status.facingMode ?? "unknown";
  }

  setActiveTarget(target = {}) {
    const label = canonicalObjectLabel(target.label);

    if (!label) {
      return null;
    }

    const existing = target.trackId
      ? this.getTrackById(target.trackId)
      : this.findObject([label, ...(target.aliases ?? [])]);
    this.state.activeTarget = {
      label,
      aliases: getObjectAliases(label),
      trackId: target.trackId ?? existing?.trackId ?? existing?.id ?? null,
      visible: Boolean(existing?.visible),
      confidence: existing?.confidence ?? null,
      position: existing?.position ?? "unknown",
      distance: existing?.distance ?? "unknown",
      lostForMs: existing?.lostForMs ?? 0,
      lastSeenAt: existing?.lastSeenAt ?? null,
      setAt: new Date().toISOString()
    };
    this.setScenario({
      active: true,
      type: "follow_object",
      targetLabel: label,
      targetTrackId: this.state.activeTarget.trackId,
      state: existing?.visible ? "following" : "searching",
      reason: "target_set"
    });
    return this.getActiveTarget();
  }

  clearActiveTarget(reason = "clear_target") {
    this.state.activeTarget = null;
    this.setScenario({
      active: false,
      type: null,
      targetLabel: null,
      targetTrackId: null,
      state: "idle",
      lostSince: null,
      reason
    });
  }

  setScenario(partial = {}) {
    const now = new Date().toISOString();
    this.state.scenario = {
      ...this.state.scenario,
      ...partial,
      lastUpdateAt: now,
      startedAt: partial.active && !this.state.scenario.active
        ? now
        : partial.startedAt ?? this.state.scenario.startedAt
    };

    if (partial.active === false) {
      this.state.scenario = {
        ...DEFAULT_SCENARIO,
        reason: partial.reason ?? this.state.scenario.reason,
        lastUpdateAt: now
      };
    }
  }

  getVisibleObjects() {
    return this.state.visibleObjects.map(compactTrack);
  }

  getObjectSummary() {
    return this.state.summary;
  }

  getObjectMetadataForBrain() {
    const now = Date.now();
    const activeTarget = this.getActiveTarget();

    return {
      summary: this.state.summary,
      objects: this.state.tracks.slice(0, 12).map((track) => ({
        label: track.label,
        visible: Boolean(track.visible),
        confidence: round(track.confidence),
        position: track.position,
        distance: track.distance,
        trackId: track.id,
        lastSeenMs: Number.isFinite(Number(track.lastSeenAt))
          ? Math.max(0, now - Number(track.lastSeenAt))
          : null
      })),
      activeTarget: activeTarget
        ? {
            label: activeTarget.label,
            visible: Boolean(activeTarget.visible),
            position: activeTarget.position,
            distance: activeTarget.distance,
            trackId: activeTarget.trackId,
            lostForMs: activeTarget.lostForMs ?? 0
          }
        : null,
      scenario: { ...this.state.scenario },
      detectorRunning: this.state.detectorRunning,
      cameraRunning: this.state.cameraRunning,
      currentCameraFacingMode: this.state.currentCameraFacingMode,
      lastDetectionAgeMs: this.getLastDetectionAgeMs()
    };
  }

  getStatus() {
    return {
      ...this.state,
      tracks: this.state.tracks.map(compactTrack),
      visibleObjects: this.state.visibleObjects.map(compactTrack),
      activeTarget: this.getActiveTarget(),
      scenario: { ...this.state.scenario },
      lastDetectionAgeMs: this.getLastDetectionAgeMs()
    };
  }

  findObject(labelOrAliases) {
    const aliases = Array.isArray(labelOrAliases) ? labelOrAliases : [labelOrAliases];
    const normalizedAliases = aliases.map(canonicalObjectLabel).filter(Boolean);

    return this.state.tracks
      .filter((track) => normalizedAliases.some((label) => labelsMatch(label, track.label)))
      .sort(compareTrackQuality)
      .map(compactTrack)[0] ?? null;
  }

  isObjectVisible(label) {
    return Boolean(this.findObject(label)?.visible);
  }

  getActiveTarget() {
    this.refreshActiveTarget();
    return this.state.activeTarget ? { ...this.state.activeTarget } : null;
  }

  getTrackById(id) {
    return this.state.tracks.find((track) => track.id === id) ?? null;
  }

  refreshActiveTarget() {
    const target = this.state.activeTarget;

    if (!target?.label) {
      return;
    }

    const track = target.trackId
      ? this.getTrackById(target.trackId)
      : this.findObject(target.aliases ?? target.label);

    if (!track) {
      this.state.activeTarget = {
        ...target,
        visible: false,
        lostForMs: target.lostForMs ?? 0
      };
      return;
    }

    this.state.activeTarget = {
      ...target,
      trackId: track.id ?? track.trackId ?? target.trackId,
      visible: Boolean(track.visible),
      confidence: track.confidence,
      position: track.position,
      distance: track.distance,
      lostForMs: track.lostForMs ?? 0,
      lastSeenAt: track.lastSeenAt ?? target.lastSeenAt
    };
  }

  getLastDetectionAgeMs() {
    if (!this.state.lastDetectionAt) {
      return null;
    }

    const value = Date.parse(this.state.lastDetectionAt);
    return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null;
  }
}

export function summarizeObjects(objects = []) {
  const visible = objects.filter((object) => object.visible !== false);

  if (visible.length === 0) {
    return "No objects detected.";
  }

  const primary = visible.slice(0, 4).map((object) => {
    const article = /^[aeiou]/i.test(object.label) ? "an" : "a";
    return `${article} ${object.label} at ${object.position ?? "center"}, ${object.distance ?? "medium"}`;
  });

  return `I see ${joinNatural(primary)}.`;
}

function normalizeTracks(tracks = []) {
  return Array.isArray(tracks)
    ? tracks.map((track) => ({
        id: track.id ?? track.trackId,
        label: canonicalObjectLabel(track.label),
        visible: Boolean(track.visible),
        confidence: Number.isFinite(Number(track.confidence)) ? Number(track.confidence) : 0,
        centerX: Number(track.centerX ?? 0.5),
        centerY: Number(track.centerY ?? 0.5),
        areaRatio: Number(track.areaRatio ?? 0),
        position: track.position ?? "center",
        verticalPosition: track.verticalPosition ?? "middle",
        distance: track.distance ?? "medium",
        bbox: track.bbox && typeof track.bbox === "object" ? { ...track.bbox } : {},
        firstSeenAt: track.firstSeenAt ?? null,
        lastSeenAt: track.lastSeenAt ?? null,
        lostAt: track.lostAt ?? null,
        lostForMs: Number(track.lostForMs ?? 0),
        seenCount: Number(track.seenCount ?? 0),
        source: track.source ?? "roboflow_webrtc"
      })).filter((track) => track.id && track.label)
    : [];
}

function compactTrack(track = {}) {
  return {
    ...track,
    trackId: track.id ?? track.trackId,
    bbox: track.bbox ? { ...track.bbox } : {}
  };
}

function compareTrackQuality(a, b) {
  if (a.visible !== b.visible) {
    return a.visible ? -1 : 1;
  }

  if (a.confidence !== b.confidence) {
    return b.confidence - a.confidence;
  }

  return Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0);
}

function joinNatural(parts) {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function round(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}
