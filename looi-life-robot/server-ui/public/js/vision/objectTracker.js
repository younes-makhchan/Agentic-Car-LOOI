import { canonicalObjectLabel, getObjectAliases } from "./objectLabelUtils.js";

const LOST_PRUNE_MS = 10000;

export class ObjectTracker {
  constructor({
    logger,
    maxLostMs = 2000,
    matchDistanceThreshold = 0.25,
    smoothing = 0.6
  } = {}) {
    this.logger = logger;
    this.maxLostMs = clampNumber(maxLostMs, 500, 10000, 2000);
    this.matchDistanceThreshold = clampNumber(matchDistanceThreshold, 0.05, 1, 0.25);
    this.smoothing = clampNumber(smoothing, 0, 0.95, 0.6);
    this.tracks = [];
    this.nextTrackId = 1;
    this.lastUpdateAt = null;
  }

  update(detectionsResult = {}) {
    const now = parseTimestamp(detectionsResult.timestamp) ?? Date.now();
    const detections = Array.isArray(detectionsResult.detections)
      ? detectionsResult.detections.map(normalizeDetection).filter(Boolean)
      : [];
    const matchedTrackIds = new Set();

    detections.forEach((detection) => {
      const match = this.findNearestTrack(detection, matchedTrackIds);

      if (match) {
        this.updateTrack(match, detection, now);
        matchedTrackIds.add(match.id);
      } else {
        const track = this.createTrack(detection, now);
        this.tracks.push(track);
        matchedTrackIds.add(track.id);
      }
    });

    this.tracks.forEach((track) => {
      if (!matchedTrackIds.has(track.id)) {
        this.updateLostTrack(track, now);
      }
    });

    this.tracks = this.tracks.filter((track) => now - Number(track.lastSeenAt || now) <= LOST_PRUNE_MS);
    this.lastUpdateAt = now;
    return this.getTracks();
  }

  getTracks() {
    const now = Date.now();
    return this.tracks.map((track) => snapshotTrack(track, now));
  }

  getVisibleTracks() {
    return this.getTracks().filter((track) => track.visible);
  }

  getTrackById(id) {
    if (!id) {
      return null;
    }

    return this.getTracks().find((track) => track.id === id) ?? null;
  }

  findBestTrackByLabel(label) {
    const canonical = canonicalObjectLabel(label);

    if (!canonical) {
      return null;
    }

    return this.findBestTrackByAliases(getObjectAliases(canonical));
  }

  findBestTrackByAliases(labels = []) {
    const aliases = new Set(labels.flatMap((label) => getObjectAliases(label)));
    const candidates = this.getTracks()
      .filter((track) => aliases.has(canonicalObjectLabel(track.label)))
      .sort(compareTrackQuality);

    return candidates[0] ?? null;
  }

  markAllLost(now = Date.now()) {
    this.tracks.forEach((track) => this.updateLostTrack(track, now, true));
    return this.getTracks();
  }

  clear() {
    this.tracks = [];
    this.lastUpdateAt = null;
  }

  getStatus() {
    return {
      trackCount: this.tracks.length,
      visibleCount: this.getVisibleTracks().length,
      maxLostMs: this.maxLostMs,
      matchDistanceThreshold: this.matchDistanceThreshold,
      smoothing: this.smoothing,
      lastUpdateAt: this.lastUpdateAt
    };
  }

  findNearestTrack(detection, usedTrackIds) {
    let best = null;
    let bestDistance = Infinity;

    this.tracks.forEach((track) => {
      if (usedTrackIds.has(track.id) || canonicalObjectLabel(track.label) !== detection.label) {
        return;
      }

      const distance = centerDistance(track, detection);

      if (distance <= this.matchDistanceThreshold && distance < bestDistance) {
        best = track;
        bestDistance = distance;
      }
    });

    return best;
  }

