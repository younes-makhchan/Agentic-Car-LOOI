import { canonicalObjectLabel, getObjectAliases } from "./objectLabelUtils.js";

export class VisionScenarioManager {
  constructor({
    cameraInput,
    objectDetectorEngine,
    objectTracker,
    visionState,
    followTargetController,
    voiceOutput,
    face,
    eventBus,
    getPolicy,
    logger
  } = {}) {
    this.cameraInput = cameraInput;
    this.objectDetectorEngine = objectDetectorEngine;
    this.objectTracker = objectTracker;
    this.visionState = visionState;
    this.followTargetController = followTargetController;
    this.voiceOutput = voiceOutput;
    this.face = face;
    this.eventBus = eventBus;
    this.getPolicy = getPolicy;
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

    const policy = this.policy();

    if (!policy.localVisionEnabled) {
      return result("rejected", false, "Local object vision is disabled.", {
        scenario: "follow_object",
        targetLabel,
        targetVisible: false
      });
    }

    if (this.cameraInput?.isRunning?.() && !this.objectDetectorEngine?.isRunning?.()) {
      const startPromise = this.objectDetectorEngine?.start?.();
      startPromise?.catch?.((error) => {
        this.log(`Detector start skipped: ${error.message}`, "warn");
      });
    }

    const target = this.findTarget(targetLabel, aliases, trackId);

    if (!target?.visible) {
      const message = `I can't see the ${targetLabel}. Can you show it to me?`;
      this.visionState?.setScenario?.({
        active: true,
        type: "follow_object",
        targetLabel,
        targetTrackId: trackId,
        state: "not_found",
        reason: "target_not_visible"
      });
      this.face?.setVisionIndicator?.(true, "lost");
      this.eventBus?.publish?.("vision_follow_not_found", {
        label: targetLabel,
        aliases,
        message
      }, { source: "vision", priority: 3 });
      return result("completed", false, message, {
        scenario: "follow_object",
        targetLabel,
        targetVisible: false,
        scenarioState: "not_found"
      });
    }

    this.visionState?.setActiveTarget?.({
      label: target.label,
      aliases: [...getObjectAliases(target.label), ...aliases],
      trackId: target.id ?? target.trackId
    });
    const started = this.followTargetController?.start?.({
      label: target.label,
      trackId: target.id ?? target.trackId,
      mode
    });
    this.face?.setVisionIndicator?.(true, "following");
    this.eventBus?.publish?.("vision_follow_target_set", {
      label: target.label,
      trackId: target.id ?? target.trackId,
      mode
    }, { source: "vision", priority: 3 });

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
    this.visionState?.clearActiveTarget?.(reason);
    this.face?.setVisionIndicator?.(
      Boolean(this.objectDetectorEngine?.isRunning?.()),
      this.objectDetectorEngine?.isRunning?.() ? "detecting" : "detecting"
    );
    this.eventBus?.publish?.("vision_follow_stopped", {
      reason,
      stopped
    }, { source: "vision", priority: 3 });
    return result("completed", true, "Stopped following target.", {
      scenario: "follow_object",
      reason,
      stopped
    });
  }

  stopScenario(reason = "scenario_stop") {
    return this.stopFollowing(reason);
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

  policy() {
    return {
      localVisionEnabled: true,
      ...(typeof this.getPolicy === "function" ? this.getPolicy() : {})
    };
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
