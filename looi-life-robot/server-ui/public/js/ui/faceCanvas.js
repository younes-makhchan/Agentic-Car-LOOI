const FACE_STATE = {
  expression: "neutral",
  intensity: 1,
  eyeDirection: "center",
  speaking: false,
  thinking: false,
  sleeping: false,
  autoBlinkTimer: 0,
  autoGlanceTimer: 0,
  autoGlanceReturnTimer: 0,
  autoGlanceToken: 0,
  animationTimer: 0,
  lookTimer: 0,
  photoTimer: 0,
  followTimer: 0,
  eatingTimer: 0,
  drinkingTimer: 0,
  questionTimer: 0,
  angryTimer: 0,
  lovingTimer: 0,
  shockedTimer: 0,
  tellingTimer: 0,
  kissTimer: 0,
  previewTimer: 0,
  latestPhotoUrl: "",
  followVisualState: "idle",
  eatingVisualState: "idle",
  drinkingVisualState: "idle",
  tellingVisualState: "idle"
};

const BLINK_TIME_MS = 360;
const SOFT_CLOSE_TIME_MS = 420;
const PHOTO_TIME_MS = 2400;
const FOLLOW_OPEN_TIME_MS = 900;
const FOLLOW_STOP_TIME_MS = 800;
const BITE_TIME_MS = 3200;
const FINISH_BURGER_TIME_MS = 2200;
const DRINK_OPEN_TIME_MS = 1600;
const FINISH_DRINK_TIME_MS = 1800;
const QUESTION_TIME_MS = 2200;
const ANGRY_TIME_MS = 1800;
const LOVING_TIME_MS = 2400;
const SHOCKED_TIME_MS = 1700;
const TELL_OPEN_TIME_MS = 1400;
const TELL_FINISH_TIME_MS = 1200;
const KISS_TIME_MS = 2600;
const AUTO_BLINK_MIN_MS = 2200;
const AUTO_BLINK_JITTER_MS = 2400;
const AUTO_GLANCE_MIN_MS = 1400;
const AUTO_GLANCE_JITTER_MS = 2200;
const AUTO_GLANCE_DWELL_MIN_MS = 420;
const AUTO_GLANCE_DWELL_JITTER_MS = 420;

const SUPPORTED_DIRECTIONS = new Set(["center", "left", "right", "up", "down"]);

let rootRef = null;
let eyesRef = null;

function initFaceCanvas(element) {
  rootRef = element;

  clearAllTimers();

  if (!rootRef) {
    return;
  }

  FACE_STATE.tellingVisualState = "idle";
  FACE_STATE.thinking = false;
  rootRef.replaceChildren(createEyeDom());
  rootRef.classList.add("looi-eye-system");
  rootRef.classList.remove(
    "is-taking-picture",
    "is-follow-opening",
    "is-following",
    "is-follow-stopping",
    "is-taking-bite",
    "is-bitten",
    "is-finishing-burger",
    "is-drink-opening",
    "is-drinking",
    "is-finish-drinking",
    "is-questioning",
    "is-angry",
    "is-loving",
    "is-shocked",
    "is-tell-opening",
    "is-telling",
    "is-tell-finishing",
    "is-kissing",
    "is-thinking"
  );
  rootRef.setAttribute("role", "img");
  rootRef.setAttribute("aria-label", "LOOI animated robot eyes");

  eyesRef = rootRef.querySelector(".looi-eyes");
  openEyes();
  scheduleNextBlink();
  scheduleNextGlance();
}

function setExpression(expression, intensity = 1) {
  FACE_STATE.expression = normalizeExpression(expression);
  FACE_STATE.intensity = clamp(Number(intensity) || 1, 0, 1.5);
  applyExpression();
}

