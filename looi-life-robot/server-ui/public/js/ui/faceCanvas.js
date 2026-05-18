const FACE_STATE = {
  expression: "neutral",
  intensity: 1,
  eyeDirection: "center",
  speaking: false,
  sleeping: false,
  autoBlinkTimer: 0,
  animationTimer: 0,
  lookTimer: 0
};

const BLINK_TIME_MS = 360;
const SOFT_CLOSE_TIME_MS = 420;
const AUTO_BLINK_MIN_MS = 2200;
const AUTO_BLINK_JITTER_MS = 2400;

const SUPPORTED_DIRECTIONS = new Set(["center", "left", "right", "up", "down"]);

let rootRef = null;
let eyesRef = null;

export function initFaceCanvas(element) {
  rootRef = element;

  clearAllTimers();

  if (!rootRef) {
    return;
  }

  rootRef.replaceChildren(createEyeDom());
  rootRef.classList.add("looi-eye-system");
  rootRef.setAttribute("role", "img");
  rootRef.setAttribute("aria-label", "LOOI animated robot eyes");

  eyesRef = rootRef.querySelector(".looi-eyes");
  openEyes();
  scheduleNextBlink();
}

export function setExpression(expression, intensity = 1) {
  FACE_STATE.expression = normalizeExpression(expression);
  FACE_STATE.intensity = clamp(Number(intensity) || 1, 0, 1.5);
  applyExpression();
}

export function setEyeDirection(direction) {
  const nextDirection = SUPPORTED_DIRECTIONS.has(direction) ? direction : "center";
  FACE_STATE.eyeDirection = nextDirection;

  if (nextDirection === "left") {
    lookLeft();
    return;
  }

  if (nextDirection === "right") {
    lookRight();
    return;
  }

  if (nextDirection === "down") {
    softClose();
    return;
  }

  openEyes();
}

export function blink() {
  if (!eyesRef || FACE_STATE.speaking || FACE_STATE.sleeping) {
    scheduleNextBlink();
    return;
  }

  clearMomentaryAnimations();
  forceRestartAnimation();
  eyesRef.classList.add("is-blinking");
  FACE_STATE.animationTimer = window.setTimeout(clearMomentaryAnimations, BLINK_TIME_MS);
  scheduleNextBlink();
}

