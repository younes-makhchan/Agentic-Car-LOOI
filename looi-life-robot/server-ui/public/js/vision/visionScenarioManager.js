import { canonicalObjectLabel } from "./objectLabelUtils.js";

const DEFAULT_FOLLOW_LOCK_TIMEOUT_MS = 3000;

export class VisionScenarioManager {
  constructor({
    cameraInput,
    objectDetectorEngine,
    objectTracker,
    visionState,
    followTargetController,
    face,
    eventBus,
    armMovement,
    logger
  } = {}) {
    this.cameraInput = cameraInput;
    this.objectDetectorEngine = objectDetectorEngine;
    this.objectTracker = objectTracker;
    this.visionState = visionState;
    this.followTargetController = followTargetController;
    this.face = face;
    this.eventBus = eventBus;
    this.armMovement = armMovement;
    this.logger = logger;
  }

  async startFollowTarget({ label, aliases = [], mode = "gentle", trackId = null } = {}) {
    const targetLabel = canonicalObjectLabel(label);

    if (!targetLabel && !trackId) {
      return result("rejected", false, "Follow target requires a label.", {
        scenario: "follow_object",
        targetVisible: false
      });
    }

    this.visionState?.setScenario?.({
      active: true,
      type: "follow_object",
      targetLabel,
      targetTrackId: trackId,
      state: "searching",
      reason: "follow_starting"
    });
    let target = this.findTarget(targetLabel, aliases, trackId);
    const detectorActive = this.isDetectorActive();
    this.log(
      `follow request target=${targetLabel} detectorActive=${detectorActive} currentTarget=${describeTarget(target)}`
    );

    if (!isFreshFollowTarget(target)) {
      target = await this.waitForVisibleTarget({
        label: targetLabel,
        aliases,
        trackId,
        timeoutMs: this.getFollowLockTimeoutMs()
      });
    }

    if (!isFreshFollowTarget(target)) {
      const message = `I can't see the ${targetLabel}. Can you show it to me?`;
      this.visionState?.setScenario?.({
        active: true,
        type: "follow_object",
        targetLabel,
        targetTrackId: trackId,
        state: "not_found",
        reason: "target_not_visible"
      });
      this.face?.stopFollow?.();
      this.eventBus?.publish?.("vision_follow_not_found", {
        label: targetLabel,
        aliases,
        message
      }, { source: "vision", priority: 3 });
      this.log(`follow target not found target=${targetLabel}; detector left running=${this.isDetectorActive()}`, "warn");
      return result("completed", false, message, {
        scenario: "follow_object",
        targetLabel,
        targetVisible: false,
        scenarioState: "not_found"
      });
    }

    this.armMovement?.({
      requestedLabel: targetLabel,
      resolvedLabel: target.label,
      trackId: target.id ?? target.trackId,
      reason: "follow_target_start"
    });
    const started = this.followTargetController?.start?.({
      label: target.label,
      trackId: target.id ?? target.trackId,
      mode
    });
    this.face?.startFollow?.();
    this.log(`follow locked target=${target.label} track=${target.id ?? target.trackId ?? "none"}`);

    return result(started?.ok === false ? "rejected" : "completed", started?.ok !== false, `Started following ${target.label}.`, {
      scenario: "follow_object",
      targetLabel: target.label,
      targetTrackId: target.id ?? target.trackId,
      targetVisible: true,
      mode
    });
  }

  stopFollowing(reason = "follow_stop") {
    const stopped = this.followTargetController?.stop?.(reason) ?? { ok: true, reason };
    if (!this.followTargetController?.stop) {
      this.visionState?.clearActiveTarget?.(reason);
    }
    if (stopped?.wasRunning !== false) {
      this.face?.stopFollow?.();
    }
    return result("completed", true, "Stopped following target.", {
      scenario: "follow_object",
      reason,
      stopped
    });
  }