function setEyeDirection(direction, { auto = false } = {}) {
  if (!auto) {
    FACE_STATE.autoGlanceToken += 1;
    window.clearTimeout(FACE_STATE.autoGlanceReturnTimer);
    scheduleNextGlance();
  }

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

function blink() {
  if (!eyesRef || FACE_STATE.speaking || FACE_STATE.sleeping || hasBlockingFaceAnimation()) {
    scheduleNextBlink();
    return;
  }

  clearMomentaryAnimations();
  forceRestartAnimation();
  eyesRef.classList.add("is-blinking");
  FACE_STATE.animationTimer = window.setTimeout(clearMomentaryAnimations, BLINK_TIME_MS);
  scheduleNextBlink();
}

function softClose() {
  if (!eyesRef || FACE_STATE.speaking || FACE_STATE.sleeping || hasBlockingFaceAnimation()) {
    return;
  }

  clearMomentaryAnimations();
  forceRestartAnimation();
  eyesRef.classList.add("is-soft-closing");
  FACE_STATE.animationTimer = window.setTimeout(clearMomentaryAnimations, SOFT_CLOSE_TIME_MS);
}

function openEyes() {
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

function lookLeft() {
  if (!eyesRef || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  eyesRef.style.setProperty("--look-x", "-42px");
  eyesRef.style.setProperty("--look-scale-y", "0.92");
  eyesRef.style.setProperty("--glow-dir", "1");
  settleLookHeight();
}

function lookRight() {
  if (!eyesRef || FACE_STATE.sleeping) {
    return;
  }

  clearMomentaryAnimations();
  eyesRef.style.setProperty("--look-x", "42px");
  eyesRef.style.setProperty("--look-scale-y", "0.92");
  eyesRef.style.setProperty("--glow-dir", "1");
  settleLookHeight();
}

function invertLook() {
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

function sleep() {
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

function setSpeaking(isSpeaking) {
  FACE_STATE.speaking = Boolean(isSpeaking);

  if (!eyesRef) {
    return;
  }

  eyesRef.classList.toggle("is-speaking", FACE_STATE.speaking);

  if (FACE_STATE.speaking) {
    setThinking(false);
    clearMomentaryAnimations();
    window.clearTimeout(FACE_STATE.kissTimer);
    rootRef?.classList.remove("is-kissing");
    if (FACE_STATE.sleeping) {
      openEyes();
    }
    return;
  }

  scheduleNextBlink();
}

function setThinking(isThinking) {
  const nextThinking = Boolean(isThinking);

  if (FACE_STATE.thinking === nextThinking) {
    return;
  }

  FACE_STATE.thinking = nextThinking;

  if (!rootRef) {
    return;
  }

  rootRef.classList.toggle("is-thinking", FACE_STATE.thinking);
}

function takePicture() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.photoTimer);
  window.clearTimeout(FACE_STATE.followTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  eyesRef.style.setProperty("--look-x", "0px");
  eyesRef.style.setProperty("--look-scale-y", "1");
  forceRestartAnimation();
  rootRef.classList.remove("is-taking-picture");
  rootRef.classList.add("is-taking-picture");
  FACE_STATE.photoTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-taking-picture");
  }, PHOTO_TIME_MS);
}

function takeBite() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.eatingTimer);
  FACE_STATE.sleeping = false;
  FACE_STATE.eatingVisualState = "taking_bite";
  rootRef.classList.remove("is-taking-bite", "is-finishing-burger", "is-bitten");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-taking-bite");
  FACE_STATE.eatingTimer = window.setTimeout(() => {
    FACE_STATE.eatingVisualState = "bitten";
    rootRef?.classList.remove("is-taking-bite");
    rootRef?.classList.add("is-bitten");
  }, BITE_TIME_MS);
}

function finishBurger() {
  if (!rootRef || !eyesRef) {
    return;
  }

  if (!isEatingActive()) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.eatingTimer);
  FACE_STATE.eatingVisualState = "finishing";
  rootRef.classList.remove("is-taking-bite", "is-bitten");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-finishing-burger");
  FACE_STATE.eatingTimer = window.setTimeout(() => {
    FACE_STATE.eatingVisualState = "idle";
    rootRef?.classList.remove("is-finishing-burger");
  }, FINISH_BURGER_TIME_MS);
}

function isEatingActive() {
  return Boolean(
    FACE_STATE.eatingVisualState !== "idle" ||
    rootRef?.classList.contains("is-taking-bite") ||
    rootRef?.classList.contains("is-bitten") ||
    rootRef?.classList.contains("is-finishing-burger")
  );
}

