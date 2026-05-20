import { movementNamesFor } from "../embodiment/movementCatalog.js";
import {
  getScenarioDefinition,
  normalizeRunScenarioName
} from "../embodiment/scenarioCatalog.js";
import { PRIORITY_LEVELS } from "../embodiment/priorityScheduler.js";

const PHYSICAL_ACTIONS = new Set(["run_scenario", "stop"]);
const ACTION_TYPES = new Set(["run_scenario", "stop"]);

// Browser-only execution layer. It never talks to ESP32 directly for movement.
export class ToolExecutor {
  constructor({
    lifeEngine,
    face,
    robotClient,
    commandQueue,
    clawBridgeClient,
    embodiedActionRouter,
    voiceOutput,
    cameraInput,
    visionScenarioManager,
    visionState,
    followTargetController,
    logger,
    getRuntimeContext,
    getExecutionPolicy
  } = {}) {
    this.lifeEngine = lifeEngine;
    this.face = face;
    this.robotClient = robotClient;
    this.commandQueue = commandQueue;
    this.clawBridgeClient = clawBridgeClient;
    this.embodiedActionRouter = embodiedActionRouter;
    this.voiceOutput = voiceOutput;
    this.cameraInput = cameraInput;
    this.visionScenarioManager = visionScenarioManager;
    this.visionState = visionState;
    this.followTargetController = followTargetController;
    this.logger = logger;
    this.getRuntimeContext = getRuntimeContext;
    this.getExecutionPolicy = getExecutionPolicy;
    this.executionQueue = [];
    this.busy = false;
    this.latestResults = new Map();
    this.actionHistory = [];
    this.maxHistory = 50;
    this.activeScenario = null;
    this.scenarioToken = 0;
  }

  setRobotInterfaces({ robotClient, commandQueue } = {}) {
    if (robotClient) {
      this.robotClient = robotClient;
    }

    if (commandQueue) {
      this.commandQueue = commandQueue;
    }
  }

  setLifeEngine(lifeEngine) {
    this.lifeEngine = lifeEngine;
  }

  setCameraInput(cameraInput) {
    this.cameraInput = cameraInput;
  }

  setVisionControllers({ visionScenarioManager, visionState, followTargetController } = {}) {
    if (visionScenarioManager) {
      this.visionScenarioManager = visionScenarioManager;
    }
    if (visionState) {
      this.visionState = visionState;
    }
    if (followTargetController) {
      this.followTargetController = followTargetController;
    }
  }

  setEmbodiedActionRouter(embodiedActionRouter) {
    this.embodiedActionRouter = embodiedActionRouter;
  }

  executeBridgeAction(action) {
    return this.enqueueAction(action);
  }

  executeActions(actions = []) {
    return Promise.all(actions.map((action) => this.enqueueAction(action)));
  }

  enqueueAction(action) {
    return new Promise((resolve) => {
      this.executionQueue.push({ action, resolve });
      this.log(
        `STEP 4 TOOL_QUEUE ${action?.type ?? "unknown"} from ${action?.source ?? "unknown"}: ${safeStringify(action?.args ?? {})}`
      );
      this.processQueue();
    });
  }

  async emergencyStop(reason = "tool_executor_emergency_stop") {
    this.scenarioToken += 1;
    this.activeScenario = null;
    this.visionScenarioManager?.stopFollowing?.(reason) ?? this.followTargetController?.stop?.(reason);
    this.face?.dismissPhoto?.();
    const dropped = this.executionQueue.splice(0);
    const stopResult = await this.executeStop({ reason }, { id: "emergency_stop", type: "stop" });

    dropped.forEach(({ action, resolve }) => {
      resolve(
        this.buildResult("rejected", {
          action,
          executed: false,
          physical: this.isPhysicalAction(action?.type),
          message: `Dropped by emergency stop: ${reason}`
        })
      );
    });

    return stopResult;
  }

  getActionHistory() {
    return [...this.actionHistory];
  }