export function softClose() {
  if (!eyesRef || FACE_STATE.speaking || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  forceRestartAnimation();
  eyesRef.classList.add("is-soft-closing");
  FACE_STATE.animationTimer = window.setTimeout(clearMomentaryAnimations, SOFT_CLOSE_TIME_MS);
}

export function openEyes() {
  if (!eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  eyesRef.style.setProperty("--look-x", "0px");
  eyesRef.style.setProperty("--look-scale-y", "1");
  eyesRef.style.setProperty("--glow-dir", "1");
}

export function lookLeft() {
  if (!eyesRef || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  eyesRef.style.setProperty("--look-x", "-42px");
  eyesRef.style.setProperty("--look-scale-y", "0.92");
  eyesRef.style.setProperty("--glow-dir", "1");
  settleLookHeight();
}

export function lookRight() {
  if (!eyesRef || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  eyesRef.style.setProperty("--look-x", "42px");
  eyesRef.style.setProperty("--look-scale-y", "0.92");
  eyesRef.style.setProperty("--glow-dir", "1");
  settleLookHeight();
}

export function invertLook() {
  if (!eyesRef || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  eyesRef.style.setProperty("--look-scale-y", "0.94");

  const currentDirection = getComputedStyle(eyesRef).getPropertyValue("--glow-dir").trim();
  const nextDirection = currentDirection === "-1" ? "1" : "-1";

  forceRestartAnimation();
  requestAnimationFrame(() => {
    eyesRef.style.setProperty("--glow-dir", nextDirection);
    settleLookHeight();
  });
}

export function sleep() {
  if (!eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  FACE_STATE.sleeping = true;
  eyesRef.style.setProperty("--look-x", "0px");
  eyesRef.style.setProperty("--look-scale-y", "1");
  forceRestartAnimation();
  eyesRef.classList.add("is-sleeping");
}

export function setSpeaking(isSpeaking) {
  FACE_STATE.speaking = Boolean(isSpeaking);

  if (!eyesRef) {
    return;
  }

  eyesRef.classList.toggle("is-speaking", FACE_STATE.speaking);

  if (FACE_STATE.speaking) {
    clearMomentaryAnimations();
    if (FACE_STATE.sleeping) {
      openEyes();
    }
    return;
  }

  scheduleNextBlink();
}

export function setMouthOpen() {
  // The new face has no mouth layer. Speech state is represented by eye glow only.
}

export function updateFaceState(partialState = {}) {
  if (partialState.expression) {
    setExpression(partialState.expression, partialState.intensity ?? FACE_STATE.intensity);
  }

  if (partialState.eyeDirection) {
    setEyeDirection(partialState.eyeDirection);
  }

  if (typeof partialState.intensity === "number" && !partialState.expression) {
    FACE_STATE.intensity = clamp(partialState.intensity, 0, 1.5);
    applyExpression();
  }

  if (typeof partialState.speaking === "boolean") {
    setSpeaking(partialState.speaking);
  }
}

export function createFaceController(element) {
  initFaceCanvas(element);

  return {
    setExpression,
    setEyeDirection,
    setSpeaking,
    setMouthOpen,
    blink,
    softClose,
    openEyes,
    lookLeft,
    lookRight,
    invertLook,
    sleep,
    updateFaceState
  };
}

function createEyeDom() {
  const eyes = document.createElement("div");
  eyes.className = "looi-eyes";

  eyes.append(createEye(), createEye());
  return eyes;
}

function createEye() {
  const eye = document.createElement("div");
  eye.className = "looi-eye";

  const glow = document.createElement("div");
  glow.className = "looi-eye__glow";

  const core = document.createElement("div");
  core.className = "looi-eye__core";

  const scanLine = document.createElement("div");
  scanLine.className = "looi-eye__scan-line";

  eye.append(glow, core, scanLine);
  return eye;
}

function applyExpression() {
  if (!eyesRef) {
    return;
  }

  eyesRef.dataset.expression = FACE_STATE.expression;
  eyesRef.style.setProperty("--expression-intensity", String(FACE_STATE.intensity));

  if (FACE_STATE.speaking) {
    return;
  }

  if (FACE_STATE.expression === "sleepy") {
    sleep();
    return;
  }

  if (["shy", "sad"].includes(FACE_STATE.expression)) {
    softClose();
    return;
  }

  openEyes();
}

function normalizeExpression(expression) {
  return [
    "neutral",
    "happy",
    "curious",
    "attentive",
    "sleepy",
    "scared",
    "shy",
    "sad"
  ].includes(expression)
    ? expression
    : "neutral";
}

function scheduleNextBlink() {
  window.clearTimeout(FACE_STATE.autoBlinkTimer);

  FACE_STATE.autoBlinkTimer = window.setTimeout(() => {
    if (FACE_STATE.speaking || FACE_STATE.sleeping) {
      scheduleNextBlink();
      return;
    }

    blink();
  }, AUTO_BLINK_MIN_MS + Math.random() * AUTO_BLINK_JITTER_MS);
}

function clearMomentaryAnimations() {
  if (!eyesRef) {
    return;
  }

  window.clearTimeout(FACE_STATE.animationTimer);
  eyesRef.classList.remove("is-blinking", "is-soft-closing");
}

function clearAllTimers() {
  window.clearTimeout(FACE_STATE.autoBlinkTimer);
  window.clearTimeout(FACE_STATE.animationTimer);
  window.clearTimeout(FACE_STATE.lookTimer);
}

function settleLookHeight() {
  window.clearTimeout(FACE_STATE.lookTimer);
  FACE_STATE.lookTimer = window.setTimeout(() => {
    eyesRef?.style.setProperty("--look-scale-y", "1");
  }, 260);
}

function forceRestartAnimation() {
  return eyesRef?.offsetWidth ?? 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