  getStatus() {
    return {
      follow: this.followTargetController?.getStatus?.() ?? null,
      vision: this.visionState?.getStatus?.() ?? null,
      detector: this.objectDetectorEngine?.getStatus?.() ?? null
    };
  }

  findTarget(label, aliases = [], trackId = null) {
    if (trackId) {
      const byId = this.objectTracker?.getTrackById?.(trackId) ?? this.visionState?.getTrackById?.(trackId);
      if (byId) {
        return byId;
      }
    }

    const labels = [label, ...aliases].filter(Boolean);
    return this.objectTracker?.findBestTrackByAliases?.(labels)
      ?? this.visionState?.findObject?.(labels)
      ?? null;
  }

  async waitForVisibleTarget({ label, aliases = [], trackId = null, timeoutMs = DEFAULT_FOLLOW_LOCK_TIMEOUT_MS } = {}) {
    let target = this.findTarget(label, aliases, trackId);
    if (isFreshFollowTarget(target)) {
      return target;
    }

    await this.ensureDetectorRunning();

    target = this.findTarget(label, aliases, trackId);
    if (isFreshFollowTarget(target)) {
      return target;
    }

    if (!this.isDetectorActive()) {
      return null;
    }

    if (typeof this.objectDetectorEngine?.onDetections !== "function") {
      const detection = await this.objectDetectorEngine?.detectOnce?.();
      if (detection) {
        const tracks = this.objectTracker?.update?.(detection) ?? [];
        this.visionState?.updateFromDetections?.(detection, tracks);
      }
      return this.findTarget(label, aliases, trackId);
    }

    this.log(`waiting for target=${label} timeout=${Math.round(timeoutMs)}ms detectorActive=${this.isDetectorActive()}`, "debug");

    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) {
          return;
        }
        done = true;
        unsubscribe();
        globalThis.clearTimeout(timeout);
        resolve(value);
      };
      const checkTarget = () => {
        const nextTarget = this.findTarget(label, aliases, trackId);
        if (isFreshFollowTarget(nextTarget)) {
          finish(nextTarget);
        }
      };
      const unsubscribe = this.objectDetectorEngine?.onDetections?.(() => {
        checkTarget();
      }) ?? (() => {});
      const timeout = globalThis.setTimeout(() => finish(null), Math.max(1, Number(timeoutMs) || DEFAULT_FOLLOW_LOCK_TIMEOUT_MS));

      checkTarget();
    });
  }

  async ensureDetectorRunning() {
    if (!this.cameraInput?.isRunning?.()) {
      this.log("follow detector unavailable: camera is not running", "warn");
      return false;
    }

    if (this.isDetectorActive()) {
      return true;
    }

    this.log("follow requested before Roboflow was warm; starting detector fallback now", "warn");
    const status = await this.objectDetectorEngine?.start?.();
    return Boolean(status?.running || status?.starting || this.isDetectorActive());
  }

  isDetectorActive() {
    const status = this.objectDetectorEngine?.getStatus?.() ?? {};
    return Boolean(status.running || status.starting || this.objectDetectorEngine?.isRunning?.());
  }

  getFollowLockTimeoutMs() {
    return this.followTargetController?.getStatus?.().lostTimeoutMs ?? DEFAULT_FOLLOW_LOCK_TIMEOUT_MS;
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(`Vision scenario: ${message}`, level);
    }
  }
}

function result(status, executed, message, detail = {}) {
  return {
    status,
    executed: Boolean(executed),
    physical: false,
    message,
    detail
  };
}

function isFreshFollowTarget(target = null) {
  return Boolean(target?.visible && !target.lostAt);
}

function describeTarget(target = null) {
  if (!target) {
    return "none";
  }

  return `${target.label ?? "unknown"}:${target.visible ? "visible" : "not_visible"}:track=${target.id ?? target.trackId ?? "none"}:lostAt=${target.lostAt ? "yes" : "no"}`;
}
