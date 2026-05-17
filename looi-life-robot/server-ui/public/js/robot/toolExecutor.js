const PHYSICAL_ACTIONS = new Set([
  "drive",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle"
]);

const ACTION_TYPES = new Set([
  "speak",
  "express",
  "drive",
  "stop",
  "approach_user",
  "retreat",
  "curious_scan",
  "excited_wiggle",
  "observe_scene",
  "remember",
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

const CAMERA_ACTIONS = new Set([
  "open_front_camera",
  "open_back_camera",
  "switch_camera",
  "close_camera",
  "capture_snapshot"
]);

const FACE_EXPRESSIONS = new Set([
  "neutral",
  "happy",
  "curious",
  "attentive",
  "sleepy",
  "scared",
  "shy",
  "sad"
]);

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
    this.logger = logger;
    this.getRuntimeContext = getRuntimeContext;
    this.getExecutionPolicy = getExecutionPolicy;
    this.executionQueue = [];
    this.busy = false;
    this.latestResults = new Map();
    this.actionHistory = [];
    this.maxHistory = 50;
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
      this.processQueue();
    });
  }

  async emergencyStop(reason = "tool_executor_emergency_stop") {
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
      case "speak":
        return this.executeSpeak(args, action);
      case "express":
        return this.executeExpress(args, action);
      case "drive":
        return this.executeDrive(args, action);
      case "stop":
        return this.executeStop(args, action);
      case "approach_user":
        return this.executeApproachUser(args, action);
      case "retreat":
        return this.executeRetreat(args, action);
      case "curious_scan":
        return this.executeCuriousScan(args, action);
      case "excited_wiggle":
        return this.executeExcitedWiggle(args, action);
      case "observe_scene":
        return this.executeObserveScene(args, action);
      case "remember":
        return this.executeRemember(args, action);
      case "open_front_camera":
        return this.executeOpenCamera("user", action);
      case "open_back_camera":
        return this.executeOpenCamera("environment", action);
      case "switch_camera":
        return this.executeSwitchCamera(action);
      case "close_camera":
        return this.executeCloseCamera(action);
      case "capture_snapshot":
        return this.executeCaptureSnapshot(args, action);
      default:
        return this.buildResult("rejected", {
          action,
          executed: false,
          physical: false,
          message: `Unknown action type: ${type}`
        });
    }
  }

  async executeSpeak(args = {}, action = {}) {
    if (!this.isSpeechAllowed(action)) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: `${this.policyLabel(action)} speech is disabled in the browser UI.`
      });
    }

    const text = normalizeShortText(args.text, 240);

    if (!text) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Speak action requires short text."
      });
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: false,
      allowMotion: false,
      allowSpeech: true,
      args: { ...args, text }
    });
    if (routed) {
      return routed;
    }

    if (this.voiceOutput?.speak) {
      const result = await this.voiceOutput.speak({
        text,
        tone: args.tone ?? "soft",
        interrupt: args.interrupt === true
      });

      return this.buildResult("completed", {
        action,
        executed: Boolean(result.executed),
        physical: false,
        message: result.executed
          ? `Spoke ${this.policyLabel(action)} text.`
          : `Speech not spoken: ${result.reason}`,
        detail: {
          textLength: text.length,
          tone: args.tone ?? "soft",
          muted: Boolean(result.muted),
          reason: result.reason
        }
      });
    }

    if (!globalThis.speechSynthesis || typeof globalThis.SpeechSynthesisUtterance !== "function") {
      return this.buildResult("completed", {
        action,
        executed: false,
        physical: false,
        message: "Speech synthesis is unavailable in this browser.",
        detail: { text }
      });
    }

    this.lifeEngine?.setSpeaking?.(true);

    try {
      await new Promise((resolve) => {
        const utterance = new globalThis.SpeechSynthesisUtterance(text);
        const timeout = globalThis.setTimeout(resolve, Math.min(5000, 1200 + text.length * 45));

        utterance.rate = toneToRate(args.tone);
        utterance.pitch = toneToPitch(args.tone);
        utterance.onend = () => {
          clearTimeout(timeout);
          resolve();
        };
        utterance.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };

        globalThis.speechSynthesis.speak(utterance);
      });
    } finally {
      this.lifeEngine?.setSpeaking?.(false);
    }

    return this.buildResult("completed", {
      action,
      executed: true,
      physical: false,
      message: `Spoke ${this.policyLabel(action)} text.`,
      detail: { text, tone: args.tone ?? "soft" }
    });
  }

  async executeExpress(args = {}, action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const emotion = typeof args.emotion === "string" ? args.emotion : "neutral";
    const intensity = clampNumber(args.intensity, 0, 1.5, 1);

    if (!FACE_EXPRESSIONS.has(emotion)) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: `Unsupported expression: ${emotion}`
      });
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: false,
      allowMotion: false,
      allowSpeech: false
    });
    if (routed) {
      return routed;
    }

    const expression = emotion === "sad" ? "shy" : emotion;
    this.face?.setExpression?.(expression, intensity);
    this.lifeEngine?.patchState?.({ mood: expression }, `${this.policyLabel(action)}_express`);

    return this.buildResult("completed", {
      action,
      executed: true,
      physical: false,
      message: `Set expression to ${emotion}.`,
      detail: { emotion, expression, intensity }
    });
  }

  async executeDrive(args = {}, action = {}) {
    const linear = Number(args.linear);
    const angular = Number(args.angular);
    const durationMs = Number(args.duration_ms ?? args.durationMs);

    if (!Number.isFinite(linear) || !Number.isFinite(angular) || !Number.isFinite(durationMs)) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: true,
        message: "Drive action requires numeric linear, angular, and duration_ms."
      });
    }

    if (Math.abs(linear) < 0.001 && Math.abs(angular) < 0.001) {
      return this.executeStop({ reason: args.reason ?? `${this.policyLabel(action)}_zero_drive` }, action);
    }

    const gate = this.ensurePhysicalAllowed(action);
    if (gate) {
      return gate;
    }

    if (args.style) {
      const routed = await this.executeEmbodiedRoute(action, {
        physical: true,
        allowMotion: true,
        allowSpeech: false
      });
      if (routed) {
        return routed;
      }
    }

    const result = await this.lifeEngine?.executeKimiAction?.("drive", {
      linear,
      angular,
      durationMs,
      style: args.style
    });

    return this.resultFromLifeEngine(action, result, "Drive action routed through Life Engine.");
  }

  async executeStop(args = {}, action = {}) {
    const reason = normalizeShortText(args.reason, 160) || "cloud_stop";

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

  async executeApproachUser(args = {}, action = {}) {
    const gate = this.ensurePhysicalAllowed(action);
    if (gate) {
      return gate;
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: true,
      allowMotion: true,
      allowSpeech: this.isSpeechAllowed(action)
    });
    if (routed) {
      return routed;
    }

    const result = await this.lifeEngine?.executeKimiAction?.("approach_user", args);
    return this.resultFromLifeEngine(action, result, "Approach user routed through Life Engine.");
  }

  async executeRetreat(args = {}, action = {}) {
    const gate = this.ensurePhysicalAllowed(action);
    if (gate) {
      return gate;
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: true,
      allowMotion: true,
      allowSpeech: this.isSpeechAllowed(action)
    });
    if (routed) {
      return routed;
    }

    const result = await this.lifeEngine?.executeKimiAction?.("retreat", args);
    return this.resultFromLifeEngine(action, result, "Retreat routed through Life Engine.");
  }

  async executeCuriousScan(args = {}, action = {}) {
    if (!this.isMotionArmed(action)) {
      const routed = await this.executeEmbodiedRoute(action, {
        physical: false,
        allowMotion: false,
        allowSpeech: false
      });
      if (routed) {
        return routed;
      }

      const nonPhysical = this.ensureNonPhysicalAllowed(action);
      if (nonPhysical) {
        return nonPhysical;
      }

      this.face?.setExpression?.("curious", clampNumber(args.intensity, 0, 1.5, 1));
      this.face?.setEyeDirection?.(normalizeDirection(args.direction));

      return this.buildResult("completed", {
        action,
        executed: true,
        physical: false,
        message: `Curious expression shown; body motion skipped because ${this.policyLabel(action)} motion is disarmed.`,
        detail: { partial: true, bodyMotionSkipped: `${this.policyLabel(action)}_motion_not_armed` }
      });
    }

    const gate = this.ensurePhysicalAllowed(action);
    if (gate) {
      return gate;
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: true,
      allowMotion: true,
      allowSpeech: false
    });
    if (routed) {
      return routed;
    }

    const result = await this.lifeEngine?.executeKimiAction?.("curious_scan", args);
    return this.resultFromLifeEngine(action, result, "Curious scan routed through Life Engine.");
  }

  async executeExcitedWiggle(args = {}, action = {}) {
    const gate = this.ensurePhysicalAllowed(action);
    if (gate) {
      return gate;
    }

    const routed = await this.executeEmbodiedRoute(action, {
      physical: true,
      allowMotion: true,
      allowSpeech: false
    });
    if (routed) {
      return routed;
    }

    const result = await this.lifeEngine?.executeKimiAction?.("excited_wiggle", args);
    return this.resultFromLifeEngine(action, result, "Excited wiggle routed through Life Engine.");
  }

  async executeObserveScene(args = {}, action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const includeSnapshot = args.includeSnapshot === true;

    if (includeSnapshot) {
      const cameraGate = this.ensureCameraAllowed(action);
      if (cameraGate) {
        return cameraGate;
      }
    }

    const context =
      typeof this.getRuntimeContext === "function" ? this.getRuntimeContext(args) : {};
    const detail = compactRuntimeContext(context);

    if (includeSnapshot) {
      if (!this.cameraInput?.captureSnapshot) {
        return this.buildResult("failed", {
          action,
          executed: false,
          physical: false,
          message: "Camera input is not available.",
          detail
        });
      }

      const snapshotResult = await this.cameraInput.captureSnapshot({
        includeDataUrl: args.includeDataUrl === true,
        maxWidth: clampNumber(args.maxWidth, 160, 640, 320),
        quality: clampNumber(args.quality, 0.3, 0.8, 0.65)
      });

      if (!snapshotResult.ok) {
        return this.buildResult("failed", {
          action,
          executed: false,
          physical: false,
          message: snapshotResult.error ?? "Snapshot capture failed.",
          detail: {
            ...detail,
            cameraStatus: sanitizeCameraStatus(snapshotResult.status)
          }
        });
      }

      detail.snapshot = snapshotResult.snapshot;
      detail.cameraStatus = sanitizeCameraStatus(snapshotResult.status);
    }

    return this.buildResult("completed", {
      action,
      executed: true,
      physical: false,
      message: "Returned local robot runtime context.",
      detail
    });
  }

  async executeOpenCamera(facingMode, action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const cameraGate = this.ensureCameraAllowed(action);
    if (cameraGate) {
      return cameraGate;
    }

    if (!this.cameraInput?.startCamera) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: false,
        message: "Camera input is not available."
      });
    }

    const result = await this.cameraInput.startCamera({ facingMode });

    return this.buildResult(result.ok ? "completed" : "failed", {
      action,
      executed: Boolean(result.ok),
      physical: false,
      message: result.ok
        ? `${facingMode === "environment" ? "Back" : "Front"} camera opened locally.`
        : result.error ?? "Camera open failed.",
      detail: {
        cameraStatus: sanitizeCameraStatus(result.status)
      }
    });
  }

  async executeSwitchCamera(action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const cameraGate = this.ensureCameraAllowed(action);
    if (cameraGate) {
      return cameraGate;
    }

    if (!this.cameraInput?.switchCamera) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: false,
        message: "Camera input is not available."
      });
    }

    const result = await this.cameraInput.switchCamera();

    return this.buildResult(result.ok ? "completed" : "failed", {
      action,
      executed: Boolean(result.ok),
      physical: false,
      message: result.ok ? "Camera switched locally." : result.error ?? "Camera switch failed.",
      detail: {
        cameraStatus: sanitizeCameraStatus(result.status)
      }
    });
  }

  async executeCloseCamera(action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const cameraGate = this.ensureCameraAllowed(action);
    if (cameraGate) {
      return cameraGate;
    }

    if (!this.cameraInput?.stopCamera) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: false,
        message: "Camera input is not available."
      });
    }

    const result = await this.cameraInput.stopCamera();

    return this.buildResult("completed", {
      action,
      executed: true,
      physical: false,
      message: "Camera closed locally.",
      detail: {
        cameraStatus: sanitizeCameraStatus(result.status)
      }
    });
  }

  async executeCaptureSnapshot(args = {}, action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

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

    const result = await this.cameraInput.captureSnapshot({
      includeDataUrl: args.includeDataUrl === true,
      maxWidth: clampNumber(args.maxWidth, 160, 640, 320),
      quality: clampNumber(args.quality, 0.3, 0.8, 0.65)
    });

    return this.buildResult(result.ok ? "completed" : "failed", {
      action,
      executed: Boolean(result.ok),
      physical: false,
      message: result.ok ? "Captured a small local camera snapshot." : result.error ?? "Snapshot capture failed.",
      detail: {
        cameraStatus: sanitizeCameraStatus(result.status),
        snapshot: result.snapshot ?? null
      }
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
        autonomous: routedAction.autonomous === true,
        force,
        priority: routedAction.type === "stop" ? 100 : routedAction.autonomous === true ? 40 : 60,
        reason: routedAction.reason ?? routedAction.type
      });

      if (!routed || routed.ok === false || routed.status === "rejected") {
        return null;
      }

      return this.buildResult("completed", {
        action: routedAction,
        executed: routed.result?.executed !== false,
        physical,
        message: `Embodied macro ${routed.macro ?? routedAction.type} completed.`,
        detail: {
          macro: routed.macro ?? null,
          route: routed
        }
      });
    } catch (error) {
      this.log(`Embodied route failed (${routedAction.type}): ${error.message}`, "warn");
      return null;
    }
  }

  async executeRemember(args = {}, action = {}) {
    const nonPhysical = this.ensureNonPhysicalAllowed(action);
    if (nonPhysical) {
      return nonPhysical;
    }

    const text = normalizeShortText(args.text, 2000);
    const memoryType = normalizeMemoryType(args.memory_type);
    const importance = normalizeImportance(args.importance);
    const stored = {};

    if (!text) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Remember action requires text."
      });
    }

    if (looksLikeSecret(text) || looksLikeSecret(args.phrase) || looksLikeSecret(args.meaning)) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Memory text appears to contain a token, API key, or password."
      });
    }

    const storageType = selectMemoryStorageType(memoryType, importance);

    try {
      if (memoryType === "learned_phrase" && args.phrase && args.action) {
        const phrasePayload = await postJson("/api/memory/learned-phrases", {
          phrase: args.phrase,
          meaning: args.meaning ?? text,
          action: args.action,
          args: args.args ?? {},
          confidence: args.confidence ?? importance,
          source: action.source === "kimi_claw_cloud" ? "kimi_claw" : "manual"
        });
        stored.learnedPhrase = phrasePayload.phrase ?? null;
      }

      const memoryPayload = await postJson("/api/memory/write", {
        type: storageType,
        text: `[${memoryType}/${importance}] ${text}`,
        metadata: {
          source: action.source ?? "kimi_claw",
          importance,
          memory_type: memoryType
        }
      });
      stored.memory = memoryPayload.memory ?? null;

      return this.buildResult("completed", {
        action,
        executed: true,
        physical: false,
        message: "Memory stored locally.",
        detail: { memoryType, importance, storageType, stored }
      });
    } catch (error) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: false,
        message: `Memory write failed: ${error.message}`,
        detail: { memoryType, importance, storageType }
      });
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

  isCameraAction(type) {
    return CAMERA_ACTIONS.has(type);
  }

  isMotionArmed(action = {}) {
    const policy = this.policy();
    return this.isLocalBrainAction(action)
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
        item.resolve(
          this.buildResult("rejected", {
            action,
            executed: false,
            physical: this.isPhysicalAction(action.type),
            message: shapeError
          })
        );
      } else {
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

  ensurePhysicalAllowed(action) {
    if (!this.isMotionArmed(action)) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: true,
        message: `${this.policyLabel(action)} motion is not armed in the browser UI.`
      });
    }

    if (
      this.isLocalBrainAction(action) &&
      action.autonomous === true &&
      this.policy().allowAutonomousMovement !== true
    ) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: true,
        message: "Autonomous Local Brain movement is disabled in the browser UI."
      });
    }

    const stopRespectUntil = Number(this.lifeEngine?.getState?.().stopRespectUntil || 0);

    if (stopRespectUntil > Date.now()) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: true,
        message: "Robot is respecting a recent stop/freeze request.",
        detail: {
          stopRespectUntil
        }
      });
    }

    if (!this.robotClient?.isConnected?.()) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: true,
        message: "Robot or simulator is not connected."
      });
    }

    return null;
  }

  ensureNonPhysicalAllowed(action) {
    if (this.isLocalBrainAction(action)) {
      return null;
    }

    if (this.policy().allowNonPhysical === false) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: false,
        message: "Cloud non-physical actions are disabled in the browser UI."
      });
    }

    return null;
  }

  ensureCameraAllowed(action) {
    const policy = this.policy();
    const allowed = this.isLocalBrainAction(action)
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

  isSpeechAllowed(action = {}) {
    const policy = this.policy();

    if (!this.isLocalBrainAction(action)) {
      return policy.allowSpeak !== false;
    }

    if (policy.localSpeechAllowed === false) {
      return false;
    }

    if (action.autonomous === true && policy.allowAutonomousSpeech === false) {
      return false;
    }

    return true;
  }

  isLocalBrainAction(action = {}) {
    return action?.source === "local_brain" || action?.source === "local";
  }

  policyLabel(action = {}) {
    return this.isLocalBrainAction(action) ? "local" : "cloud";
  }

  resultFromLifeEngine(action, result, fallbackMessage) {
    if (!result) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: true,
        message: "Life Engine did not return a result."
      });
    }

    if (result.rejected || result.allowed === false) {
      return this.buildResult("rejected", {
        action,
        executed: false,
        physical: true,
        message: result.reason ?? "Life Engine rejected the action.",
        detail: result
      });
    }

    if (result.ok === false) {
      return this.buildResult("failed", {
        action,
        executed: false,
        physical: true,
        message: result.reason ?? "Life Engine failed the action.",
        detail: result
      });
    }

    return this.buildResult("completed", {
      action,
      executed: result.executed !== false,
      physical: true,
      message: result.reason ?? result.message ?? fallbackMessage,
      detail: result
    });
  }

  policy() {
    return {
      cloudMotionArmed: false,
      simulatorMode: false,
      robotConnected: Boolean(this.robotClient?.isConnected?.()),
      allowSpeak: true,
      allowNonPhysical: true,
      cloudCameraAllowed: false,
      source: "legacy",
      localMotionArmed: false,
      localCameraAllowed: false,
      localSpeechAllowed: true,
      autonomousMode: false,
      allowAutonomousMovement: false,
      allowAutonomousSpeech: true,
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

function compactRuntimeContext(context = {}) {
  return {
    lifeState: context.lifeState ?? null,
    robotTelemetry: context.robotTelemetry ?? null,
    connectionState: context.connectionState ?? "unknown",
    simulatorMode: Boolean(context.simulatorMode),
    cloudMotionArmed: Boolean(context.cloudMotionArmed),
    cloudCameraAllowed: Boolean(context.cloudCameraAllowed),
    localPolicy: context.localPolicy ?? null,
    localMotionArmed: Boolean(context.localMotionArmed ?? context.localPolicy?.localMotionArmed),
    localCameraAllowed: Boolean(context.localCameraAllowed ?? context.localPolicy?.localCameraAllowed),
    recentLifeEvents: Array.isArray(context.recentLifeEvents)
      ? context.recentLifeEvents.slice(0, 8)
      : [],
    personality: context.personality ?? null,
    lifeSignals: context.lifeSignals ?? null,
    learnedPhraseCount: Number(context.learnedPhraseCount || 0),
    cameraStatus: sanitizeCameraStatus(context.cameraStatus ?? context.camera),
    latestObservation:
      context.latestObservation ??
      context.camera?.latestObservation ??
      context.cameraStatus?.observation ??
      null,
    voice: context.voice ?? null,
    timestamp: new Date().toISOString()
  };
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

function normalizeShortText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeDirection(direction) {
  return ["left", "right", "both", "center"].includes(direction) ? direction : "center";
}

function normalizeMemoryType(memoryType) {
  return [
    "user_preference",
    "learned_phrase",
    "robot_identity",
    "shared_moment",
    "environment"
  ].includes(memoryType)
    ? memoryType
    : "shared_moment";
}

function normalizeImportance(importance) {
  return ["low", "medium", "high"].includes(importance) ? importance : "medium";
}

function selectMemoryStorageType(memoryType, importance) {
  if (memoryType === "robot_identity") {
    return "personality_note";
  }

  if (importance === "high" || ["learned_phrase", "user_preference"].includes(memoryType)) {
    return "long_term";
  }

  return "daily";
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }

  return payload;
}

function looksLikeSecret(value) {
  const text = String(value ?? "");
  const lower = text.toLowerCase();

  return (
    /\b(api[_ -]?key|token|password|secret|bearer)\b/.test(lower) ||
    /\bsk-[a-z0-9_-]{12,}/i.test(text)
  );
}

function clampNumber(value, min, max, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function toneToRate(tone) {
  return {
    shy: 0.9,
    serious: 0.92,
    playful: 1.08,
    happy: 1.04,
    curious: 1
  }[tone] ?? 0.96;
}

function toneToPitch(tone) {
  return {
    shy: 0.92,
    serious: 0.9,
    playful: 1.12,
    happy: 1.08,
    curious: 1.05
  }[tone] ?? 1;
}
