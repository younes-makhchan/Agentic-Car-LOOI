import {
  createPersonalityProfile,
  DEFAULT_PERSONALITY_PROFILE
} from "../personality/personalityProfile.js";
import { stopCommandQueueMotion } from "../core/runtimeUtils.js";
import { DEFAULT_LIMITS } from "./safetyGate.js";
import {
  clamp01,
  createDefaultLifeState,
  pushRecentEvent,
  setMood,
  updateDriveValue
} from "./state.js";

const PATCHABLE_STATE_KEYS = new Set([
  "mood",
  "energy",
  "boredom",
  "fear",
  "curiosity",
  "affection",
  "loneliness",
  "comfort",
  "attentionTarget",
  "userVisible",
  "userDistance",
  "userPosition",
  "isSpeaking",
  "isListening",
  "isMoving",
  "battery",
  "obstacle",
  "currentBehavior",
  "lastUserSeenAt",
  "lastProactiveEventAt",
  "silenceUntil",
  "interactionCount",
  "stopRespectUntil"
]);

const DRIVE_KEYS = new Set([
  "energy",
  "boredom",
  "fear",
  "curiosity",
  "affection",
  "loneliness",
  "comfort"
]);

// Local instinct layer. It owns fast state, attention, drives, and safety.
// Face/body expression choices live in scenarios, not here.
export class LifeEngine {
  constructor({
    robotClient,
    commandQueue,
    calibration,
    personalityProfile,
    personalityTuning,
    logger,
    statusCallback
  } = {}) {
    this.robotClient = robotClient;
    this.commandQueue = commandQueue;
    this.calibration = calibration;
    this.personalityTuning = personalityTuning;
    this.personalityProfile = createPersonalityProfile(
      personalityProfile ?? personalityTuning?.getProfile?.() ?? DEFAULT_PERSONALITY_PROFILE
    );
    this.logger = logger;
    this.statusCallback = statusCallback;
    this.state = createDefaultLifeState();
    this.running = false;
    this.reflexTimer = null;
    this.driveTimer = null;
    this.lastTelemetryEventAt = 0;
    this.lastObstacleStopAt = 0;
    this.lastUserSeenAt = 0;
    this.limits = { ...DEFAULT_LIMITS };
    this.embodiedActionRouter = null;
  }

  start() {
    if (this.running) {
      return this.getState();
    }

    this.running = true;
    this.reflexTimer = globalThis.setInterval(() => this.tickReflex(), 100);
    this.driveTimer = globalThis.setInterval(() => this.tickDrives(), 500);

    this.emitStatus();
    this.log("Life Engine started.");

    return this.getState();
  }

