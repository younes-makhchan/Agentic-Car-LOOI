export const SCENARIO_NAMES = Object.freeze([
  "take_picture"
]);

export const SCENARIO_PROMPT_LIST = SCENARIO_NAMES.join(", ");

const SCENARIO_DEFINITIONS = Object.freeze({
  take_picture: Object.freeze({
    name: "take_picture",
    description: "Take a local camera photo of the user and show a small preview.",
    movement: Object.freeze(["move_backward_tiny"]),
    requiresCamera: true,
    requiresMotion: true,
    animationMs: 2400,
    captureDelayMs: 1550,
    previewDismissMs: 5000
  })
});

export function normalizeScenarioName(value) {
  const name = String(value ?? "").trim();
  return SCENARIO_NAMES.includes(name) ? name : null;
}

export function getScenarioDefinition(value) {
  const name = normalizeScenarioName(value);
  return name ? SCENARIO_DEFINITIONS[name] : null;
}
