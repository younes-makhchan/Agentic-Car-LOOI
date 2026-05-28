import { clampNumber } from "../core/runtimeUtils.js";

const STORAGE_KEY = "looi.bodyCalibration.v1";

const DEFAULT_BODY_CALIBRATION = {
  maxSpeed: 0.5,
  gentleSpeed: 0.18,
  turnSpeed: 0.18,
  wiggleSpeed: 0.2,
  approachTinyMs: 220,
  approachShortMs: 450,
  approachMediumMs: 700,
  retreatTinyMs: 220,
  retreatShortMs: 450,
  curiousScanMs: 260,
  wiggleMs: 180,
  rampMs: 150,
  leftTrim: 1.0,
  rightTrim: 1.0,
  deadband: 0.03,
  minPwm: 210,
  motionIntensityScale: 1.0,
  idleMotionEnabled: true
};

export class BodyCalibration {
  constructor({ storageKey = STORAGE_KEY, logger } = {}) {
    this.storageKey = storageKey;
    this.logger = logger;
    this.settings = { ...DEFAULT_BODY_CALIBRATION };
    this.callbacks = new Set();
  }

  getSettings() {
    return { ...this.settings };
  }

  resetDefaults() {
    this.settings = { ...DEFAULT_BODY_CALIBRATION };
    this.emitChange();
    return this.getSettings();
  }

  load() {
    try {
      const raw = globalThis.localStorage?.getItem?.(this.storageKey);
      if (!raw) {
        this.settings = normalizeSettings(this.settings);
        return this.getSettings();
      }

      const savedSettings = JSON.parse(raw);
      if (savedSettings.maxSpeed === 0.4) {
        savedSettings.maxSpeed = DEFAULT_BODY_CALIBRATION.maxSpeed;
      }
      this.settings = normalizeSettings({
        ...DEFAULT_BODY_CALIBRATION,
        ...savedSettings
      });
      this.emitChange();
    } catch (error) {
      this.log(`Calibration load failed: ${error.message}`, "warn");
      this.settings = { ...DEFAULT_BODY_CALIBRATION };
    }

    return this.getSettings();
  }

  save() {
    const json = this.exportJson();
    globalThis.localStorage?.setItem?.(this.storageKey, json);
    return json;
  }

  exportJson() {
    return JSON.stringify(this.settings, null, 2);
  }

  importJson(json) {
    const value = typeof json === "string" ? JSON.parse(json) : json;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Calibration import requires an object.");
    }

    this.settings = normalizeSettings({
      ...DEFAULT_BODY_CALIBRATION,
      ...value
    });
    this.emitChange();
    return this.getSettings();
  }

  buildEsp32Config() {
    const settings = this.getSettings();

    return {
      max_speed: settings.maxSpeed,
      left_trim: settings.leftTrim,
      right_trim: settings.rightTrim,
      deadband: settings.deadband,
      default_ramp_ms: settings.rampMs,
      min_pwm: settings.minPwm
    };
  }

  async applyToRobot(robotClient) {
    if (!robotClient?.isConnected?.()) {
      return {
        ok: false,
        reason: "robot_not_connected",
        config: this.buildEsp32Config()
      };
    }

    if (typeof robotClient.sendConfigUpdate !== "function") {
      return {
        ok: false,
        reason: "robot_config_update_unavailable",
        config: this.buildEsp32Config()
      };
    }

    const config = this.buildEsp32Config();
    const id = robotClient.sendConfigUpdate(config);

    return {
      ok: true,
      id,
      config
    };
  }

  onChange(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  emitChange() {
    const settings = this.getSettings();
    this.callbacks.forEach((callback) => callback(settings));
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

function normalizeSettings(settings = {}) {
  return {
    maxSpeed: clampNumber(settings.maxSpeed, 0.05, 0.5, DEFAULT_BODY_CALIBRATION.maxSpeed),
    gentleSpeed: clampNumber(settings.gentleSpeed, 0.05, 0.4, DEFAULT_BODY_CALIBRATION.gentleSpeed),
    turnSpeed: clampNumber(settings.turnSpeed, 0.05, 0.4, DEFAULT_BODY_CALIBRATION.turnSpeed),
    wiggleSpeed: clampNumber(settings.wiggleSpeed, 0.05, 0.4, DEFAULT_BODY_CALIBRATION.wiggleSpeed),
    approachTinyMs: clampRound(settings.approachTinyMs, 50, 1000, DEFAULT_BODY_CALIBRATION.approachTinyMs),
    approachShortMs: clampRound(settings.approachShortMs, 50, 1000, DEFAULT_BODY_CALIBRATION.approachShortMs),
    approachMediumMs: clampRound(settings.approachMediumMs, 50, 1000, DEFAULT_BODY_CALIBRATION.approachMediumMs),
    retreatTinyMs: clampRound(settings.retreatTinyMs, 50, 1000, DEFAULT_BODY_CALIBRATION.retreatTinyMs),
    retreatShortMs: clampRound(settings.retreatShortMs, 50, 1000, DEFAULT_BODY_CALIBRATION.retreatShortMs),
    curiousScanMs: clampRound(settings.curiousScanMs, 50, 1000, DEFAULT_BODY_CALIBRATION.curiousScanMs),
    wiggleMs: clampRound(settings.wiggleMs, 50, 1000, DEFAULT_BODY_CALIBRATION.wiggleMs),
    rampMs: clampRound(settings.rampMs, 0, 500, DEFAULT_BODY_CALIBRATION.rampMs),
    leftTrim: clampNumber(settings.leftTrim, 0.5, 1.3, DEFAULT_BODY_CALIBRATION.leftTrim),
    rightTrim: clampNumber(settings.rightTrim, 0.5, 1.3, DEFAULT_BODY_CALIBRATION.rightTrim),
    deadband: clampNumber(settings.deadband, 0, 0.12, DEFAULT_BODY_CALIBRATION.deadband),
    minPwm: clampRound(settings.minPwm, 0, 255, DEFAULT_BODY_CALIBRATION.minPwm),
    motionIntensityScale: clampNumber(
      settings.motionIntensityScale,
      0.2,
      1.2,
      DEFAULT_BODY_CALIBRATION.motionIntensityScale
    ),
    idleMotionEnabled: settings.idleMotionEnabled !== false
  };
}

function clampRound(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}