  stop() {
    this.running = false;
    clearInterval(this.reflexTimer);
    clearInterval(this.driveTimer);
    this.reflexTimer = null;
    this.driveTimer = null;
    this.emitStatus();
    this.log("Life Engine stopped.");

    return this.getState();
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      recentEvents: [...this.state.recentEvents]
    };
  }

  getRecentEvents() {
    return [...this.state.recentEvents];
  }

  setRobotInterfaces({ robotClient, commandQueue } = {}) {
    if (robotClient) {
      this.robotClient = robotClient;
    }

    if (commandQueue) {
      this.commandQueue = commandQueue;
    }

    this.emitStatus();
    this.log("Life Engine robot interface updated.");
    return this.getState();
  }

  setCalibration(calibration) {
    this.calibration = calibration;
    const settings = calibration?.getSettings?.() ?? calibration ?? {};
    this.limits = {
      ...this.limits,
      maxSpeed: settings.maxSpeed ?? this.limits.maxSpeed,
      defaultRampMs: settings.rampMs ?? this.limits.defaultRampMs
    };
    this.emitStatus();
    return this.getState();
  }

  setEmbodiedActionRouter(router) {
    this.embodiedActionRouter = router;
    return this.getState();
  }

  setPersonalityProfile(profile) {
    this.personalityProfile = createPersonalityProfile(profile);
    this.applyPersonalityToDrives();
    this.emitStatus();
    return this.getState();
  }

  applyPersonalityToDrives() {
    const traits = this.personalityProfile?.coreTraits ?? DEFAULT_PERSONALITY_PROFILE.coreTraits;

    this.state.curiosity = clamp01(
      this.state.curiosity * 0.88 + Number(traits.curiosity ?? 0.75) * 0.12
    );
    this.state.affection = clamp01(
      this.state.affection * 0.9 + Number(traits.affection ?? 0.65) * 0.1
    );
    this.state.fear = clamp01(
      this.state.fear * 0.92 + Number(traits.caution ?? 0.7) * 0.03
    );
    this.state.comfort = clamp01(
      this.state.comfort * 0.9 + (1 - Number(traits.shyness ?? 0.35)) * 0.1
    );
  }

  patchState(partialState, reason = "manual_patch") {
    if (!partialState || typeof partialState !== "object") {
      return this.getState();
    }

    const appliedState = {};

    Object.entries(partialState).forEach(([key, value]) => {
      if (!PATCHABLE_STATE_KEYS.has(key)) {
        return;
      }

      const safeValue = DRIVE_KEYS.has(key) ? clamp01(value) : value;
      this.state[key] = safeValue;
      appliedState[key] = safeValue;
    });

    if (Object.keys(appliedState).length === 0) {
      return this.getState();
    }

    if (Object.prototype.hasOwnProperty.call(appliedState, "obstacle")) {
      this.setObstacle(Boolean(appliedState.obstacle));
    }

    pushRecentEvent(this.state, {
      type: "state_patch",
      reason,
      partialState: appliedState
    });
    this.state.lastEventAt = Date.now();
    this.log(`Life state patched (${reason}).`);
    this.emitStatus();

    return this.getState();
  }

  updateTelemetry(telemetry) {
    if (!telemetry || typeof telemetry !== "object") {
      return this.getState();
    }

    this.state.battery = telemetry.battery ?? this.state.battery;
    this.state.robotMotorState = telemetry.motor_state ?? this.state.robotMotorState;
    this.state.isMoving =
      Boolean(telemetry.motor_state) && telemetry.motor_state !== "stopped";
    if (Number(telemetry.clients) > 0 || this.robotClient?.isConnected?.()) {
      this.state.connectionState = "connected";
    }

    const now = Date.now();
    if (now - this.lastTelemetryEventAt > 5000) {
      this.lastTelemetryEventAt = now;
      pushRecentEvent(this.state, {
        type: "telemetry",
        motorState: this.state.robotMotorState,
        connectedClients: telemetry.clients
      });
    }

    this.emitStatus();
    return this.getState();
  }

  setConnectionState(connectionState) {
    this.state.connectionState = connectionState;
    this.emitStatus();
  }

  receiveEvent(event) {
    if (!event || typeof event !== "object") {
      return this.getState();
    }

    const now = Date.now();
    const nextEvent = {
      timestamp: now,
      ...event
    };

    pushRecentEvent(this.state, nextEvent);
    this.state.lastEventAt = nextEvent.timestamp;

    switch (nextEvent.type) {
      case "user_text":
        this.state.lastInteractionAt = now;
        this.state.interactionCount += 1;
        this.state.attentionTarget = "user";
        this.state.isListening = false;
        this.state.boredom = 0;
        this.state.loneliness = updateDriveValue(this.state.loneliness, -0.08);
        this.state.comfort = updateDriveValue(this.state.comfort, 0.04);
        this.state.affection = updateDriveValue(this.state.affection, 0.02);
        this.state.curiosity = updateDriveValue(this.state.curiosity, 0.05);
        setMood(this.state, "attentive");
        break;
      case "manual_test":
        this.state.lastInteractionAt = now;
        this.state.interactionCount += 1;
        this.state.attentionTarget = "controls";
        this.state.boredom = updateDriveValue(this.state.boredom, -0.08);
        this.log(`Life event: manual test ${nextEvent.label ?? ""}`.trim());
        break;
      case "stop":
      case "motion_stop":
        this.state.lastInteractionAt = now;
        this.state.interactionCount += 1;
        this.state.isMoving = false;
        this.state.robotMotorState = "stopped";
        this.state.currentBehavior = "soft_idle";
        setMood(this.state, "attentive");
        break;
      case "obstacle":
        this.setObstacle(Boolean(nextEvent.value));
        break;
      case "touch":
        this.state.lastInteractionAt = now;
        this.state.interactionCount += 1;
        this.state.attentionTarget = "user";
        this.state.affection = updateDriveValue(this.state.affection, 0.04);
        this.state.comfort = updateDriveValue(this.state.comfort, 0.05);
        this.state.loneliness = updateDriveValue(this.state.loneliness, -0.08);
        setMood(this.state, "happy");
        break;
      case "observation":
        this.applyObservation(
          nextEvent.observation ?? nextEvent.value ?? nextEvent.payload?.observation
        );
        break;
      case "system":
        this.applySystemEvent(nextEvent.value);
        break;
      default:
        break;
    }

    this.emitStatus();
    return this.getState();
  }

  setListening(isListening) {
    this.state.isListening = Boolean(isListening);
    if (this.state.isListening) {
      this.state.attentionTarget = "user";
      setMood(this.state, "attentive");
    }
    this.emitStatus();
  }

  setSpeaking(isSpeaking) {
    this.state.isSpeaking = Boolean(isSpeaking);
    this.emitStatus();
  }

  setObstacle(isObstacle) {
    this.state.obstacle = Boolean(isObstacle);
    if (this.state.obstacle) {
      this.state.fear = updateDriveValue(this.state.fear, 0.18);
      this.state.currentBehavior = "scared_stop";
      setMood(this.state, "scared");
      this.lastObstacleStopAt = Date.now();
      stopCommandQueueMotion(this.commandQueue, "life_obstacle")?.catch?.((error) => {
        this.log(`Obstacle stop failed: ${error.message}`, "error");
      });
    }
    this.emitStatus();
  }

  receiveObservation(observation) {
    if (!observation || typeof observation !== "object") {
      return this.getState();
    }

    pushRecentEvent(this.state, {
      type: "observation",
      observation: compactObservation(observation)
    });
    this.state.lastEventAt = Date.now();
    this.applyObservation(observation);
    this.emitStatus();

    return this.getState();
  }

  applyObservation(observation) {
    if (!observation || typeof observation !== "object") {
      return;
    }

    const now = Date.now();
    const userVisible = Boolean(observation.userVisible);
    const userDistance = normalizeObservationValue(observation.userDistance);
    const userPosition = normalizeUserPosition(observation.userPosition);

    if (userVisible) {
      this.lastUserSeenAt = now;
      this.state.userVisible = true;
      this.state.userDistance = userDistance;
      this.state.userPosition = userPosition;
      this.state.attentionTarget = "user";
      this.state.lastUserSeenAt = now;
      this.state.boredom = updateDriveValue(this.state.boredom, -0.04);
      this.state.curiosity = updateDriveValue(this.state.curiosity, 0.02);
      this.state.loneliness = updateDriveValue(this.state.loneliness, -0.06);
      this.state.comfort = updateDriveValue(this.state.comfort, 0.03);
      this.state.affection = updateDriveValue(this.state.affection, 0.01);

      if (this.state.mood === "neutral" || this.state.mood === "curious") {
        setMood(this.state, "attentive");
      }
      return;
    }

    if (this.state.userVisible && now - Number(this.lastUserSeenAt || 0) > 1500) {
      this.state.userVisible = false;
      this.state.userDistance = "unknown";
      this.state.userPosition = "unknown";
      this.state.attentionTarget =
        this.state.attentionTarget === "user" ? "environment" : this.state.attentionTarget;
      this.state.boredom = updateDriveValue(this.state.boredom, 0.01);
      this.state.loneliness = updateDriveValue(this.state.loneliness, 0.03);
    }
  }

  applySystemEvent(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (typeof value.boredom === "number") {
      this.patchState({ boredom: value.boredom }, "system_event");
    }

    if (typeof value.energy === "number") {
      this.patchState({ energy: value.energy }, "system_event");
    }
  }

  tickReflex() {
    if (!this.running) {
      return;
    }

    const now = Date.now();

    if (this.state.obstacle) {
      this.state.currentBehavior = "scared_stop";

      if (now - this.lastObstacleStopAt > 1000) {
        this.lastObstacleStopAt = now;
        stopCommandQueueMotion(this.commandQueue, "life_obstacle")?.catch?.((error) => {
          this.log(`Obstacle stop failed: ${error.message}`, "error");
        });
      }
    }
    const recentUserEvent = this.state.recentEvents.find(
      (event) =>
        event.type === "user_text" &&
        now - Number(event.timestamp || 0) < 1200
    );

    if (recentUserEvent) {
      this.state.attentionTarget = "user";
      this.state.boredom = 0;
    }

    this.emitStatus();
  }

  tickDrives() {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const idleMs = now - Number(this.state.lastInteractionAt || now);

    const profile = this.personalityTuning?.getProfile?.() ?? this.personalityProfile;
    this.personalityProfile = createPersonalityProfile(profile);
    const traits = this.personalityProfile.coreTraits;
    const style = this.personalityProfile.behaviorStyle;
    const boredomRate = 0.006 + Number(style.idleActivity ?? 0.35) * 0.012;
    const lonelinessRate = 0.003 + (1 - Number(traits.independence ?? 0.45)) * 0.006;

    if (idleMs > 15000) {
      this.state.boredom = updateDriveValue(this.state.boredom, boredomRate);
    } else {
      this.state.boredom = updateDriveValue(this.state.boredom, -0.03);
    }

    if (idleMs > 8000) {
      this.state.curiosity = updateDriveValue(
        this.state.curiosity,
        0.002 + Number(traits.curiosity ?? 0.75) * 0.004
      );
    }

    if (idleMs > 30000 && !this.state.userVisible) {
      this.state.loneliness = updateDriveValue(this.state.loneliness, lonelinessRate);
      this.state.comfort = updateDriveValue(this.state.comfort, -0.002);
    } else {
      this.state.loneliness = updateDriveValue(this.state.loneliness, -0.004);
    }

    if (this.state.obstacle) {
      this.state.fear = updateDriveValue(
        this.state.fear,
        0.05 + Number(traits.caution ?? 0.7) * 0.06
      );
    } else {
      this.state.fear = updateDriveValue(this.state.fear, -0.02);
    }

    this.state.energy = updateDriveValue(this.state.energy, this.state.isMoving ? -0.005 : -0.0005);
    this.state.affection = clamp01(this.state.affection);
    this.state.comfort = clamp01(this.state.comfort);
    this.state.loneliness = clamp01(this.state.loneliness);

    if (this.state.fear > 0.6) {
      setMood(this.state, "scared");
    } else if (this.state.energy < 0.2) {
      setMood(this.state, "sleepy");
    } else if (this.state.isListening) {
      setMood(this.state, "attentive");
    } else if (this.isStopRespectActive()) {
      setMood(this.state, "shy");
    } else if (this.state.userVisible && this.state.comfort > 0.65) {
      setMood(this.state, "attentive");
    } else if (this.state.loneliness > 0.72 && this.state.boredom > 0.45) {
      setMood(this.state, "curious");
    } else if (this.state.boredom > 0.7) {
      setMood(this.state, "curious");
    } else if (Date.now() - this.state.lastInteractionAt < 2500) {
      setMood(this.state, "attentive");
    } else {
      setMood(this.state, "neutral");
    }

    this.emitStatus();
  }

  emitStatus() {
    if (typeof this.statusCallback !== "function") {
      return;
    }

    try {
      this.statusCallback(this.getState());
    } catch (error) {
      this.log(`Life status callback failed: ${error.message}`, "warn");
    }
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

  isStopRespectActive(now = Date.now()) {
    return now < Number(this.state.stopRespectUntil || 0);
  }
}

function normalizeObservationValue(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : "unknown";
}

function normalizeUserPosition(position) {
  return ["left", "center", "right"].includes(position) ? position : "unknown";
}

function compactObservation(observation = {}) {
  return {
    timestamp: observation.timestamp ?? new Date().toISOString(),
    cameraRunning: Boolean(observation.cameraRunning),
    detector: observation.detector ?? "none",
    userVisible: Boolean(observation.userVisible),
    faceCount: Number.isFinite(Number(observation.faceCount)) ? Number(observation.faceCount) : null,
    userPosition: normalizeUserPosition(observation.userPosition),
    userDistance: normalizeObservationValue(observation.userDistance),
    note: normalizeObservationValue(observation.note)
  };
}