  async executeTool(type, args = {}, action = {}) {
    switch (type) {
      case "run_scenario":
        return this.executeRunScenario(args, action);
      case "stop":
        return this.executeStop(args, action);
      default:
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical: false,
          message: `Unknown action type: ${type}`
        });
    }
  }

  async executeRunScenario(args = {}, action = {}) {
    const normalizedArgs = normalizeRunScenarioArgs(args);

    if (!normalizedArgs.name) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "run_scenario requires a valid scenario name."
      });
    }

    this.log(
      `STEP 4 RUN_SCENARIO name=${normalizedArgs.name} label=${normalizedArgs.label || "none"} mode=${normalizedArgs.mode}`
    );

    if (normalizedArgs.name === "follow_target") {
      return this.executeFollowTargetScenario({
        label: normalizedArgs.label,
        mode: normalizedArgs.mode
      }, action);
    }

    if (normalizedArgs.name === "stop_following") {
      return this.executeStopFollowingScenario({
        reason: normalizedArgs.reason || "run_scenario_stop_following"
      }, action);
    }

    const scenario = getScenarioDefinition(normalizedArgs.name);

    if (!scenario) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: `Scenario is not implemented: ${normalizedArgs.name}`
      });
    }

    const motionPermission = this.scenarioMotionPermission(action, Boolean(scenario.requiresMotion));
    return this.executeScenario(scenario, action, {
      motionPermission,
      allowSpeech: true
    });
  }

  async executeScenario(scenario, action, { motionPermission, allowSpeech } = {}) {
    if (this.activeScenario) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: Boolean(scenario.requiresMotion),
        message: `Scenario already running: ${this.activeScenario}`
      });
    }

    if (scenario.requiresCamera) {
      const cameraGate = this.ensureCameraAllowed(action);
      if (cameraGate) {
        return cameraGate;
      }

      if (!this.cameraInput?.captureSnapshot) {
        return this.buildResult("failed", {
          action,
          executed: false,
          physical: false,
          message: "Camera input is not available."
        });
      }
    }

    const token = ++this.scenarioToken;
    this.activeScenario = scenario.name;
    this.log(`STEP 4 SCENARIO_START ${scenario.name}`);

    try {
      if (scenario.requiresCamera) {
        const status = this.cameraInput?.getCameraStatus?.() ?? {};

        if (!status.running) {
          const startResult = await this.cameraInput.startCamera?.({ facingMode: "user" });

          if (!startResult?.ok) {
            return this.buildResult("failed", {
              action,
              executed: false,
              physical: false,
              message: startResult?.error ?? "Camera could not start for scenario.",
              detail: {
                scenario: scenario.name,
                cameraStatus: sanitizeCameraStatus(startResult?.status)
              }
            });
          }
        }
      }

      const scenarioArgs = {
        speech: { text: "", tone: "soft" },
        movement: [...scenario.movement],
        scenario: scenario.name,
        timing: scenario.timing ?? "sequence",
        iterateMovement: Boolean(scenario.iterateMovement)
      };
      const routeAction = {
        ...action,
        type: "run_sequence",
        reason: `run_scenario:${scenario.name}`,
        args: scenarioArgs
      };

      const routeResult = await this.executeEmbodiedRoute(routeAction, {
        physical: Boolean(scenario.requiresMotion),
        allowMotion: motionPermission?.allowed === true,
        allowSpeech,
        allowCamera: Boolean(scenario.requiresCamera),
        args: scenarioArgs
      });
      const routeMotion = inspectRouteMotion(routeResult);

      if (token !== this.scenarioToken) {
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical: Boolean(scenario.requiresMotion),
          message: `Scenario interrupted: ${scenario.name}`
        });
      }

      if (
        scenario.requiresMotion &&
        !scenario.requiresCamera &&
        (!routeResult || routeMotion.motionSkipped || routeResult.executed === false)
      ) {
        const permissionReason = motionPermission?.allowed === false ? motionPermission.reason : "";
        const reason = routeMotion.reason || permissionReason || "motion_not_executed";
        const status = reason === "robot_not_connected" || /not connected|disconnected/i.test(reason)
          ? "failed"
          : "rejected";

        return this.buildResult(status, {
          action,
          executed: false,
          physical: true,
          message: `Scenario ${scenario.name} did not move: ${reason}`,
          detail: {
            scenario: scenario.name,
            route: routeResult ?? null,
            motionPermission,
            scenarioMovement: movementNamesFor(scenario.movement)
          }
        });
      }

      if (!scenario.requiresCamera) {
        return this.buildResult("completed", {
          action,
          executed: routeResult?.executed !== false,
          physical: Boolean(scenario.requiresMotion),
          message: `Scenario completed: ${scenario.name}`,
          detail: {
            scenario: scenario.name,
            route: routeResult ?? null,
            scenarioMovement: movementNamesFor(scenario.movement)
          }
        });
      }

      this.face?.takePicture?.();
      await wait(Number(scenario.captureDelayMs) || 0);

      if (token !== this.scenarioToken) {
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical: Boolean(scenario.requiresMotion),
          message: `Scenario interrupted before capture: ${scenario.name}`
        });
      }

      const snapshotResult = await this.cameraInput.captureSnapshot({
        includeDataUrl: true,
        maxWidth: 640,
        quality: 0.72
      });

      if (!snapshotResult.ok) {
        this.face?.dismissPhoto?.();
        return this.buildResult("failed", {
          action,
          executed: false,
          physical: Boolean(scenario.requiresMotion),
          message: snapshotResult.error ?? "Scenario snapshot capture failed.",
          detail: {
            scenario: scenario.name,
            route: routeResult ?? null,
            cameraStatus: sanitizeCameraStatus(snapshotResult.status)
          }
        });
      }

      this.face?.showPhoto?.(snapshotResult.snapshot?.dataUrl, {
        dismissMs: scenario.previewDismissMs
      });

      await wait(Math.max(0, Number(scenario.animationMs || 0) - Number(scenario.captureDelayMs || 0)));

      return this.buildResult("completed", {
        action,
        executed: true,
        physical: Boolean(scenario.requiresMotion),
        message: `Scenario completed: ${scenario.name}`,
        detail: {
          scenario: scenario.name,
          route: routeResult ?? null,
          scenarioMovement: movementNamesFor(scenario.movement),
          cameraStatus: sanitizeCameraStatus(snapshotResult.status),
          snapshot: sanitizeSnapshotMetadata(snapshotResult.snapshot)
        }
      });
    } finally {
      if (token === this.scenarioToken) {
        this.activeScenario = null;
      }
    }
  }

  async executeStop(args = {}, action = {}) {
    const reason = normalizeShortText(args.reason, 160) || "local_stop";
    this.scenarioToken += 1;
    this.activeScenario = null;
    this.visionScenarioManager?.stopFollowing?.(reason) ?? this.followTargetController?.stop?.(reason);
    this.face?.dismissPhoto?.();

    const routed = await this.executeEmbodiedRoute({
      ...action,
      args: { ...args, reason }
    }, {
      physical: true,
      allowMotion: false,
      allowSpeech: false,
      force: true
    });
    if (routed?.status === "completed") {
      return routed;
    }

    try {
      this.voiceOutput?.cancel?.(reason);
      await this.commandQueue?.emergencyStop?.(reason);
      this.lifeEngine?.receiveEvent?.({ type: "stop", reason });
      this.face?.setExpression?.(reason.includes("emergency") ? "scared" : "attentive", 1);

      return this.buildResult("completed", {
        action,
        executed: true,
        physical: true,
        message: `Stop executed: ${reason}`,
        detail: { reason }
      });
    } catch (error) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: true,
        message: `Stop failed: ${error.message}`,
        detail: { reason }
      });
    }
  }

  async executeFollowTargetScenario(args = {}, action = {}) {
    const label = normalizeShortText(args.label, 80);
    const mode = ["gentle", "curious", "cautious"].includes(args.mode) ? args.mode : "gentle";

    if (!label) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Follow target requires a label."
      });
    }

    if (!this.visionScenarioManager?.startFollowTarget) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: false,
        message: "Vision follow scenario manager is unavailable."
      });
    }

    const scenarioResult = await this.visionScenarioManager.startFollowTarget({
      label,
      mode,
      trackId: args.trackId ?? null
    });

    return this.buildResult(scenarioResult.status ?? "completed", {
      action,
      executed: Boolean(scenarioResult.executed),
      physical: false,
      message: scenarioResult.message ?? `Started following ${label}.`,
      detail: scenarioResult.detail ?? {}
    });
  }

  async executeStopFollowingScenario(args = {}, action = {}) {
    const reason = normalizeShortText(args.reason, 120) || "run_scenario_stop_following";
    const followActive = Boolean(this.followTargetController?.isRunning?.());

    if (
      action.source === "gemini_live" &&
      followActive &&
      !isExplicitFollowStopIntent(readLatestUserIntent(this.getRuntimeContext?.())) &&
      !/emergency/i.test(reason)
    ) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Ignored follow stop because the latest user intent did not explicitly stop following.",
        detail: { reason }
      });
    }

    const scenarioResult = this.visionScenarioManager?.stopFollowing?.(reason)
      ?? this.followTargetController?.stop?.(reason)
      ?? { ok: true, reason };

    return this.buildResult("completed", {
      action,
      executed: true,
      physical: false,
      message: "Stopped following target.",
      detail: scenarioResult.detail ?? scenarioResult
    });
  }

  async executeEmbodiedRoute(action = {}, {
    physical = false,
    allowMotion = false,
    allowSpeech = false,
    allowCamera = false,
    force = false,
    args = null
  } = {}) {
    if (!this.embodiedActionRouter?.execute) {
      return null;
    }

    const routedAction = args ? { ...action, args } : action;
    const policy = this.policy();

    try {
      const routed = await this.embodiedActionRouter.execute(routedAction, {
        source: routedAction.source ?? "tool_executor",
        localPolicy: policy,
        lifeState: this.lifeEngine?.getState?.() ?? null,
        allowMotion,
        allowSpeech,
        allowCamera,
        force,
        priority: priorityForRoutedAction(routedAction, { physical }),
        reason: routedAction.reason ?? routedAction.type
      });

      if (!routed || routed.ok === false || routed.status === "rejected") {
        return null;
      }

      return this.buildResult("completed", {
        action: routedAction,
        executed: routeResultExecuted(routed),
        physical,
        message: `Embodied sequence ${routed.sequence ?? routedAction.type} completed.`,
        detail: {
          sequence: routed.sequence ?? null,
          route: routed
        }
      });
    } catch (error) {
      this.log(`Embodied route failed (${routedAction.type}): ${error.message}`, "warn");
      return null;
    }
  }

  normalizeAction(action) {
    return {
      id: action?.id ?? `local_action_${Date.now()}`,
      source: action?.source ?? "unknown",
      type: action?.type,
      args: action?.args ?? {},
      status: action?.status ?? "claimed",
      createdAt: action?.createdAt ?? new Date().toISOString(),
      reason: action?.reason ?? null,
      requestId: action?.requestId ?? null
    };
  }

  validateActionShape(action) {
    if (!action || typeof action !== "object") {
      return "Action must be an object.";
    }

    if (typeof action.type !== "string" || !ACTION_TYPES.has(action.type)) {
      return `Unknown action type: ${action.type}`;
    }

    if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
      return "Action args must be an object.";
    }

    return null;
  }

  isPhysicalAction(type) {
    return PHYSICAL_ACTIONS.has(type);
  }

  scenarioMotionPermission(action = {}, requested = false) {
    if (!requested) {
      return { allowed: false, reason: "motion_not_requested" };
    }

    if (!this.isMotionArmed(action)) {
      return { allowed: false, reason: `${this.policyLabel(action)}_motion_not_armed` };
    }

    const stopRespectUntil = Number(this.lifeEngine?.getState?.().stopRespectUntil || 0);
    if (stopRespectUntil > Date.now()) {
      return { allowed: false, reason: "stop_cooldown_active" };
    }

    if (!this.robotClient?.isConnected?.()) {
      return { allowed: false, reason: "robot_not_connected" };
    }

    return { allowed: true, reason: "ok" };
  }

  isMotionArmed(action = {}) {
    const policy = this.policy();
    return this.isLocalAction(action)
      ? Boolean(policy.localMotionArmed)
      : Boolean(policy.cloudMotionArmed);
  }

  buildResult(status, detail = {}) {
    const action = detail.action ?? {};
    const result = {
      status,
      actionId: action.id ?? null,
      type: action.type ?? "unknown",
      executed: Boolean(detail.executed),
      physical: Boolean(detail.physical),
      message: detail.message ?? status,
      detail: detail.detail ?? {},
      timestamp: new Date().toISOString()
    };

    this.recordResult(result);
    this.log(
      `STEP 6 TOOL_RESULT ${result.type}: status=${result.status} executed=${result.executed} physical=${result.physical} message="${result.message}"`
    );
    return result;
  }

  async processQueue() {
    if (this.busy) {
      return;
    }

    const item = this.executionQueue.shift();

    if (!item) {
      return;
    }

    this.busy = true;

    try {
      const action = this.normalizeAction(item.action);
      const shapeError = this.validateActionShape(action);

      if (shapeError) {
        this.log(`STEP 4 TOOL_REJECT ${action.type}: ${shapeError}`, "warn");
        item.resolve(
          this.buildResult("rejected", {
            action,
            executed: false,
            physical: this.isPhysicalAction(action.type),
            message: shapeError
          })
        );
      } else {
        this.log(`STEP 4 TOOL_EXECUTE ${action.type}: ${safeStringify(action.args)}`);
        item.resolve(await this.executeTool(action.type, action.args, action));
      }
    } catch (error) {
      item.resolve(
        this.buildResult("failed", {
          action: item.action,
          executed: false,
          physical: this.isPhysicalAction(item.action?.type),
          message: error.message
        })
      );
    } finally {
      this.busy = false;
      this.processQueue();
    }
  }

  ensureCameraAllowed(action) {
    const policy = this.policy();
    const allowed = this.isLocalAction(action)
      ? policy.localCameraAllowed
      : policy.cloudCameraAllowed;

    if (!allowed) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: `${this.policyLabel(action)} camera access is not allowed in the browser UI.`,
        detail: {
          cloudCameraAllowed: Boolean(policy.cloudCameraAllowed),
          localCameraAllowed: Boolean(policy.localCameraAllowed)
        }
      });
    }

    return null;
  }

  isLocalAction(action = {}) {
    return action?.source === "local_brain" || action?.source === "local" || action?.source === "gemini_live";
  }

  policyLabel(action = {}) {
    return this.isLocalAction(action) ? "local" : "cloud";
  }

  policy() {
    return {
      cloudMotionArmed: false,
      simulatorMode: false,
      robotConnected: Boolean(this.robotClient?.isConnected?.()),
      allowSpeak: true,
      allowNonPhysical: true,
      cloudCameraAllowed: false,
      source: "local",
      localMotionArmed: false,
      localCameraAllowed: false,
      localSpeechAllowed: true,
      ...(typeof this.getExecutionPolicy === "function" ? this.getExecutionPolicy() : {})
    };
  }

  recordResult(result) {
    this.latestResults.set(result.actionId, result);
    this.actionHistory.unshift(result);
    this.actionHistory.length = Math.min(this.actionHistory.length, this.maxHistory);
    this.log(
      `${result.status.toUpperCase()} ${result.type}: ${result.message}`,
      result.status === "completed" ? "info" : "warn"
    );
  }

  log(message, level = "info") {
    if (!this.logger) {
      return;
    }

    if (typeof this.logger === "function") {
      this.logger(message, level);
      return;
    }

    const logMethod = typeof this.logger[level] === "function" ? level : "log";
    this.logger[logMethod](message);
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function readLatestUserIntent(context = {}) {
  return String(
    context?.geminiLive?.lastInputTranscript ??
    context?.voice?.geminiLive?.lastInputTranscript ??
    context?.voice?.lastTranscript?.text ??
    context?.voice?.lastTranscript ??
    context?.speechStatus?.lastTranscript?.text ??
    context?.speechStatus?.lastTranscript ??
    ""
  );
}

function isExplicitFollowStopIntent(text) {
  return /\b(stop following|stop tracking|cancel follow|cancel tracking|forget the target|never mind|nevermind|stop)\b/i.test(
    String(text ?? "")
  );
}

function priorityForRoutedAction(action = {}, { physical = false } = {}) {
  if (action.type === "stop") {
    return PRIORITY_LEVELS.emergency_stop;
  }

  if (physical) {
    return PRIORITY_LEVELS.direct_user_command;
  }

  return PRIORITY_LEVELS.local_brain_action;
}

function routeResultExecuted(routed = {}) {
  const result = routed?.result ?? {};

  if (result.skipped === true || result.interrupted === true) {
    return false;
  }

  if (typeof result.executed === "boolean") {
    return result.executed;
  }

  return Number(result.executedFrames || 0) > 0;
}

function inspectRouteMotion(routeResult = null) {
  const skippedFrames = routeResult?.detail?.route?.result?.skippedFrames
    ?? routeResult?.detail?.skippedFrames
    ?? routeResult?.result?.skippedFrames
    ?? [];
  const reasons = Array.isArray(skippedFrames)
    ? skippedFrames.map((reason) => String(reason ?? "")).filter(Boolean)
    : [];
  const motionReason = reasons.find((reason) =>
    /motion|robot_not_connected|not connected|command_queue|disconnected|stop_cooldown|ESP32/i.test(reason)
  );

  return {
    motionSkipped: Boolean(motionReason),
    reason: motionReason || ""
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function sanitizeCameraStatus(status = {}) {
  if (!status || typeof status !== "object") {
    return {
      supported: false,
      running: false,
      facingMode: "unknown",
      observation: null
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
    lastSnapshotAt: status.lastSnapshotAt ?? null,
    visionSupported: {
      faceDetector: Boolean(status.visionSupported?.faceDetector)
    },
    observation: status.observation
      ? {
          timestamp: status.observation.timestamp ?? null,
          cameraRunning: Boolean(status.observation.cameraRunning),
          facingMode: status.observation.facingMode ?? "unknown",
          detector: status.observation.detector ?? "none",
          userVisible: Boolean(status.observation.userVisible),
          faceCount: Number.isFinite(Number(status.observation.faceCount))
            ? Number(status.observation.faceCount)
            : null,
          userPosition: status.observation.userPosition ?? "unknown",
          userDistance: status.observation.userDistance ?? "unknown",
          brightness: Number.isFinite(Number(status.observation.brightness))
            ? Number(status.observation.brightness)
            : null,
          motion: status.observation.motion ?? null,
          note: status.observation.note ?? ""
        }
      : null
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

function normalizeShortText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeRunScenarioArgs(args = {}) {
  const nested = args.args && typeof args.args === "object" && !Array.isArray(args.args)
    ? args.args
    : {};
  const name = normalizeRunScenarioName(
    args.name ?? args.scenario ?? nested.name ?? nested.scenario
  );
  const mode = args.mode ?? nested.mode;

  return {
    name,
    label: normalizeShortText(args.label ?? args.targetLabel ?? nested.label ?? nested.targetLabel, 80),
    mode: ["gentle", "curious", "cautious"].includes(mode) ? mode : "gentle",
    reason: normalizeShortText(args.reason ?? nested.reason, 120)
  };
}
