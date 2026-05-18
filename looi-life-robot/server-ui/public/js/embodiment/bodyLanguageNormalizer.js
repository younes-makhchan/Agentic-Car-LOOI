const MAX_BODY_LANGUAGE_ITEMS = 6;
const MAX_BODY_LANGUAGE_FRAMES = 12;

export const BODY_LANGUAGE_ACTIONS = Object.freeze([
  {
    name: "still",
    description: "No body movement; use when speech should be calm or motion is unnecessary."
  },
  {
    name: "tiny_wiggle",
    description: "Small happy left/right body wiggle."
  },
  {
    name: "tiny_yes",
    description: "Small yes/nod illusion."
  },
  {
    name: "tiny_no",
    description: "Small no/shake illusion."
  },
  {
    name: "tiny_forward",
    description: "Very small forward lean/step."
  },
  {
    name: "tiny_back",
    description: "Very small shy backward lean/step."
  },
  {
    name: "look_left",
    description: "Eyes left with optional tiny left body turn."
  },
  {
    name: "look_right",
    description: "Eyes right with optional tiny right body turn."
  },
  {
    name: "look_up",
    description: "Eyes up, curious face only."
  },
  {
    name: "look_down",
    description: "Eyes down, shy/calm face only."
  },
  {
    name: "curious_shift",
    description: "Small curious left/right attention shift."
  },
  {
    name: "soft_recenter",
    description: "Return eyes/face to center."
  }
]);

export const BODY_LANGUAGE_ACTION_NAMES = Object.freeze(
  BODY_LANGUAGE_ACTIONS.map((action) => action.name)
);

export const BODY_LANGUAGE_PROMPT_LIST = BODY_LANGUAGE_ACTIONS
  .map((action) => `${action.name}: ${action.description}`)
  .join("; ");

export function normalizeBodyLanguage(input, { iterate = false } = {}) {
  const phrases = normalizePhraseList(input);
  const entries = [];
  const ignored = [];

  phrases.slice(0, MAX_BODY_LANGUAGE_ITEMS).forEach((phrase) => {
    const entry = phraseToEntry(phrase);
    if (entry) {
      entries.push(entry);
    } else {
      ignored.push(phrase);
    }
  });

  const repeatCount = iterate ? 2 : 1;
  const frames = [];

  for (let index = 0; index < repeatCount; index += 1) {
    entries.forEach((entry) => {
      frames.push(...entry.frames.map((frame) => ({ ...frame })));
    });

    if (frames.length >= MAX_BODY_LANGUAGE_FRAMES) {
      break;
    }
  }

  return {
    entries,
    ignored,
    frames: frames.slice(0, MAX_BODY_LANGUAGE_FRAMES),
    requestedMotion: frames.some((frame) => frame.type === "motion")
  };
}

export function normalizePhraseList(input) {
  const values = Array.isArray(input) ? input : [input];
  return values
    .flatMap((value) => String(value ?? "").split(/[,\n]/g))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/[_-]+/g, " ").replace(/\s+/g, " "))
    .slice(0, MAX_BODY_LANGUAGE_ITEMS);
}

function phraseToEntry(phrase) {
  if (/^(none|still|stillness|stay still|no movement|no body language)$/.test(phrase)) {
    return bodyEntry("still", phrase, []);
  }

  if (/\b(wiggle|happy wiggle|tiny wiggle|playful)\b/.test(phrase)) {
    return bodyEntry("tiny_wiggle", phrase, [
      face("happy", 0.82, "center", 60),
      motion(0, -0.07, 100, "perform_tiny_wiggle_left"),
      motion(0, 0.07, 100, "perform_tiny_wiggle_right")
    ]);
  }

  if (/\b(nod|yes|tiny yes|agree)\b/.test(phrase)) {
    return bodyEntry("tiny_yes", phrase, [
      face("happy", 0.68, "down", 70),
      motion(0.04, 0, 95, "perform_tiny_yes_forward"),
      motion(-0.035, 0, 95, "perform_tiny_yes_back")
    ]);
  }

  if (/\b(no|shake|tiny no|disagree)\b/.test(phrase)) {
    return bodyEntry("tiny_no", phrase, [
      face("shy", 0.62, "left", 70),
      motion(0, -0.06, 90, "perform_tiny_no_left"),
      face("shy", 0.62, "right", 70),
      motion(0, 0.06, 90, "perform_tiny_no_right")
    ]);
  }

  if (/\b(tiny forward|little forward|lean forward|move forward|forward)\b/.test(phrase)) {
    return bodyEntry("tiny_forward", phrase, [
      face("attentive", 0.76, "center", 50),
      motion(0.05, 0, 130, "perform_tiny_forward")
    ]);
  }

  if (/\b(tiny back|little back|lean back|shy back|backward|back)\b/.test(phrase)) {
    return bodyEntry("tiny_back", phrase, [
      face("shy", 0.7, "down", 60),
      motion(-0.05, 0, 130, "perform_tiny_back")
    ]);
  }

  if (/\b(turn left|look left|glance left|left)\b/.test(phrase)) {
    return bodyEntry("look_left", phrase, [
      face("attentive", 0.74, "left", 90),
      motion(0, -0.055, 90, "perform_tiny_turn_left")
    ]);
  }

  if (/\b(turn right|look right|glance right|right)\b/.test(phrase)) {
    return bodyEntry("look_right", phrase, [
      face("attentive", 0.74, "right", 90),
      motion(0, 0.055, 90, "perform_tiny_turn_right")
    ]);
  }

  if (/\b(look up|glance up|up)\b/.test(phrase)) {
    return bodyEntry("look_up", phrase, [
      face("curious", 0.76, "up", 120)
    ]);
  }

  if (/\b(look down|glance down|down)\b/.test(phrase)) {
    return bodyEntry("look_down", phrase, [
      face("shy", 0.68, "down", 120)
    ]);
  }

  if (/\b(curious shift|curious|scan|look around)\b/.test(phrase)) {
    return bodyEntry("curious_shift", phrase, [
      face("curious", 0.82, "left", 90),
      motion(0, -0.055, 90, "perform_curious_shift_left"),
      face("curious", 0.82, "right", 90),
      motion(0, 0.055, 90, "perform_curious_shift_right")
    ]);
  }

  if (/\b(recenter|center|soft recenter|settle)\b/.test(phrase)) {
    return bodyEntry("soft_recenter", phrase, [
      face("attentive", 0.72, "center", 100)
    ]);
  }

  return null;
}

function bodyEntry(name, phrase, frames) {
  return {
    name,
    phrase,
    frames: frames.map((frame) => ({ allowSkip: true, ...frame }))
  };
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
