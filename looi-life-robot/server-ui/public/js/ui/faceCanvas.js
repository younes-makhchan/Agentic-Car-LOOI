const FACE_STATE = {
  expression: "neutral",
  intensity: 1,
  eyeDirection: "center",
  speaking: false,
  sleeping: false,
  autoBlinkTimer: 0,
  animationTimer: 0,
  lookTimer: 0,
  photoTimer: 0,
  previewTimer: 0,
  latestPhotoUrl: ""
};

const BLINK_TIME_MS = 360;
const SOFT_CLOSE_TIME_MS = 420;
const PHOTO_TIME_MS = 2400;
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

export function takePicture() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.photoTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  eyesRef.style.setProperty("--look-x", "0px");
  eyesRef.style.setProperty("--look-scale-y", "1");
  forceRestartAnimation();
  rootRef.classList.add("is-taking-picture");
  FACE_STATE.photoTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-taking-picture");
  }, PHOTO_TIME_MS);
}

export function showPhoto(dataUrl, { dismissMs = 5000 } = {}) {
  if (!rootRef || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return;
  }

  const preview = rootRef.querySelector(".looi-photo-preview");
  const image = rootRef.querySelector(".looi-photo-preview__image");

  if (!preview || !image) {
    return;
  }

  window.clearTimeout(FACE_STATE.previewTimer);
  FACE_STATE.latestPhotoUrl = dataUrl;
  image.setAttribute("src", dataUrl);
  preview.hidden = false;
  preview.classList.add("is-visible");

  FACE_STATE.previewTimer = window.setTimeout(() => {
    dismissPhoto();
  }, Math.max(1000, Number(dismissMs) || 5000));
}

export function dismissPhoto() {
  if (!rootRef) {
    return;
  }

  window.clearTimeout(FACE_STATE.previewTimer);
  const preview = rootRef.querySelector(".looi-photo-preview");
  const image = rootRef.querySelector(".looi-photo-preview__image");

  preview?.classList.remove("is-visible");
  if (preview) {
    preview.hidden = true;
  }
  image?.removeAttribute("src");
  FACE_STATE.latestPhotoUrl = "";
  openEyes();
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
    takePicture,
    showPhoto,
    dismissPhoto,
    updateFaceState
  };
}

function createEyeDom() {
  const fragment = document.createDocumentFragment();

  const flash = document.createElement("div");
  flash.className = "looi-flash-screen";

  const preview = document.createElement("div");
  preview.className = "looi-photo-preview";
  preview.hidden = true;

  const image = document.createElement("img");
  image.className = "looi-photo-preview__image";
  image.alt = "Latest photo preview";

  const actions = document.createElement("div");
  actions.className = "looi-photo-preview__actions";

  const deleteButton = document.createElement("button");
  deleteButton.className = "looi-photo-preview__button looi-photo-preview__button--delete";
  deleteButton.type = "button";
  deleteButton.textContent = "DELETE";
  deleteButton.addEventListener("click", dismissPhoto);

  const saveButton = document.createElement("button");
  saveButton.className = "looi-photo-preview__button looi-photo-preview__button--save";
  saveButton.type = "button";
  saveButton.textContent = "SAVE";
  saveButton.addEventListener("click", saveLatestPhoto);

  actions.append(deleteButton, saveButton);
  preview.append(image, actions);

  const cameraIcon = document.createElement("div");
  cameraIcon.className = "looi-camera-icon";
  cameraIcon.innerHTML = `
    <div class="looi-camera-icon__top"></div>
    <div class="looi-camera-icon__body"></div>
    <div class="looi-camera-icon__lens"></div>
    <div class="looi-camera-icon__flash-dot"></div>
  `;

  const eyes = document.createElement("div");
  eyes.className = "looi-eyes";
  eyes.append(createEye(), createEye());

  fragment.append(flash, preview, cameraIcon, eyes);
  return fragment;
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
  window.clearTimeout(FACE_STATE.photoTimer);
  window.clearTimeout(FACE_STATE.previewTimer);
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

function saveLatestPhoto() {
  if (!FACE_STATE.latestPhotoUrl) {
    dismissPhoto();
    return;
  }

  const link = document.createElement("a");
  link.href = FACE_STATE.latestPhotoUrl;
  link.download = `looi-photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
  document.body.append(link);
  link.click();
  link.remove();
  dismissPhoto();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
