const MAX_MOVEMENT_ITEMS = 6;
const MAX_MOVEMENT_FRAMES = 12;

export const MOVEMENT_ACTION_NAMES = Object.freeze([
  "still",
  "excited_wiggle",
  "gentle_wiggle",
  "tiny_yes",
  "tiny_no",
  "move_forward_tiny",
  "move_backward_tiny",
  "look_left",
  "look_right",
  "look_up",
  "look_down",
  "curious_shift",
  "soft_recenter"
]);

export const MOVEMENT_PROMPT_LIST = MOVEMENT_ACTION_NAMES.join(", ");

const MOVEMENT_DEFINITIONS = Object.freeze({
  still: [],
  excited_wiggle: [
    face("happy", 0.9, "center", 55),
    motion(0, -0.08, 105, "perform_excited_wiggle_left"),
    motion(0, 0.08, 105, "perform_excited_wiggle_right")
  ],
  gentle_wiggle: [
    face("happy", 0.72, "center", 70),
    motion(0, -0.045, 95, "perform_gentle_wiggle_left"),
    motion(0, 0.045, 95, "perform_gentle_wiggle_right")
  ],
  tiny_yes: [
    face("happy", 0.68, "down", 70),
    motion(0.04, 0, 95, "perform_tiny_yes_forward"),
    motion(-0.035, 0, 95, "perform_tiny_yes_back")
  ],
  tiny_no: [
    face("shy", 0.62, "left", 70),
    motion(0, -0.06, 90, "perform_tiny_no_left"),
    face("shy", 0.62, "right", 70),
    motion(0, 0.06, 90, "perform_tiny_no_right")
  ],
  move_forward_tiny: [
    face("attentive", 0.76, "center", 50),
    motion(0.05, 0, 130, "perform_tiny_forward")
  ],
  move_backward_tiny: [
    face("shy", 0.7, "down", 60),
    motion(-0.05, 0, 130, "perform_tiny_back")
  ],
  look_left: [
    face("attentive", 0.74, "left", 90),
    motion(0, -0.055, 90, "perform_tiny_turn_left")
  ],
  look_right: [
    face("attentive", 0.74, "right", 90),
    motion(0, 0.055, 90, "perform_tiny_turn_right")
  ],
  look_up: [
    face("curious", 0.76, "up", 120)
  ],
  look_down: [
    face("shy", 0.68, "down", 120)
  ],
  curious_shift: [
    face("curious", 0.82, "left", 90),
    motion(0, -0.055, 90, "perform_curious_shift_left"),
    face("curious", 0.82, "right", 90),
    motion(0, 0.055, 90, "perform_curious_shift_right")
  ],
  soft_recenter: [
    face("attentive", 0.72, "center", 100)
  ]
});

export function compileMovementFrames(input, { iterate = false } = {}) {
  const names = toMovementNames(input);
  const accepted = [];
  const ignored = [];

  names.slice(0, MAX_MOVEMENT_ITEMS).forEach((name) => {
    const frames = MOVEMENT_DEFINITIONS[name];

    if (frames) {
      accepted.push(name);
    } else {
      ignored.push(name);
    }
  });

  const repeatCount = iterate ? 2 : 1;
  const frames = [];

  for (let index = 0; index < repeatCount; index += 1) {
    accepted.forEach((name) => {
      frames.push(...MOVEMENT_DEFINITIONS[name].map((frame) => ({ allowSkip: true, ...frame })));
    });

    if (frames.length >= MAX_MOVEMENT_FRAMES) {
      break;
    }
  }

  return {
    names: accepted,
    ignored,
    frames: frames.slice(0, MAX_MOVEMENT_FRAMES),
    requestedMotion: frames.some((frame) => frame.type === "motion")
  };
}

export function movementRequestsMotion(input, options = {}) {
  return compileMovementFrames(input, options).requestedMotion;
}

function toMovementNames(input) {
  const values = Array.isArray(input) ? input : [input];
  return values
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_MOVEMENT_ITEMS);
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