function openDrink() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.drinkingTimer);
  FACE_STATE.sleeping = false;
  FACE_STATE.drinkingVisualState = "opening";
  rootRef.classList.remove("is-drink-opening", "is-drinking", "is-finish-drinking");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-drink-opening");
  FACE_STATE.drinkingTimer = window.setTimeout(() => {
    FACE_STATE.drinkingVisualState = "drinking";
    rootRef?.classList.remove("is-drink-opening");
    rootRef?.classList.add("is-drinking");
  }, DRINK_OPEN_TIME_MS);
}

function finishDrink() {
  if (!rootRef || !eyesRef) {
    return;
  }

  if (!isDrinkingActive()) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.drinkingTimer);
  FACE_STATE.drinkingVisualState = "finishing";
  rootRef.classList.remove("is-drink-opening", "is-drinking");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-finish-drinking");
  FACE_STATE.drinkingTimer = window.setTimeout(() => {
    FACE_STATE.drinkingVisualState = "idle";
    rootRef?.classList.remove("is-finish-drinking");
  }, FINISH_DRINK_TIME_MS);
}

function isDrinkingActive() {
  return Boolean(
    FACE_STATE.drinkingVisualState !== "idle" ||
    rootRef?.classList.contains("is-drink-opening") ||
    rootRef?.classList.contains("is-drinking") ||
    rootRef?.classList.contains("is-finish-drinking")
  );
}

function showQuestion() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.questionTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-questioning");
  forceRestartAnimation();
  rootRef.classList.add("is-questioning");
  FACE_STATE.questionTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-questioning");
  }, QUESTION_TIME_MS);
}

function showAngry() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.angryTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-angry");
  forceRestartAnimation();
  rootRef.classList.add("is-angry");
  FACE_STATE.angryTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-angry");
  }, ANGRY_TIME_MS);
}

function showLoving() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.lovingTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-loving");
  forceRestartAnimation();
  rootRef.classList.add("is-loving");
  FACE_STATE.lovingTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-loving");
  }, LOVING_TIME_MS);
}

function showShocked() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.shockedTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-shocked");
  forceRestartAnimation();
  rootRef.classList.add("is-shocked");
  FACE_STATE.shockedTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-shocked");
  }, SHOCKED_TIME_MS);
}

function showTellMeAboutYourself() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.tellingTimer);
  FACE_STATE.sleeping = false;
  FACE_STATE.tellingVisualState = "opening";
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-tell-opening", "is-telling", "is-tell-finishing");
  forceRestartAnimation();
  rootRef.classList.add("is-tell-opening");
  FACE_STATE.tellingTimer = window.setTimeout(() => {
    FACE_STATE.tellingVisualState = "telling";
    rootRef?.classList.remove("is-tell-opening");
    rootRef?.classList.add("is-telling");
  }, TELL_OPEN_TIME_MS);
}

function finishTellMeAboutYourself() {
  if (!rootRef || !eyesRef) {
    return;
  }

  if (!isTellingActive()) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.tellingTimer);
  FACE_STATE.tellingVisualState = "finishing";
  rootRef.classList.remove("is-tell-opening", "is-telling");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-tell-finishing");
  FACE_STATE.tellingTimer = window.setTimeout(() => {
    FACE_STATE.tellingVisualState = "idle";
    rootRef?.classList.remove("is-tell-finishing");
  }, TELL_FINISH_TIME_MS);
}

function isTellingActive() {
  return Boolean(
    FACE_STATE.tellingVisualState !== "idle" ||
    rootRef?.classList.contains("is-tell-opening") ||
    rootRef?.classList.contains("is-telling") ||
    rootRef?.classList.contains("is-tell-finishing")
  );
}

function showKiss() {
  if (!rootRef || !eyesRef || FACE_STATE.speaking) {
    return false;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.kissTimer);
  FACE_STATE.sleeping = false;
  eyesRef.classList.remove("is-sleeping");
  rootRef.classList.remove("is-kissing");
  forceRestartAnimation();
  rootRef.classList.add("is-kissing");
  FACE_STATE.kissTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-kissing");
  }, KISS_TIME_MS);
  return true;
}

