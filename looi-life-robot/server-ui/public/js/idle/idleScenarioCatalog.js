export const IDLE_SCENARIO_GLOBAL_DEFAULTS = Object.freeze({
  speedScale: 1,
  durationScale: 1,
  rampMs: 50,
  angularSign: 1
});

export const IDLE_SCENARIOS = Object.freeze([
  idleScenario({
    id: "idle_shift_right_back_left_front",
    title: "Soft Left-Forward Twist",
    description: "Left wheel forward, right wheel backward stronger. Balanced by Soft Right-Forward Twist.",
    pairWith: "idle_shift_right_front_left_back",
    steps: [
      move(0.3, -0.5, 125, 70),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_shift_right_front_left_back",
    title: "Soft Right-Forward Twist",
    description: "Left wheel backward stronger, right wheel forward. Balanced by Soft Left-Forward Twist.",
    pairWith: "idle_shift_right_back_left_front",
    steps: [
      move(-0.5, 0.3, 125, 70),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_both_front_left_soft",
    title: "Quick Left-Forward Pivot",
    description: "Left wheel forward and right wheel backward with equal strength.",
    pairWith: "idle_custom_6",
    steps: [
      move(0.5, -0.5, 80, 90),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_both_front_tiny",
    title: "Quick Forward Pulse",
    description: "Both wheels forward for a short alive nudge.",
    pairWith: "idle_custom_7",
    steps: [
      move(0.5, 0.5, 80, 110),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_forward_then_backward",
    title: "Forward Back",
    description: "Forward pulse, then backward pulse.",
    pairWith: "",
    steps: [
      move(0.5, 0.5, 80, 175),
      move(-0.5, -0.5, 80, 175)
    ]
  }),
  idleScenario({
    id: "idle_custom_6",
    title: "Quick Right-Forward Pivot",
    description: "Left wheel backward and right wheel forward with equal strength.",
    pairWith: "idle_both_front_left_soft",
    steps: [
      move(-0.5, 0.5, 80, 90),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_custom_7",
    title: "Quick Backward Pulse",
    description: "Both wheels backward for a short balancing nudge.",
    pairWith: "idle_both_front_tiny",
    steps: [
      move(-0.5, -0.5, 80, 90),
      stop(120)
    ]
  }),
  idleScenario({
    id: "idle_custom_8",
    title: "Forward Back Slow",
    description: "Forward/backward pulse with a longer forward pause.",
    pairWith: "",
    steps: [
      move(0.5, 0.5, 80, 250),
      move(-0.5, -0.5, 80, 120)
    ]
  }),
  idleScenario({
    id: "multi_forward_back",
    title: "Multi Forward Back",
    description: "Forward Back, Forward Back Slow, then Forward Back again.",
    pairWith: "",
    steps: [
      move(0.5, 0.5, 80, 175),
      move(-0.5, -0.5, 80, 175),
      move(0.5, 0.5, 80, 250),
      move(-0.5, -0.5, 80, 120),
      move(0.5, 0.5, 80, 175),
      move(-0.5, -0.5, 80, 175)
    ]
  })
]);

export const IDLE_SCENARIO_ORDER = Object.freeze(IDLE_SCENARIOS.map((scenario) => scenario.id));

export function cloneIdleScenarios() {
  return IDLE_SCENARIOS.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.map((step) => ({ ...step }))
  }));
}

export function getIdleScenarioById(id) {
  return IDLE_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

function idleScenario({ id, title, description, pairWith = "", steps = [] }) {
  return Object.freeze({
    id,
    title,
    description,
    pairWith,
    steps: Object.freeze(steps.map((step) => Object.freeze({ ...step })))
  });
}

function move(left, right, durationMs, pauseMs) {
  return {
    kind: "move",
    left,
    right,
    durationMs,
    pauseMs
  };
}

function stop(pauseMs) {
  return {
    kind: "stop",
    left: 0,
    right: 0,
    durationMs: 0,
    pauseMs
  };
}
