const MAX_SPEED = 0.4;
const MAX_DURATION_MS = 1000;
const MIN_DURATION_MS = 50;
const FIRMWARE_HARD_MAX_SPEED = 0.5;
const MAX_RAMP_MS = 500;
const TELEMETRY_INTERVAL_MS = 1000;
const CONNECT_DELAY_MS = 150;

let messageCounter = 0;

export class SimulatedESP32Client {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.connected = false;
    this.latestTelemetry = null;
    this.latestConfig = createDefaultConfig();
    this.statusCallbacks = new Set();
    this.telemetryCallbacks = new Set();
    this.messageCallbacks = new Set();
    this.ackCallbacks = new Set();
    this.configCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.telemetryTimer = null;
    this.motionTimer = null;
    this.motorState = "stopped";
    this.leftSpeed = 0;
    this.rightSpeed = 0;
    this.currentLeftSpeed = 0;
    this.currentRightSpeed = 0;
    this.targetLeftSpeed = 0;
    this.targetRightSpeed = 0;
    this.rampMs = this.latestConfig.default_ramp_ms;
    this.motionLabel = "";
    this.motionEndAt = 0;
    this.lastCommandAt = null;
    this.clients = 1;
    this.simulatedRssi = -42;
    this.battery = null;
    this.startedAt = Date.now();
    this.lastMessageAt = null;
    this.lastPongAt = null;
  }

  connect() {
    if (this.connected) {
      this.emitStatus();
      return Promise.resolve(this.getStatus());
    }

    this.log("Simulator connecting...");
    this.emitStatus("connecting");

    return new Promise((resolve) => {
      globalThis.setTimeout(() => {
        this.connected = true;
        this.startedAt = Date.now();
        this.startTelemetry();
        this.emitStatus();
        this.emitTelemetry();
        this.log("Simulator connected. Motor commands are simulated only.");
        resolve(this.getStatus());
      }, CONNECT_DELAY_MS);
    });
  }

  disconnect() {
    this.stopMotors("simulator_disconnect", false);
    this.connected = false;
    this.stopTelemetry();
    this.latestTelemetry = null;
    this.emitStatus();
    this.log("Simulator disconnected.");
  }

  isConnected() {
    return this.connected;
  }

  getStatus() {
    return {
      url: "simulated",
      connected: this.connected,
      readyState: this.connected ? 1 : 3,
      state: this.connected ? "simulated_connected" : "disconnected",
      lastMessageAt: this.lastMessageAt,
      lastPongAt: this.lastPongAt,
      simulated: true
    };
  }

  getLatestTelemetry() {
    return this.latestTelemetry ? { ...this.latestTelemetry } : null;
  }

  getLatestConfig() {
    return { ...this.latestConfig };
  }

  onStatus(callback) {
    return this.registerCallback(this.statusCallbacks, callback);
  }

  onTelemetry(callback) {
    return this.registerCallback(this.telemetryCallbacks, callback);
  }

  onMessage(callback) {
    return this.registerCallback(this.messageCallbacks, callback);
  }

  onAck(callback) {
    return this.registerCallback(this.ackCallbacks, callback);
  }

  onConfig(callback) {
    return this.registerCallback(this.configCallbacks, callback);
  }

  onError(callback) {
    return this.registerCallback(this.errorCallbacks, callback);
  }

  sendJson(payload) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    const message = { ...payload };

    if (!message.id) {
      message.id = createMessageId();
    }

    if (message.type === "motion") {
      return this.sendMotion({
        id: message.id,
        linear: message.linear,
        angular: message.angular,
        durationMs: message.duration_ms ?? message.durationMs,
        rampMs: message.ramp_ms ?? message.rampMs,
        label: message.label
      });
    }

    if (message.type === "stop") {
      return this.stop(message.reason ?? "simulated_stop", message.id);
    }

    if (message.type === "ping") {
      return this.ping(message.id);
    }

    if (message.type === "config_update") {
      return this.sendConfigUpdate(message, message.id);
    }

    if (message.type === "config_get") {
      return this.requestConfig(message.id);
    }

    const error = {
      id: message.id,
      type: "error",
      cmd: message.type ?? "unknown",
      message: "Unknown simulator command"
    };
    this.emitError(error);
    this.emitMessage(error);
    return message.id;
  }

  sendMotion({ id, linear = 0, angular = 0, durationMs = 300, rampMs, label = "motion" } = {}) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    const safeLinear = applyDeadband(clamp(linear, -this.latestConfig.max_speed, this.latestConfig.max_speed), this.latestConfig.deadband);
    const safeAngular = applyDeadband(clamp(angular, -this.latestConfig.max_speed, this.latestConfig.max_speed), this.latestConfig.deadband);
    const safeDurationMs = Math.round(clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS));
    const safeRampMs = Math.round(
      Math.min(clamp(rampMs ?? this.latestConfig.default_ramp_ms, 0, MAX_RAMP_MS), safeDurationMs / 2)
    );
    const leftSpeed = applyDeadband(
      clamp((safeLinear - safeAngular) * this.latestConfig.left_trim, -this.latestConfig.max_speed, this.latestConfig.max_speed),
      this.latestConfig.deadband
    );
    const rightSpeed = applyDeadband(
      clamp((safeLinear + safeAngular) * this.latestConfig.right_trim, -this.latestConfig.max_speed, this.latestConfig.max_speed),
      this.latestConfig.deadband
    );

    this.lastCommandAt = Date.now();
    this.leftSpeed = leftSpeed;
    this.rightSpeed = rightSpeed;
    this.currentLeftSpeed = leftSpeed;
    this.currentRightSpeed = rightSpeed;
    this.targetLeftSpeed = leftSpeed;
    this.targetRightSpeed = rightSpeed;
    this.rampMs = safeRampMs;
    this.motionLabel = sanitizeLabel(label);
    this.motionEndAt = this.lastCommandAt + safeDurationMs;
    this.motorState = getMotorState(leftSpeed, rightSpeed);

    clearTimeout(this.motionTimer);
    this.motionTimer = globalThis.setTimeout(() => {
      this.stopMotors("simulated_duration_complete", false);
      this.emitTelemetry();
    }, safeDurationMs);

    const ack = {
      id: id ?? createMessageId(),
      type: "ack",
      cmd: "motion",
      accepted: true,
      linear: safeLinear,
      angular: safeAngular,
      duration_ms: safeDurationMs,
      ramp_ms: safeRampMs,
      label: this.motionLabel,
      left_speed: leftSpeed,
      right_speed: rightSpeed,
      simulated: true
    };

    this.log(
      `SIM motion: linear=${safeLinear.toFixed(2)} angular=${safeAngular.toFixed(
        2
      )} duration=${safeDurationMs}ms ramp=${safeRampMs}ms label=${this.motionLabel} left=${leftSpeed.toFixed(2)} right=${rightSpeed.toFixed(2)}`
    );
    this.emitAck(ack);
    this.emitMessage(ack);
    this.emitTelemetry();

    return ack.id;
  }

  sendConfigUpdate(config = {}, id = createMessageId()) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    const { config: nextConfig, warnings } = normalizeConfig({
      ...this.latestConfig,
      ...config
    });
    this.latestConfig = nextConfig;
    this.rampMs = this.latestConfig.default_ramp_ms;

    const ack = {
      id,
      type: "ack",
      cmd: "config_update",
      accepted: true,
      config: { ...this.latestConfig },
      warnings,
      simulated: true
    };

    this.log(`SIM config_update: max=${this.latestConfig.max_speed.toFixed(2)} ramp=${this.latestConfig.default_ramp_ms}ms`);
    this.emitAck(ack);
    this.emitConfig(this.latestConfig, ack);
    this.emitMessage(ack);
    this.emitTelemetry();
    return id;
  }

  requestConfig(id = createMessageId()) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    const message = {
      id,
      type: "config",
      config: { ...this.latestConfig },
      simulated: true
    };
    this.emitConfig(this.latestConfig, message);
    this.emitMessage(message);
    return id;
  }

  stop(reason = "simulated_stop", id = createMessageId()) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    this.stopMotors(reason, true, id);
    return id;
  }

  ping(id = createMessageId()) {
    if (!this.isConnected()) {
      throw new Error("Simulator is not connected.");
    }

    this.lastPongAt = Date.now();
    const pong = {
      id,
      type: "pong",
      uptime_ms: this.getUptimeMs(),
      simulated: true
    };

    this.log(`SIM pong (${pong.uptime_ms} ms uptime).`);
    this.emitMessage(pong);
    return id;
  }

  registerCallback(store, callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    store.add(callback);
    return () => store.delete(callback);
  }

  startTelemetry() {
    this.stopTelemetry();
    this.telemetryTimer = globalThis.setInterval(() => {
      this.emitTelemetry();
    }, TELEMETRY_INTERVAL_MS);
  }

  stopTelemetry() {
    clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  stopMotors(reason, emitAck = true, id = createMessageId()) {
    clearTimeout(this.motionTimer);
    this.motionTimer = null;
    this.leftSpeed = 0;
    this.rightSpeed = 0;
    this.currentLeftSpeed = 0;
    this.currentRightSpeed = 0;
    this.targetLeftSpeed = 0;
    this.targetRightSpeed = 0;
    this.motionEndAt = 0;
    this.motionLabel = "";
    this.motorState = "stopped";
    this.lastCommandAt = Date.now();

    if (emitAck) {
      const ack = {
        id,
        type: "ack",
        cmd: "stop",
        accepted: true,
        reason,
        simulated: true
      };

      this.log(`SIM stop: ${reason}`);
      this.emitAck(ack);
      this.emitMessage(ack);
    }
  }

  buildTelemetry() {
    const now = Date.now();

    return {
      type: "telemetry",
      uptime_ms: this.getUptimeMs(),
      ap_ip: "simulated",
      rssi: this.simulatedRssi,
      clients: this.connected ? this.clients : 0,
      battery: this.battery,
      motor_state: this.motorState,
      left_speed: this.leftSpeed,
      right_speed: this.rightSpeed,
      current_left_speed: this.currentLeftSpeed,
      current_right_speed: this.currentRightSpeed,
      target_left_speed: this.targetLeftSpeed,
      target_right_speed: this.targetRightSpeed,
      ramp_ms: this.rampMs,
      motion_label: this.motionLabel,
      motion_remaining_ms: Math.max(0, this.motionEndAt - now),
      last_command_age_ms: this.lastCommandAt ? now - this.lastCommandAt : null,
      limits: {
        max_speed: this.latestConfig.max_speed,
        hard_max_speed: this.latestConfig.hard_max_speed,
        max_duration_ms: MAX_DURATION_MS
      },
      config: { ...this.latestConfig },
      simulated: true
    };
  }

  emitTelemetry() {
    if (!this.connected) {
      return;
    }

    const telemetry = this.buildTelemetry();
    this.latestTelemetry = telemetry;
    this.lastMessageAt = Date.now();
    this.telemetryCallbacks.forEach((callback) => callback(telemetry));
    this.emitMessage(telemetry);
  }

  emitStatus(stateOverride = null) {
    const status = this.getStatus();

    if (stateOverride) {
      status.state = stateOverride;
    }

    this.statusCallbacks.forEach((callback) => callback(status));
  }

  emitMessage(message) {
    this.lastMessageAt = Date.now();
    this.messageCallbacks.forEach((callback) => callback(message));
  }

  emitAck(message) {
    this.ackCallbacks.forEach((callback) => callback(message));
  }

  emitConfig(config, message = {}) {
    this.configCallbacks.forEach((callback) => callback({ ...config }, message));
  }

  emitError(error) {
    this.errorCallbacks.forEach((callback) => callback(error));
  }

  getUptimeMs() {
    return Date.now() - this.startedAt;
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

function getMotorState(leftSpeed, rightSpeed) {
  if (Math.abs(leftSpeed) < 0.001 && Math.abs(rightSpeed) < 0.001) {
    return "stopped";
  }

  if (leftSpeed > 0 && rightSpeed > 0) {
    return "moving_forward";
  }

  if (leftSpeed < 0 && rightSpeed < 0) {
    return "moving_backward";
  }

  if (leftSpeed > 0 && rightSpeed < 0) {
    return "rotating_left";
  }

  if (leftSpeed < 0 && rightSpeed > 0) {
    return "rotating_right";
  }

  return "mixed";
}

function createDefaultConfig() {
  return {
    max_speed: MAX_SPEED,
    hard_max_speed: FIRMWARE_HARD_MAX_SPEED,
    left_trim: 1.0,
    right_trim: 1.0,
    deadband: 0.03,
    default_ramp_ms: 120,
    min_pwm: 0
  };
}

function normalizeConfig(config = {}) {
  const defaults = createDefaultConfig();
  const warnings = [];
  const normalized = {
    max_speed: clampWithWarning(config.max_speed, 0.05, FIRMWARE_HARD_MAX_SPEED, defaults.max_speed, "max_speed", warnings),
    hard_max_speed: FIRMWARE_HARD_MAX_SPEED,
    left_trim: clampWithWarning(config.left_trim, 0.5, 1.3, defaults.left_trim, "left_trim", warnings),
    right_trim: clampWithWarning(config.right_trim, 0.5, 1.3, defaults.right_trim, "right_trim", warnings),
    deadband: clampWithWarning(config.deadband, 0, 0.12, defaults.deadband, "deadband", warnings),
    default_ramp_ms: Math.round(
      clampWithWarning(config.default_ramp_ms, 0, MAX_RAMP_MS, defaults.default_ramp_ms, "default_ramp_ms", warnings)
    ),
    min_pwm: Math.round(clampWithWarning(config.min_pwm, 0, 90, defaults.min_pwm, "min_pwm", warnings))
  };

  return {
    config: normalized,
    warnings
  };
}

function clampWithWarning(value, min, max, fallback, field, warnings) {
  const numericValue = Number(value);
  const requested = Number.isFinite(numericValue) ? numericValue : fallback;
  const clamped = clamp(requested, min, max);

  if (Math.abs(clamped - requested) > 0.0001) {
    warnings.push(`${field}_clamped`);
  }

  return clamped;
}

function applyDeadband(value, deadband) {
  return Math.abs(value) < Number(deadband || 0) ? 0 : value;
}

function sanitizeLabel(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "motion";
  }

  return value.trim().replace(/[^\w.-]/g, "_").slice(0, 60);
}

function clamp(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(max, Math.max(min, numericValue));
}

function createMessageId() {
  messageCounter += 1;
  return `sim-${Date.now()}-${messageCounter}`;
}