export function startFollow() {
  if (!rootRef || !eyesRef) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.followTimer);
  FACE_STATE.sleeping = false;
  FACE_STATE.followVisualState = "opening";
  rootRef.classList.remove("is-taking-picture", "is-following", "is-follow-stopping");
  eyesRef.classList.remove("is-sleeping");
  eyesRef.style.setProperty("--look-x", "0px");
  eyesRef.style.setProperty("--look-scale-y", "1");
  forceRestartAnimation();
  rootRef.classList.add("is-follow-opening");
  FACE_STATE.followTimer = window.setTimeout(() => {
    rootRef?.classList.remove("is-follow-opening");
    requestAnimationFrame(() => {
      FACE_STATE.followVisualState = "following";
      rootRef?.classList.add("is-following");
    });
  }, FOLLOW_OPEN_TIME_MS);
}

export function stopFollow() {
  if (!rootRef || !eyesRef) {
    return;
  }

  if (
    FACE_STATE.followVisualState === "idle" &&
    !rootRef.classList.contains("is-following") &&
    !rootRef.classList.contains("is-follow-opening")
  ) {
    return;
  }

  clearMomentaryAnimations();
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.followTimer);
  FACE_STATE.followVisualState = "stopping";
  rootRef.classList.remove("is-following", "is-follow-opening");
  eyesRef.classList.remove("is-sleeping");
  forceRestartAnimation();
  rootRef.classList.add("is-follow-stopping");
  FACE_STATE.followTimer = window.setTimeout(() => {
    FACE_STATE.followVisualState = "idle";
    rootRef?.classList.remove("is-follow-stopping");
    eyesRef?.style.setProperty("--look-x", "0px");
    eyesRef?.style.setProperty("--look-scale-y", "1");
  }, FOLLOW_STOP_TIME_MS);
}

