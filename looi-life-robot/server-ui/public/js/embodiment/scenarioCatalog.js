import { MOVEMENTS } from "./movementCatalog.js";
import { photoPoseAndCapture } from "./scenarioActions/photoPoseAndCapture.js";
import { finishDrink, openDrink } from "./scenarioActions/drinkingActions.js";
import { finishBurger, takeBite } from "./scenarioActions/eatingActions.js";
import { showQuestion } from "./scenarioActions/questionActions.js";
import { showAngry } from "./scenarioActions/angryActions.js";
import { showLoving } from "./scenarioActions/lovingActions.js";
import { showShocked } from "./scenarioActions/shockedActions.js";
import { finishTellMeAboutYourself, showTellMeAboutYourself } from "./scenarioActions/tellMeAboutYourselfActions.js";
import { showKiss } from "./scenarioActions/kissActions.js";

const PERMISSIONS = Object.freeze({
  none: Object.freeze({ motion: false, camera: false }),
  motion: Object.freeze({ motion: true, camera: false }),
  cameraWithOptionalMotion: Object.freeze({ motion: "optional", camera: true })
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
  eating: scenario({
    name: "eating",
    description: "Show LOOI eating a burger when the user is eating or asks LOOI to eat.",
    permissions: PERMISSIONS.none,
    lifecycle: {
      exitScenario: "finish_burger",
      exitPolicy: "auto_before_next",
      isActive: ({ face } = {}) => face?.isEatingActive?.() === true
    },
    sequence: [
      {
        type: "action",
        action: takeBite,
        args: {
          durationMs: 3200
        }
      }
    ]
  }),
  finish_burger: scenario({
    name: "finish_burger",
    description: "Finish and clear the active eating animation before doing something else.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: finishBurger,
        args: {
          durationMs: 2200
        }
      }
    ]
  }),
  drinking: scenario({
    name: "drinking",
    description: "Show LOOI drinking cola from a straw when the user is drinking coffee, water, juice, or another drink.",
    permissions: PERMISSIONS.none,
    lifecycle: {
      exitScenario: "finish_drink",
      exitPolicy: "auto_before_next",
      isActive: ({ face } = {}) => face?.isDrinkingActive?.() === true
    },
    sequence: [
      {
        type: "action",
        action: openDrink,
        args: {
          durationMs: 1600
        }
      }
    ]
  }),
  finish_drink: scenario({
    name: "finish_drink",
    description: "Finish and clear the active drinking animation before doing something else.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: finishDrink,
        args: {
          durationMs: 1800
        }
      }
    ]
  }),
  question: scenario({
    name: "question",
    description: "Show a question mark when LOOI is confused.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: showQuestion,
        args: {
          durationMs: 2200
        }
      }
    ]
  }),
  angry: scenario({
    name: "angry",
    description: "Show an angry/frustrated face animation when LOOI feels angry or frustrated.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: showAngry,
        args: {
          durationMs: 1800
        }
      }
    ]
  }),
  loving: scenario({
    name: "loving",
    description: "Show a loving heart animation when LOOI feels sweet, appreciative, loved, or cute.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: showLoving,
        args: {
          durationMs: 2400
        }
      }
    ]
  }),
  shocked: scenario({
    name: "shocked",
    description: "Show a shocked exclamation animation when LOOI is alarmed, surprised, or has a realization.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: showShocked,
        args: {
          durationMs: 1700
        }
      }
    ]
  }),
  tell_me_about_yourself: scenario({
    name: "tell_me_about_yourself",
    description: "Start and hold a self-introduction/interview animation while LOOI introduces itself or tells the user about itself.",
    permissions: PERMISSIONS.none,
    lifecycle: {
      exitScenario: "finish_telling",
      exitPolicy: "auto_before_next",
      isActive: ({ face } = {}) => face?.isTellingActive?.() === true
    },
    sequence: [
      {
        type: "action",
        action: showTellMeAboutYourself,
        args: {
          durationMs: 1400
        }
      }
    ]
  }),
  finish_telling: scenario({
    name: "finish_telling",
    description: "Finish and clear the active self-introduction/interview animation.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: finishTellMeAboutYourself,
        args: {
          durationMs: 1200
        }
      }
    ]
  }),
  kiss: scenario({
    name: "kiss",
    description: "Show a blown-kiss animation when live vision estimates a person's face is very close, roughly filling 80% or more of the frame, only while LOOI is not speaking.",
    permissions: PERMISSIONS.none,
    sequence: [
      {
        type: "action",
        action: showKiss,
        args: {
          durationMs: 2600
        }
      }
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

const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIO_DEFINITIONS));
const MODEL_VISIBLE_SCENARIOS = Object.freeze(
  Object.values(SCENARIO_DEFINITIONS).filter((definition) => definition.modelVisible !== false)
);

const MODEL_ONLY_SCENARIOS = Object.freeze({
  follow_target: Object.freeze({
    name: "follow_target",
    description: "Start local object follow for a visible target label.",
    lifecycle: Object.freeze({
      exitScenario: "stop_following",
      exitPolicy: "auto_before_next",
      isActive: ({ followTargetController } = {}) => followTargetController?.isRunning?.() === true
    })
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

export function getActiveScenarioLifecycles(context = {}) {
  return [
    ...Object.values(SCENARIO_DEFINITIONS),
    ...Object.values(MODEL_ONLY_SCENARIOS)
  ]
    .map((definition) => buildActiveLifecycle(definition, context))
    .filter(Boolean);
}

function scenario({
  name,
  description,
  permissions = PERMISSIONS.none,
  sequence = [],
  cooldownMs = 0,
  interruptible = true,
  modelVisible = true,
  lifecycle = null,
  execution = "parallel"
}) {
  return Object.freeze({
    name,
    description,
    permissions,
    execution: normalizeScenarioExecution(execution),
    sequence: Object.freeze(sequence.map((frame) => Object.freeze({ ...frame }))),
    cooldownMs,
    interruptible,
    modelVisible,
    lifecycle: freezeLifecycle(lifecycle)
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

function normalizeScenarioExecution(value) {
  return value === "blocking" ? "blocking" : "parallel";
}

function buildActiveLifecycle(definition, context) {
  const lifecycle = definition?.lifecycle;
  if (!lifecycle || typeof lifecycle.isActive !== "function") {
    return null;
  }

  try {
    if (!lifecycle.isActive(context)) {
      return null;
    }
  } catch (_error) {
    return null;
  }

  return Object.freeze({
    name: definition.name,
    exitScenario: lifecycle.exitScenario,
    exitPolicy: lifecycle.exitPolicy
  });
}

function freezeLifecycle(lifecycle) {
  if (!lifecycle || typeof lifecycle !== "object") {
    return null;
  }

  return Object.freeze({
    exitScenario: String(lifecycle.exitScenario ?? "").trim(),
    exitPolicy: lifecycle.exitPolicy === "explicit_only" ? "explicit_only" : "auto_before_next",
    isActive: lifecycle.isActive
  });
}
