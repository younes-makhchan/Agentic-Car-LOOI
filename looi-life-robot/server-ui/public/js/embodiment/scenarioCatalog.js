import { MOVEMENTS } from "./movementCatalog.js";
import { photoPoseAndCapture } from "./scenarioActions/photoPoseAndCapture.js";

const PERMISSIONS = Object.freeze({
  none: Object.freeze({ motion: false, camera: false, speech: false }),
  motion: Object.freeze({ motion: true, camera: false, speech: false }),
  cameraWithOptionalMotion: Object.freeze({ motion: "optional", camera: true, speech: false })
});

const SCENARIO_DEFINITIONS = Object.freeze({
  pose_neutral: scenario({
    name: "pose_neutral",
    description: "Internal neutral face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("neutral", 0.82, "center", 120)
    ]
  }),
  pose_attentive: scenario({
    name: "pose_attentive",
    description: "Internal attentive listening face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("attentive", 1, "center", 140)
    ]
  }),
  pose_curious: scenario({
    name: "pose_curious",
    description: "Internal curious thinking face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("curious", 0.9, "left", 160)
    ]
  }),
  pose_happy: scenario({
    name: "pose_happy",
    description: "Internal happy face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("happy", 0.9, "center", 180)
    ]
  }),
  pose_sleepy: scenario({
    name: "pose_sleepy",
    description: "Internal sleepy low-energy face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("sleepy", 0.9, "down", 180)
    ]
  }),
  pose_scared: scenario({
    name: "pose_scared",
    description: "Internal cautious/scared face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("scared", 1.1, "center", 180)
    ]
  }),
  pose_shy: scenario({
    name: "pose_shy",
    description: "Internal shy/soft stop face pose.",
    permissions: PERMISSIONS.none,
    modelVisible: false,
    sequence: [
      face("shy", 0.9, "down", 180)
    ]
  }),
  still: scenario({
    name: "still",
    description: "Hold still and keep the face attentive.",
    permissions: PERMISSIONS.none,
    sequence: [
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.74, durationMs: 160 }
    ]
  }),
  ack_yes: scenario({
    name: "ack_yes",
    description: "Small yes/nod acknowledgement.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.move_forward_tiny,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  ack_no: scenario({
    name: "ack_no",
    description: "Small no/shake acknowledgement.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.move_backward_tiny,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  come_closer: scenario({
    name: "come_closer",
    description: "Tiny safe forward movement.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.move_forward,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  back_up: scenario({
    name: "back_up",
    description: "Tiny safe backward movement.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.move_backward,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  look_left: scenario({
    name: "look_left",
    description: "Look left with a small safe turn.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.look_left,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  look_right: scenario({
    name: "look_right",
    description: "Look right with a small safe turn.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.look_right,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  body_talking: scenario({
    name: "body_talking",
    description: "Add gentle body language during casual conversation.",
    permissions: PERMISSIONS.motion,
    sequence: [
      ...MOVEMENTS.look_left,
      ...MOVEMENTS.look_right,
      ...MOVEMENTS.move_forward_tiny,
      ...MOVEMENTS.move_backward_tiny,
      ...MOVEMENTS.look_left,
      ...MOVEMENTS.look_right,
      ...MOVEMENTS.move_forward_tiny,
      ...MOVEMENTS.move_backward_tiny,
      { type: "face", expression: "attentive", eyeDirection: "center", intensity: 0.68, durationMs: 90 }
    ]
  }),
  take_picture: scenario({
    name: "take_picture",
    description: "Take a local camera photo of the user and show a small preview.",
    permissions: PERMISSIONS.cameraWithOptionalMotion,
    sequence: [
      {
        type: "action",
        action: photoPoseAndCapture,
        args: {
          maxWidth: 640,
          quality: 0.72,
          captureDelayMs: 1550,
          previewDismissMs: 5000
        }
      }
    ]
  })
});

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_DEFINITIONS));
export const SCENARIO_PROMPT_LIST = SCENARIO_NAMES.join(", ");
const MODEL_VISIBLE_SCENARIOS = Object.freeze(
  Object.values(SCENARIO_DEFINITIONS).filter((definition) => definition.modelVisible !== false)
);

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
  ...MODEL_VISIBLE_SCENARIOS.map(({ name }) => name),
  ...Object.keys(MODEL_ONLY_SCENARIOS)
]);

export const MODEL_SCENARIO_PROMPT_LIST = Object.freeze([
  ...MODEL_VISIBLE_SCENARIOS.map(({ name, description }) => `${name}: ${description}`),
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

function scenario({
  name,
  description,
  permissions = PERMISSIONS.none,
  sequence = [],
  cooldownMs = 0,
  interruptible = true,
  modelVisible = true
}) {
  return Object.freeze({
    name,
    description,
    permissions,
    sequence: Object.freeze(sequence.map((frame) => Object.freeze({ ...frame }))),
    cooldownMs,
    interruptible,
    modelVisible
  });
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
