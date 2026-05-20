import { MOVEMENTS } from "./movementCatalog.js";

const SCENARIO_DEFINITIONS = Object.freeze({
  still: Object.freeze({
    name: "still",
    description: "Hold still and keep the face attentive.",
    movement: Object.freeze([MOVEMENTS.still]),
    requiresCamera: false,
    requiresMotion: false,
    animationMs: 160
  }),
  ack_yes: Object.freeze({
    name: "ack_yes",
    description: "Small yes/nod acknowledgement.",
    movement: Object.freeze([MOVEMENTS.move_forward_tiny]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 260
  }),
  ack_no: Object.freeze({
    name: "ack_no",
    description: "Small no/shake acknowledgement.",
    movement: Object.freeze([MOVEMENTS.move_backward_tiny]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 280
  }),
  come_closer: Object.freeze({
    name: "come_closer",
    description: "Tiny safe forward movement.",
    movement: Object.freeze([MOVEMENTS.move_forward]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 240
  }),
  back_up: Object.freeze({
    name: "back_up",
    description: "Tiny safe backward movement.",
    movement: Object.freeze([MOVEMENTS.move_backward]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 240
  }),
  look_left: Object.freeze({
    name: "look_left",
    description: "Look left with a small safe turn.",
    movement: Object.freeze([MOVEMENTS.look_left]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 260
  }),
  look_right: Object.freeze({
    name: "look_right",
    description: "Look right with a small safe turn.",
    movement: Object.freeze([MOVEMENTS.look_right]),
    requiresCamera: false,
    requiresMotion: true,
    animationMs: 260
  }),
  body_talking: Object.freeze({
    name: "body_talking",
    description: "Add gentle body language during casual conversation.",
    movement: Object.freeze([
      MOVEMENTS.look_left,
      MOVEMENTS.look_right,
      MOVEMENTS.move_forward_tiny,
      MOVEMENTS.move_backward_tiny
    ]),
    requiresCamera: false,
    requiresMotion: true,
    iterateMovement: true,
    animationMs: 700
  }),
  take_picture: Object.freeze({
    name: "take_picture",
    description: "Take a local camera photo of the user and show a small preview.",
    movement: Object.freeze([MOVEMENTS.move_backward]),
    requiresCamera: true,
    requiresMotion: true,
    animationMs: 2400,
    captureDelayMs: 1550,
    previewDismissMs: 5000
  })
});

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_DEFINITIONS));
export const SCENARIO_PROMPT_LIST = SCENARIO_NAMES.join(", ");

const MODEL_ONLY_SCENARIOS = Object.freeze({
  follow_target: Object.freeze({
    name: "follow_target",
    description: "Start local object follow for a visible target label."
  }),
  stop_following: Object.freeze({
    name: "stop_following",
    description: "Stop the active local object-follow state."
  })
});

export const MODEL_SCENARIO_NAMES = Object.freeze([
  ...SCENARIO_NAMES,
  ...Object.keys(MODEL_ONLY_SCENARIOS)
]);

export const MODEL_SCENARIO_PROMPT_LIST = Object.freeze([
  ...Object.values(SCENARIO_DEFINITIONS).map(({ name, description }) => `${name}: ${description}`),
  ...Object.values(MODEL_ONLY_SCENARIOS).map(({ name, description }) => `${name}: ${description}`)
]).join("; ");

export function normalizeScenarioName(value) {
  const name = String(value ?? "").trim();
  return SCENARIO_NAMES.includes(name) ? name : null;
}

export function normalizeRunScenarioName(value) {
  const name = String(value ?? "").trim();
  return MODEL_SCENARIO_NAMES.includes(name) ? name : null;
}

export function getScenarioDefinition(value) {
  const name = normalizeScenarioName(value);
  return name ? SCENARIO_DEFINITIONS[name] : null;
}
