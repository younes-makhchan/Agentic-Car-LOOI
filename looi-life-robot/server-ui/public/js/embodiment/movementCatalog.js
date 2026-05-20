const MAX_MOVEMENT_ITEMS = 6;
const MAX_MOVEMENT_FRAMES = 12;

export const MOVEMENTS = Object.freeze({
  still: Object.freeze([]),
  move_forward: Object.freeze([
    face("attentive", 0.76, "center", 50),
    motion(0.05, 0, 300, "scenario_forward")
  ]),
  move_backward: Object.freeze([
    face("shy", 0.7, "down", 60),
    motion(-0.05, 0, 300, "scenario_back")
  ]),
  move_forward_tiny: Object.freeze([
    face("attentive", 0.76, "center", 50),
    motion(0.05, 0, 130, "scenario_tiny_forward")
  ]),
  move_backward_tiny: Object.freeze([
    face("shy", 0.7, "down", 60),
    motion(-0.05, 0, 130, "scenario_tiny_back")
  ]),
  look_left: Object.freeze([
    face("attentive", 0.74, "left", 90),
    motion(0, -0.055, 170, "scenario_tiny_turn_left")
  ]),
  look_right: Object.freeze([
    face("attentive", 0.74, "right", 90),
    motion(0, 0.055, 170, "scenario_tiny_turn_right")
  ]),
});

const MOVEMENT_BY_FRAMES = new Map(
  Object.entries(MOVEMENTS).map(([name, frames]) => [frames, name])
);

export function compileMovementFrames(input, { iterate = false } = {}) {
  const entries = toMovementEntries(input);
  const accepted = [];
  const ignored = [];
  const movementFrames = [];

  const repeatCount = iterate ? 2 : 1;

  for (let index = 0; index < repeatCount; index += 1) {
    entries.slice(0, MAX_MOVEMENT_ITEMS).forEach((entry) => {
      if (entry.ignored) {
        if (index === 0) {
          ignored.push(entry.ignored);
        }
        return;
      }

      if (entry.name && index === 0) {
        accepted.push(entry.name);
      }

      movementFrames.push(...entry.frames.map((frame) => ({ allowSkip: true, ...frame })));
    });

    if (movementFrames.length >= MAX_MOVEMENT_FRAMES) {
      break;
    }
  }

  return {
    names: accepted,
    ignored,
    frames: movementFrames.slice(0, MAX_MOVEMENT_FRAMES),
    requestedMotion: movementFrames.some((frame) => frame.type === "motion")
  };
}

export function movementRequestsMotion(input, options = {}) {
  return compileMovementFrames(input, options).requestedMotion;
}

export function movementNamesFor(input) {
  return toMovementEntries(input)
    .map((entry) => entry.name)
    .filter(Boolean)
    .slice(0, MAX_MOVEMENT_ITEMS);
}

function toMovementEntries(input) {
  const directName = MOVEMENT_BY_FRAMES.get(input);
  if (directName) {
    return [{ name: directName, frames: input }];
  }

  const values = Array.isArray(input) ? input : [input];
  return values
    .flatMap((value) => {
      if (typeof value === "string") {
        return value
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => MOVEMENTS[name]
            ? { name, frames: MOVEMENTS[name] }
            : { ignored: name });
      }

      if (Array.isArray(value)) {
        const knownName = MOVEMENT_BY_FRAMES.get(value);
        if (knownName) {
          return [{ name: knownName, frames: value }];
        }

        if (value.every(isMovementFrame)) {
          return [{ name: null, frames: value }];
        }

        return toMovementEntries(value);
      }

      if (isMovementFrame(value)) {
        return [{ name: null, frames: [value] }];
      }

      return [];
    })
    .slice(0, MAX_MOVEMENT_ITEMS);
}

function isMovementFrame(value) {
  return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

function face(expression, intensity, eyeDirection, durationMs) {
  return {
    type: "face",
    expression,
    intensity,
    eyeDirection,
    durationMs
  };
}

function motion(linear, angular, durationMs, label) {
  return {
    type: "motion",
    linear,
    angular,
    durationMs,
    rampMs: 90,
    label,
    allowSkip: true
  };
}
