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
