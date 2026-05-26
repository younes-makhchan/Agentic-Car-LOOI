import {
  getActiveScenarioLifecycles,
  getScenarioDefinition,
  normalizeScenarioName,
  normalizeRunScenarioName
} from "../embodiment/scenarioCatalog.js";
import { safeStringify, stopCommandQueueMotion } from "../core/runtimeUtils.js";
import { PRIORITY_LEVELS } from "../embodiment/priorityScheduler.js";
import { canonicalObjectLabel } from "../vision/objectLabelUtils.js";

const PHYSICAL_ACTIONS = new Set(["run_scenario", "stop"]);
const ACTION_TYPES = new Set(["run_scenario", "stop"]);

// Browser-only execution layer. It never talks to ESP32 directly for movement.
export class ToolExecutor {
  constructor({
    lifeEngine,
    face,
    robotClient,
    commandQueue,
    embodiedActionRouter,
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
    this.embodiedActionRouter = embodiedActionRouter;
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

  executeAction(action) {
    return this.enqueueAction(action);
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

  async immediateStop(reason = "tool_executor_immediate_stop") {
    this.scenarioToken += 1;
    this.activeScenario = null;
    this.visionScenarioManager?.stopFollowing?.(reason) ?? this.followTargetController?.stop?.(reason);
    this.face?.dismissPhoto?.();
    const dropped = this.executionQueue.splice(0);
    const stopResult = await this.executeStop({ reason }, { id: "immediate_stop", type: "stop" });

    dropped.forEach(({ action, resolve }) => {
      resolve(
        this.buildResult("rejected", {
          action,
          executed: false,
          physical: this.isPhysicalAction(action?.type),
          message: `Dropped by immediate stop: ${reason}`
        })
      );
    });

    return stopResult;
  }

  async cancelActiveScenario(reason = "scenario_cancelled") {
    this.scenarioToken += 1;
    this.activeScenario = null;
    this.face?.dismissPhoto?.();
    const dropped = this.executionQueue.splice(0);

    const routedCancel = await this.embodiedActionRouter?.cancelActiveSequence?.(reason);
    if (!routedCancel?.ok) {
      await this.commandQueue?.cancelMotion?.(reason);
    }

    dropped.forEach(({ action, resolve }) => {
      resolve(
        this.buildResult("rejected", {
          action,
          executed: false,
          physical: this.isPhysicalAction(action?.type),
          message: `Dropped by scenario cancel: ${reason}`
        })
      );
    });

    return this.buildResult("completed", {
      action: { id: `scenario_cancel_${Date.now()}`, type: "cancel_scenario", args: { reason } },
      executed: true,
      physical: true,
      message: `Scenario cancelled: ${reason}`,
      detail: { reason }
    });
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

  async executeRunScenario(args = {}, action = {}, { forceBlocking = false } = {}) {
    const normalizedArgs = normalizeRunScenarioArgs(args, {
      allowInternalScenario: action.source === "local"
    });

    if (!normalizedArgs.name) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "run_scenario requires a valid scenario name."
      });
    }

    this.log(
      `STEP 4 RUN_SCENARIO name=${normalizedArgs.name} label=${normalizedArgs.label || "none"} mode=${normalizedArgs.mode} camera=${normalizedArgs.camera}`
    );

    if (normalizedArgs.name === "follow_target") {
      const activeFollow = this.getActiveFollowRequestState(normalizedArgs);

      if (activeFollow.sameTarget && activeFollow.sameMode) {
        const alreadyActive = this.buildAlreadyActiveScenarioResult(normalizedArgs.name, action, {
          physical: false,
          message: `Already following ${activeFollow.activeLabel}.`,
          detail: {
            targetLabel: activeFollow.activeLabel,
            mode: activeFollow.activeMode
          }
        });
        if (alreadyActive) {
          return alreadyActive;
        }
      }

      if (!activeFollow.sameTarget) {
        const lifecyclePrelude = await this.runLifecycleExitsBeforeScenario(normalizedArgs.name, action, {
          physical: false
        });
        if (lifecyclePrelude) {
          return lifecyclePrelude;
        }
      }

      return this.executeFollowTargetScenario({
        label: normalizedArgs.label,
        mode: normalizedArgs.mode
      }, action);
    }

    if (normalizedArgs.name === "stop_following") {
      const lifecyclePrelude = await this.runLifecycleExitsBeforeScenario(normalizedArgs.name, action, {
        physical: false
      });
      if (lifecyclePrelude) {
        return lifecyclePrelude;
      }

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

    const alreadyActive = this.buildAlreadyActiveScenarioResult(scenario.name, action, {
      physical: scenarioUsesMotion(scenario)
    });
    if (alreadyActive) {
      return alreadyActive;
    }

    const motionMode = scenarioMotionMode(scenario);
    const motionRequired = motionMode === true;
    const motionPermission = this.scenarioMotionPermission(action, motionMode !== false);

    if (motionRequired && motionPermission.allowed !== true) {
      return this.buildResult(motionPermission.reason === "robot_not_connected" ? "failed" : "rejected", {
        action,
        executed: false,
        physical: true,
        message: `Scenario ${scenario.name} did not move: ${motionPermission.reason}`,
        detail: {
          scenario: scenario.name,
          motionPermission
        }
      });
    }

    const lifecyclePrelude = await this.runLifecycleExitsBeforeScenario(scenario.name, action, {
      physical: scenarioUsesMotion(scenario)
    });
    if (lifecyclePrelude) {
      return lifecyclePrelude;
    }

    return this.executeScenario(scenario, action, {
      motionPermission,
      requestArgs: normalizedArgs,
      forceBlocking
    });
  }

  async runLifecycleExitsBeforeScenario(nextScenarioName, action = {}, { physical = false } = {}) {
    const activeLifecycles = getActiveScenarioLifecycles(this.scenarioLifecycleContext());
    const executedExits = new Set();

    if (activeLifecycles.some((activeLifecycle) => activeLifecycle.exitScenario === nextScenarioName)) {
      return null;
    }

    for (const activeLifecycle of activeLifecycles) {
      const exitScenario = activeLifecycle.exitScenario;
      if (!exitScenario || executedExits.has(exitScenario)) {
        continue;
      }

      if (activeLifecycle.exitPolicy !== "auto_before_next") {
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical,
          message: `Scenario ${nextScenarioName} blocked by active scenario ${activeLifecycle.name}.`,
          detail: {
            scenario: nextScenarioName,
            activeScenario: activeLifecycle.name,
            exitScenario,
            exitPolicy: activeLifecycle.exitPolicy
          }
        });
      }

      const exitResult = await this.executeLifecycleExitScenario(activeLifecycle, nextScenarioName, action);
      executedExits.add(exitScenario);

      if (exitResult.status !== "completed") {
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical,
          message: `Scenario ${nextScenarioName} blocked because ${exitScenario} did not complete: ${exitResult.message}`,
          detail: {
            scenario: nextScenarioName,
            activeScenario: activeLifecycle.name,
            exitScenario,
            prelude: exitResult
          }
        });
      }
    }

    return null;
  }

  buildAlreadyActiveScenarioResult(scenarioName, action = {}, {
    physical = false,
    message = "",
    detail = {}
  } = {}) {
    const activeLifecycle = getActiveScenarioLifecycles(this.scenarioLifecycleContext())
      .find((lifecycle) => lifecycle.name === scenarioName);

    if (!activeLifecycle) {
      return null;
    }

    this.log(`STEP 4 SCENARIO_ALREADY_ACTIVE ${scenarioName}`);
    return this.buildResult("completed", {
      action,
      executed: true,
      physical,
      message: message || `Scenario already active: ${scenarioName}.`,
      detail: {
        scenario: scenarioName,
        activeScenario: activeLifecycle.name,
        alreadyActive: true,
        ...detail
      }
    });
  }

  getActiveFollowRequestState(args = {}) {
    const requestedLabel = canonicalObjectLabel(args.label);
    const requestedMode = normalizeFollowMode(args.mode);
    const controllerStatus = this.followTargetController?.getStatus?.() ?? {};
    const activeTarget = this.visionState?.getActiveTarget?.() ?? null;
    const activeLabel = canonicalObjectLabel(controllerStatus.targetLabel ?? activeTarget?.label);
    const activeMode = normalizeFollowMode(controllerStatus.mode);
    const running = Boolean(
      this.followTargetController?.isRunning?.() ||
      controllerStatus.running
    );
    const sameTarget = Boolean(running && requestedLabel && activeLabel && requestedLabel === activeLabel);

    return {
      running,
      sameTarget,
      sameMode: sameTarget && requestedMode === activeMode,
      requestedLabel,
      requestedMode,
      activeLabel,
      activeMode
    };
  }

  async executeLifecycleExitScenario(activeLifecycle, nextScenarioName, action = {}) {
    const exitScenarioName = activeLifecycle.exitScenario;
    this.log(`STEP 4 SCENARIO_EXIT ${activeLifecycle.name} via ${exitScenarioName} before ${nextScenarioName}`);

    const exitAction = {
      ...action,
      id: `${action.id ?? `scenario_${Date.now()}`}:${exitScenarioName}`,
      source: "local",
      args: { name: exitScenarioName, reason: `before:${nextScenarioName}` },
      reason: `scenario_exit:${activeLifecycle.name}->${nextScenarioName}`
    };

    return this.executeRunScenario(exitAction.args, exitAction, { forceBlocking: true });
  }

  scenarioLifecycleContext() {
    return {
      face: this.face,
      lifeEngine: this.lifeEngine,
      robotClient: this.robotClient,
      cameraInput: this.cameraInput,
      visionScenarioManager: this.visionScenarioManager,
      visionState: this.visionState,
      followTargetController: this.followTargetController,
      runtimeContext: this.getRuntimeContext?.() ?? null
    };
  }

  async executeScenario(scenario, action, { motionPermission, requestArgs = {}, forceBlocking = false } = {}) {
    const usesMotion = scenarioUsesMotion(scenario);
    const requiresMotion = scenarioRequiresMotion(scenario);
    const requiresCamera = scenarioRequiresCamera(scenario);
    const execution = forceBlocking ? "blocking" : scenarioExecutionMode(scenario);
    const frames = buildScenarioFramesForRequest(scenario, requestArgs);

    if (this.activeScenario) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: usesMotion,
        message: `Scenario already running: ${this.activeScenario}`
      });
    }

    if (!frames.length) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: usesMotion,
        message: `Scenario has no executable sequence: ${scenario.name}`,
        detail: { scenario: scenario.name }
      });
    }

    const token = ++this.scenarioToken;
    this.activeScenario = scenario.name;
    this.log(`STEP 4 SCENARIO_START ${scenario.name} execution=${execution}`);

    const scenarioArgs = {
      name: `scenario_${scenario.name}`,
      frames,
      scenario: scenario.name,
      request: {
        camera: requestArgs.camera ?? "auto"
      },
      requiresMotion: usesMotion,
      cooldownMs: scenario.cooldownMs,
      interruptible: scenario.interruptible,
      metadata: {
        scenario: scenario.name
      }
    };
    const routeAction = {
      ...action,
      type: "run_sequence",
      reason: `run_scenario:${scenario.name}`,
      args: scenarioArgs
    };

    const runScenarioRoute = async ({ buildFinalResult = true } = {}) => {
      try {
        const routeResult = await this.executeEmbodiedRoute(routeAction, {
          physical: usesMotion,
          allowMotion: motionPermission?.allowed === true,
          allowCamera: requiresCamera,
          args: scenarioArgs
        });
        const routeMotion = inspectRouteMotion(routeResult);

        if (token !== this.scenarioToken) {
          if (!buildFinalResult) {
            this.log(`STEP 4 SCENARIO_ASYNC_INTERRUPTED ${scenario.name}`, "warn");
            return null;
          }

          return this.buildResult("rejected", {
            action,
            executed: false,
            physical: usesMotion,
            message: `Scenario interrupted: ${scenario.name}`,
            detail: {
              scenario: scenario.name,
              execution
            }
          });
        }

        if (
          requiresMotion &&
          (!routeResult || routeMotion.motionSkipped || routeResult.executed === false)
        ) {
          const permissionReason = motionPermission?.allowed === false ? motionPermission.reason : "";
          const reason = routeMotion.reason || permissionReason || "motion_not_executed";
          const status = reason === "robot_not_connected" || /not connected|disconnected/i.test(reason)
            ? "failed"
            : "rejected";

          if (!buildFinalResult) {
            this.log(`STEP 4 SCENARIO_ASYNC_FAILED ${scenario.name}: ${reason}`, "warn");
            return null;
          }

          return this.buildResult(status, {
            action,
            executed: false,
            physical: true,
            message: `Scenario ${scenario.name} did not move: ${reason}`,
            detail: {
              scenario: scenario.name,
              execution,
              route: routeResult ?? null,
              motionPermission
            }
          });
        }

        if (!routeResult || routeResult.status !== "completed") {
          const reason = routeFailureReason(routeResult) || "route_not_executed";

          if (!buildFinalResult) {
            this.log(`STEP 4 SCENARIO_ASYNC_FAILED ${scenario.name}: ${reason}`, "warn");
            return null;
          }

          return this.buildResult("rejected", {
            action,
            executed: false,
            physical: usesMotion,
            message: `Scenario ${scenario.name} did not execute: ${reason}`,
            detail: {
              scenario: scenario.name,
              execution,
              route: routeResult ?? null,
              motionPermission
            }
          });
        }

        if (!buildFinalResult) {
          this.log(`STEP 4 SCENARIO_ASYNC_COMPLETED ${scenario.name}`);
          return routeResult;
        }

        return this.buildResult("completed", {
          action,
          executed: routeResult.executed !== false,
          physical: usesMotion,
          message: `Scenario completed: ${scenario.name}`,
          detail: {
            scenario: scenario.name,
            execution,
            route: routeResult ?? null,
            actionDetails: extractRouteActionDetails(routeResult)
          }
        });
      } finally {
        if (token === this.scenarioToken) {
          this.activeScenario = null;
        }
      }
    };

    if (execution === "parallel") {
      runScenarioRoute({ buildFinalResult: false }).catch((error) => {
        this.log(`STEP 4 SCENARIO_ASYNC_FAILED ${scenario.name}: ${error.message}`, "warn");
      });

      return this.buildResult("queued", {
        action,
        executed: true,
        physical: usesMotion,
        message: `Scenario started in parallel: ${scenario.name}`,
        detail: {
          scenario: scenario.name,
          execution
        }
      });
    }

    return runScenarioRoute();
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
      force: true
    });
    if (routed?.status === "completed") {
      return routed;
    }

    try {
      await stopCommandQueueMotion(this.commandQueue, reason);
      this.lifeEngine?.receiveEvent?.({ type: "motion_stop", reason });

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
    const mode = normalizeFollowMode(args.mode);

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
      !followActive &&
      !isExplicitFollowStopIntent(readLatestUserIntent(this.getRuntimeContext?.()))
    ) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Ignored follow stop because the latest user intent did not explicitly stop following.",
        detail: { reason, followActive }
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
        runtimeContext: this.getRuntimeContext?.() ?? null,
        allowMotion,
        allowCamera,
        force,
        priority: priorityForRoutedAction(routedAction, { physical }),
        reason: routedAction.reason ?? routedAction.type
      });

      if (!routed) {
        return null;
      }

      const executed = routeResultExecuted(routed);
      const rejected = routed.ok === false || routed.status === "rejected";
      const completed = !rejected && executed;
      return this.buildResult(completed ? "completed" : "rejected", {
        action: routedAction,
        executed,
        physical,
        message: completed
          ? `Embodied sequence ${routed.sequence ?? routedAction.type} completed.`
          : `Embodied sequence ${routed.sequence ?? routedAction.type} did not execute.`,
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

    if (!this.robotClient?.isConnected?.()) {
      return { allowed: false, reason: "robot_not_connected" };
    }

    return { allowed: true, reason: "ok" };
  }

  isMotionArmed(action = {}) {
    const policy = this.policy();
    return Boolean(policy.localMotionArmed);
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

  policyLabel(_action = {}) {
    return "local";
  }

  policy() {
    return {
      robotConnected: Boolean(this.robotClient?.isConnected?.()),
      source: "local",
      localMotionArmed: false,
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

function readLatestUserIntent(context = {}) {
  return String(
    context?.geminiLive?.lastInputTranscript ??
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
    return PRIORITY_LEVELS.immediate_stop;
  }

  if (physical) {
    return PRIORITY_LEVELS.direct_user_command;
  }

  return PRIORITY_LEVELS.local_brain_action;
}

function routeResultExecuted(routed = {}) {
  const result = routed?.result ?? {};

  if (routed?.ok === false || routed?.status === "rejected" || result?.ok === false) {
    return false;
  }

  if (result.skipped === true || result.interrupted === true) {
    return false;
  }

  if (typeof result.executed === "boolean") {
    return result.executed;
  }

  return Number(result.executedFrames || 0) > 0;
}

function scenarioPermissions(scenario = {}) {
  const permissions = scenario.permissions && typeof scenario.permissions === "object"
    ? scenario.permissions
    : {};

  return {
    motion: permissions.motion === true || permissions.motion === "optional"
      ? permissions.motion
      : false,
    camera: permissions.camera === true
  };
}

function scenarioMotionMode(scenario = {}) {
  return scenarioPermissions(scenario).motion;
}

function scenarioUsesMotion(scenario = {}) {
  return scenarioMotionMode(scenario) !== false;
}

function scenarioRequiresMotion(scenario = {}) {
  return scenarioMotionMode(scenario) === true;
}

function scenarioRequiresCamera(scenario = {}) {
  return scenarioPermissions(scenario).camera === true;
}

function scenarioExecutionMode(scenario = {}) {
  return scenario.execution === "blocking" ? "blocking" : "parallel";
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

function routeFailureReason(routeResult = null) {
  const route = routeResult?.detail?.route ?? routeResult?.detail ?? routeResult;
  return route?.reason
    ?? route?.result?.reason
    ?? route?.result?.skippedFrames?.[0]
    ?? routeResult?.message
    ?? "";
}

function extractRouteActionDetails(routeResult = null) {
  const details = routeResult?.detail?.route?.result?.details
    ?? routeResult?.detail?.details
    ?? routeResult?.result?.details
    ?? [];

  return Array.isArray(details) ? details.slice(0, 8) : [];
}

function normalizeShortText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeFollowMode(mode) {
  return ["gentle", "curious", "cautious"].includes(mode) ? mode : "gentle";
}

function normalizeCameraChoice(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["auto", "front"].includes(normalized) ? normalized : "auto";
}

function normalizeRunScenarioArgs(args = {}, { allowInternalScenario = false } = {}) {
  const nested = args.args && typeof args.args === "object" && !Array.isArray(args.args)
    ? args.args
    : {};
  const rawName = args.name ?? args.scenario ?? nested.name ?? nested.scenario;
  const name = allowInternalScenario
    ? normalizeScenarioName(rawName) ?? normalizeRunScenarioName(rawName)
    : normalizeRunScenarioName(rawName);
  const mode = args.mode ?? nested.mode;

  return {
    name,
    label: normalizeShortText(args.label ?? args.targetLabel ?? nested.label ?? nested.targetLabel, 80),
    mode: normalizeFollowMode(mode),
    reason: normalizeShortText(args.reason ?? nested.reason, 120),
    camera: normalizeCameraChoice(args.camera ?? nested.camera)
  };
}

function buildScenarioFramesForRequest(scenario = {}, requestArgs = {}) {
  const frames = Array.isArray(scenario.sequence) ? [...scenario.sequence] : [];
  if (scenario.name !== "take_picture") {
    return frames;
  }

  const camera = normalizeCameraChoice(requestArgs.camera);
  return frames.map((frame) => {
    if (frame?.type !== "action" || typeof frame.action !== "function") {
      return frame;
    }

    return {
      ...frame,
      args: {
        ...(frame.args ?? {}),
        camera
      }
    };
  });
}