  createTrack(detection, now) {
    return {
      id: `track_${this.nextTrackId++}`,
      label: detection.label,
      visible: true,
      confidence: detection.confidence,
      centerX: detection.centerX,
      centerY: detection.centerY,
      areaRatio: detection.areaRatio,
      position: detection.position,
      verticalPosition: detection.verticalPosition,
      distance: detection.distance,
      bbox: { ...detection.bbox },
      firstSeenAt: now,
      lastSeenAt: now,
      lostAt: null,
      lostForMs: 0,
      seenCount: 1,
      source: "mediapipe"
    };
  }

  updateTrack(track, detection, now) {
    const previousWeight = this.smoothing;
    const currentWeight = 1 - previousWeight;

    track.visible = true;
    track.confidence = Math.max(detection.confidence, track.confidence * previousWeight + detection.confidence * currentWeight);
    track.centerX = smooth(track.centerX, detection.centerX, previousWeight);
    track.centerY = smooth(track.centerY, detection.centerY, previousWeight);
    track.areaRatio = smooth(track.areaRatio, detection.areaRatio, previousWeight);
    track.bbox = smoothBbox(track.bbox, detection.bbox, previousWeight);
    track.position = track.centerX < 0.4 ? "left" : track.centerX > 0.6 ? "right" : "center";
    track.verticalPosition = track.centerY < 0.4 ? "top" : track.centerY > 0.6 ? "bottom" : "middle";
    track.distance = track.areaRatio > 0.18 ? "near" : track.areaRatio < 0.05 ? "far" : "medium";
    track.lastSeenAt = now;
    track.lostAt = null;
    track.lostForMs = 0;
    track.seenCount += 1;
  }

  updateLostTrack(track, now, forceInvisible = false) {
    if (!track.lostAt) {
      track.lostAt = track.lastSeenAt ?? now;
    }

    track.lostForMs = Math.max(0, now - Number(track.lastSeenAt ?? track.lostAt ?? now));
    track.visible = forceInvisible ? false : track.lostForMs < this.maxLostMs;
  }
}

function normalizeDetection(detection = {}) {
  const label = canonicalObjectLabel(detection.label);

  if (!label) {
    return null;
  }

  return {
    label,
    confidence: clampNumber(detection.confidence, 0, 1, 0),
    centerX: clampNumber(detection.centerX, 0, 1, 0.5),
    centerY: clampNumber(detection.centerY, 0, 1, 0.5),
    areaRatio: clampNumber(detection.areaRatio, 0, 1, 0),
    position: detection.position ?? "center",
    verticalPosition: detection.verticalPosition ?? "middle",
    distance: detection.distance ?? "medium",
    bbox: detection.bbox && typeof detection.bbox === "object" ? { ...detection.bbox } : {}
  };
}

function snapshotTrack(track, now) {
  const elapsedLostMs = track.lostAt ? Math.max(0, now - Number(track.lostAt)) : 0;
  const lostForMs = Math.max(Number(track.lostForMs || 0), elapsedLostMs);
  return {
    ...track,
    bbox: { ...track.bbox },
    lostForMs,
    visible: Boolean(track.visible && lostForMs < LOST_PRUNE_MS)
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

function centerDistance(track, detection) {
  return Math.hypot(
    Number(track.centerX ?? 0.5) - Number(detection.centerX ?? 0.5),
    Number(track.centerY ?? 0.5) - Number(detection.centerY ?? 0.5)
  );
}

function smooth(previous, next, previousWeight) {
  return Number(previous) * previousWeight + Number(next) * (1 - previousWeight);
}

function smoothBbox(previous = {}, next = {}, previousWeight) {
  return {
    x: smooth(previous.x ?? next.x ?? 0, next.x ?? previous.x ?? 0, previousWeight),
    y: smooth(previous.y ?? next.y ?? 0, next.y ?? previous.y ?? 0, previousWeight),
    width: smooth(previous.width ?? next.width ?? 0, next.width ?? previous.width ?? 0, previousWeight),
    height: smooth(previous.height ?? next.height ?? 0, next.height ?? previous.height ?? 0, previousWeight)
  };
}

function parseTimestamp(timestamp) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}