function showPhoto(dataUrl, { dismissMs = 5000 } = {}) {
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

function dismissPhoto() {
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

export function createFaceController(element) {
  initFaceCanvas(element);

  return {
    setExpression,
    setEyeDirection,
    setSpeaking,
    blink,
    softClose,
    openEyes,
    lookLeft,
    lookRight,
    invertLook,
    sleep,
    takePicture,
    takeBite,
    finishBurger,
    isEatingActive,
    openDrink,
    finishDrink,
    isDrinkingActive,
    showQuestion,
    showAngry,
    showLoving,
    showShocked,
    showTellMeAboutYourself,
    finishTellMeAboutYourself,
    isTellingActive,
    showKiss,
    startFollow,
    stopFollow,
    showPhoto,
    dismissPhoto,
    setThinking
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

  const followTarget = document.createElement("div");
  followTarget.className = "looi-follow-target";

  const followShine = document.createElement("div");
  followShine.className = "looi-follow-shine";
  followTarget.append(followShine);

  const mouth = document.createElement("div");
  mouth.className = "looi-eating-mouth";

  const crumbOne = document.createElement("div");
  crumbOne.className = "looi-eating-crumb looi-eating-crumb--one";

  const crumbTwo = document.createElement("div");
  crumbTwo.className = "looi-eating-crumb looi-eating-crumb--two";

  const burger = document.createElement("div");
  burger.className = "looi-burger";
  burger.innerHTML = `
    <div class="looi-burger__bun-top"></div>
    <div class="looi-burger__bite"></div>
    <div class="looi-burger__cheese"></div>
    <div class="looi-burger__lettuce"></div>
    <div class="looi-burger__patty"></div>
    <div class="looi-burger__bun-bottom"></div>
  `;

  const drinkMouth = document.createElement("div");
  drinkMouth.className = "looi-drink-mouth";

  const sipDots = ["one", "two", "three", "four"].map((name) => {
    const dot = document.createElement("div");
    dot.className = `looi-sip-dot looi-sip-dot--${name}`;
    return dot;
  });

  const drinkStraw = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  drinkStraw.classList.add("looi-drink-straw");
  drinkStraw.setAttribute("viewBox", "0 0 240 190");
  drinkStraw.setAttribute("aria-hidden", "true");
  drinkStraw.innerHTML = `
    <path class="looi-drink-straw__shadow" d="M120 150 L120 86 Q120 48 152 44 L184 38"></path>
    <path class="looi-drink-straw__path" d="M120 150 L120 86 Q120 48 152 44 L184 38"></path>
  `;

  const drinkCan = document.createElement("div");
  drinkCan.className = "looi-drink-can";

  const thoughtDots = ["one", "two"].map((name) => {
    const dot = document.createElement("div");
    dot.className = `looi-thought-dot looi-thought-dot--${name}`;
    return dot;
  });

  const questionMark = document.createElement("div");
  questionMark.className = "looi-question-mark";
  questionMark.setAttribute("aria-hidden", "true");
  questionMark.innerHTML = `
    <svg viewBox="0 0 100 130">
      <path class="looi-question-mark__stroke" d="M34 34 C34 16 68 14 73 34 C77 49 65 58 54 65 C47 70 46 76 46 83"></path>
      <path class="looi-question-mark__highlight" d="M39 29 C48 20 63 23 67 34"></path>
      <circle class="looi-question-mark__dot" cx="46" cy="111" r="9"></circle>
    </svg>
  `;

  const angrySpark = document.createElement("div");
  angrySpark.className = "looi-angry-spark";
  angrySpark.setAttribute("aria-hidden", "true");
  angrySpark.innerHTML = `
    <svg viewBox="0 0 100 100">
      <path class="looi-angry-spark__main" d="M50 8 C52 32 58 42 84 46 C58 50 52 60 50 92 C48 60 42 50 16 46 C42 42 48 32 50 8 Z"></path>
      <path class="looi-angry-spark__highlight" d="M39 22 C43 36 48 41 62 43"></path>
    </svg>
  `;

  const lovingHearts = document.createElement("div");
  lovingHearts.className = "looi-loving-hearts";
  lovingHearts.setAttribute("aria-hidden", "true");
  lovingHearts.innerHTML = `
    <div class="looi-loving-heart looi-loving-heart--one"></div>
    <div class="looi-loving-heart looi-loving-heart--two"></div>
    <div class="looi-loving-heart looi-loving-heart--three"></div>
    <div class="looi-loving-heart looi-loving-heart--four"></div>
  `;

  const shockExclaim = document.createElement("div");
  shockExclaim.className = "looi-shock-exclaim";
  shockExclaim.setAttribute("aria-hidden", "true");
  shockExclaim.innerHTML = `
    <div class="looi-shock-exclaim__bar"></div>
    <div class="looi-shock-exclaim__dot"></div>
  `;

  const tellSparks = ["one", "two", "three"].map((name) => {
    const spark = document.createElement("div");
    spark.className = `looi-tell-spark looi-tell-spark--${name}`;
    return spark;
  });

  const tellLeftMic = document.createElement("div");
  tellLeftMic.className = "looi-tell-mic looi-tell-mic--left";
  tellLeftMic.innerHTML = `<div class="looi-tell-mic__flag">TV</div>`;

  const tellRightMic = document.createElement("div");
  tellRightMic.className = "looi-tell-mic looi-tell-mic--right";
  tellRightMic.innerHTML = `<div class="looi-tell-mic__flag">NEWS</div>`;

  const tellMouth = document.createElement("div");
  tellMouth.className = "looi-tell-mouth";

  const kissMouth = document.createElement("div");
  kissMouth.className = "looi-kiss-mouth";

  const kissHeart = document.createElement("div");
  kissHeart.className = "looi-kiss-heart";

  const eyes = document.createElement("div");
  eyes.className = "looi-eyes";
  eyes.append(createEye(), createEye());

  fragment.append(
    flash,
    mouth,
    crumbOne,
    crumbTwo,
    burger,
    drinkMouth,
    ...sipDots,
    drinkStraw,
    drinkCan,
    ...thoughtDots,
    questionMark,
    angrySpark,
    lovingHearts,
    shockExclaim,
    ...tellSparks,
    tellLeftMic,
    tellRightMic,
    tellMouth,
    kissMouth,
    kissHeart,
    followTarget,
    preview,
    cameraIcon,
    eyes
  );
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

  const lid = document.createElement("div");
  lid.className = "looi-eye__lid";

  const loveLid = document.createElement("div");
  loveLid.className = "looi-eye__love-lid";

  eye.append(glow, core, scanLine, lid, loveLid);
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

function scheduleNextGlance() {
  window.clearTimeout(FACE_STATE.autoGlanceTimer);

  FACE_STATE.autoGlanceTimer = window.setTimeout(() => {
    if (!canAutoGlance()) {
      scheduleNextGlance();
      return;
    }

    const token = FACE_STATE.autoGlanceToken + 1;
    const nextDirection = chooseAutoGlanceDirection();
    FACE_STATE.autoGlanceToken = token;
    setEyeDirection(nextDirection, { auto: true });

    window.clearTimeout(FACE_STATE.autoGlanceReturnTimer);
    FACE_STATE.autoGlanceReturnTimer = window.setTimeout(() => {
      if (FACE_STATE.autoGlanceToken === token && canAutoGlance()) {
        setEyeDirection("center", { auto: true });
      }
      scheduleNextGlance();
    }, AUTO_GLANCE_DWELL_MIN_MS + Math.random() * AUTO_GLANCE_DWELL_JITTER_MS);
  }, AUTO_GLANCE_MIN_MS + Math.random() * AUTO_GLANCE_JITTER_MS);
}

function canAutoGlance() {
  return Boolean(
    eyesRef &&
    !FACE_STATE.speaking &&
    !FACE_STATE.sleeping &&
    !rootRef?.classList.contains("is-taking-picture") &&
    !rootRef?.classList.contains("is-follow-opening") &&
    !rootRef?.classList.contains("is-following") &&
    !rootRef?.classList.contains("is-follow-stopping") &&
    !rootRef?.classList.contains("is-taking-bite") &&
    !rootRef?.classList.contains("is-bitten") &&
    !rootRef?.classList.contains("is-finishing-burger") &&
    !rootRef?.classList.contains("is-drink-opening") &&
    !rootRef?.classList.contains("is-drinking") &&
    !rootRef?.classList.contains("is-finish-drinking") &&
    !rootRef?.classList.contains("is-questioning") &&
    !rootRef?.classList.contains("is-angry") &&
    !rootRef?.classList.contains("is-loving") &&
    !rootRef?.classList.contains("is-shocked") &&
    !rootRef?.classList.contains("is-tell-opening") &&
    !rootRef?.classList.contains("is-telling") &&
    !rootRef?.classList.contains("is-tell-finishing") &&
    !rootRef?.classList.contains("is-kissing") &&
    !eyesRef.classList.contains("is-blinking") &&
    !eyesRef.classList.contains("is-soft-closing")
  );
}

function chooseAutoGlanceDirection() {
  if (FACE_STATE.eyeDirection === "left") {
    return "right";
  }

  if (FACE_STATE.eyeDirection === "right") {
    return "left";
  }

  return Math.random() < 0.5 ? "left" : "right";
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
  window.clearTimeout(FACE_STATE.autoGlanceTimer);
  window.clearTimeout(FACE_STATE.autoGlanceReturnTimer);
  window.clearTimeout(FACE_STATE.animationTimer);
  window.clearTimeout(FACE_STATE.lookTimer);
  window.clearTimeout(FACE_STATE.photoTimer);
  window.clearTimeout(FACE_STATE.followTimer);
  window.clearTimeout(FACE_STATE.eatingTimer);
  window.clearTimeout(FACE_STATE.drinkingTimer);
  window.clearTimeout(FACE_STATE.questionTimer);
  window.clearTimeout(FACE_STATE.angryTimer);
  window.clearTimeout(FACE_STATE.lovingTimer);
  window.clearTimeout(FACE_STATE.shockedTimer);
  window.clearTimeout(FACE_STATE.tellingTimer);
  window.clearTimeout(FACE_STATE.kissTimer);
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

function hasBlockingFaceAnimation() {
  return Boolean(
    rootRef?.classList.contains("is-taking-picture") ||
    rootRef?.classList.contains("is-follow-opening") ||
    rootRef?.classList.contains("is-following") ||
    rootRef?.classList.contains("is-follow-stopping") ||
    rootRef?.classList.contains("is-taking-bite") ||
    rootRef?.classList.contains("is-bitten") ||
    rootRef?.classList.contains("is-finishing-burger") ||
    rootRef?.classList.contains("is-drink-opening") ||
    rootRef?.classList.contains("is-drinking") ||
    rootRef?.classList.contains("is-finish-drinking") ||
    rootRef?.classList.contains("is-questioning") ||
    rootRef?.classList.contains("is-angry") ||
    rootRef?.classList.contains("is-loving") ||
    rootRef?.classList.contains("is-shocked") ||
    rootRef?.classList.contains("is-tell-opening") ||
    rootRef?.classList.contains("is-telling") ||
    rootRef?.classList.contains("is-tell-finishing") ||
    rootRef?.classList.contains("is-kissing")
  );
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
