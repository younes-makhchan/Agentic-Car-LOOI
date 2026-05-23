import {
  DEFAULT_PERSONALITY_PROFILE,
  clampPersonalityProfile,
  createPersonalityProfile
} from "./personalityProfile.js";

const STORAGE_KEY = "looi.personalityProfile.v1";

export class PersonalityTuning {
  constructor({ storageKey = STORAGE_KEY, logger } = {}) {
    this.storageKey = storageKey;
    this.logger = logger;
    this.profile = createPersonalityProfile();
    this.callbacks = new Set();
  }

  getProfile() {
    return structuredCloneSafe(this.profile);
  }

  patchProfile(partial = {}) {
    this.profile = createPersonalityProfile({
      ...this.profile,
      ...safeObject(partial),
      coreTraits: {
        ...this.profile.coreTraits,
        ...safeObject(partial.coreTraits)
      },
      behaviorStyle: {
        ...this.profile.behaviorStyle,
        ...safeObject(partial.behaviorStyle)
      },
      speechStyle: {
        ...this.profile.speechStyle,
        ...safeObject(partial.speechStyle)
      },
      boundaries: {
        ...this.profile.boundaries,
        ...safeObject(partial.boundaries)
      }
    });
    this.emitChange();
    return this.getProfile();
  }

  patchTrait(name, value) {
    if (!Object.hasOwn(DEFAULT_PERSONALITY_PROFILE.coreTraits, name)) {
      return this.getProfile();
    }

    return this.patchProfile({
      coreTraits: {
        [name]: value
      }
    });
  }

  patchBehaviorStyle(name, value) {
    if (!Object.hasOwn(DEFAULT_PERSONALITY_PROFILE.behaviorStyle, name)) {
      return this.getProfile();
    }

    return this.patchProfile({
      behaviorStyle: {
        [name]: value
      }
    });
  }

  resetDefaults() {
    this.profile = createPersonalityProfile();
    this.emitChange();
    return this.getProfile();
  }

  load() {
    try {
      const raw = globalThis.localStorage?.getItem?.(this.storageKey);

      if (raw) {
        this.profile = clampPersonalityProfile(JSON.parse(raw));
      }
    } catch (error) {
      this.log(`Personality load failed: ${error.message}`, "warn");
      this.profile = createPersonalityProfile();
    }

    this.emitChange();
    return this.getProfile();
  }

  save() {
    const json = this.exportJson();
    globalThis.localStorage?.setItem?.(this.storageKey, json);
    return json;
  }

  exportJson() {
    return JSON.stringify(this.profile, null, 2);
  }

  importJson(json) {
    const value = typeof json === "string" ? JSON.parse(json) : json;
    this.profile = clampPersonalityProfile(value);
    this.emitChange();
    return this.getProfile();
  }

  onChange(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  emitChange() {
    const profile = this.getProfile();
    this.callbacks.forEach((callback) => callback(profile));
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

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
