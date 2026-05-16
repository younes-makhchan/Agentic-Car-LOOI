const FACE_STATE = {
  expression: "neutral",
  intensity: 1,
  eyeDirection: "center",
  blinkStartedAt: 0,
  blinkDurationMs: 220,
  nextAutoBlinkAt: 0,
  speaking: false,
  mouthOpen: 0
};

const EXPRESSION_PRESETS = {
  neutral: { eyeScaleY: 1, lidTilt: 0, glow: 0.16, browLift: 0 },
  happy: { eyeScaleY: 0.82, lidTilt: -0.22, glow: 0.28, browLift: 0.1 },
  curious: { eyeScaleY: 1.02, lidTilt: 0.1, glow: 0.24, browLift: 0.16, asymmetry: 0.1 },
  attentive: { eyeScaleY: 1.08, lidTilt: 0, glow: 0.24, browLift: 0.08 },
  sleepy: { eyeScaleY: 0.45, lidTilt: -0.04, glow: 0.08, browLift: -0.08 },
  scared: { eyeScaleY: 1.18, lidTilt: 0.18, glow: 0.34, browLift: 0.22 },
  shy: { eyeScaleY: 0.72, lidTilt: -0.08, glow: 0.14, browLift: -0.02 }
};

const DIRECTION_VECTORS = {
  center: { x: 0, y: 0 },
  left: { x: -0.3, y: 0 },
  right: { x: 0.3, y: 0 },
  up: { x: 0, y: -0.2 },
  down: { x: 0, y: 0.2 }
};

let canvasRef = null;
let ctx = null;
let animationFrameId = 0;
let resizeObserver = null;

export function initFaceCanvas(canvas) {
  canvasRef = canvas;
  ctx = canvas.getContext("2d");

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
  }

  scheduleNextBlink(performance.now());
  resizeCanvas();

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasRef);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }

  animationFrameId = requestAnimationFrame(renderFrame);
}

export function setExpression(expression, intensity = 1) {
  if (EXPRESSION_PRESETS[expression]) {
    FACE_STATE.expression = expression;
  }

  FACE_STATE.intensity = clamp(intensity, 0, 1.5);
}

export function setEyeDirection(direction) {
  if (DIRECTION_VECTORS[direction]) {
    FACE_STATE.eyeDirection = direction;
  }
}

export function blink() {
  FACE_STATE.blinkStartedAt = performance.now();
}

export function setSpeaking(isSpeaking) {
  FACE_STATE.speaking = Boolean(isSpeaking);
  if (!FACE_STATE.speaking) {
    FACE_STATE.mouthOpen = 0;
  }
}

export function setMouthOpen(value) {
  FACE_STATE.mouthOpen = clamp(Number(value) || 0, 0, 1);
}

export function updateFaceState(partialState) {
  if (partialState.expression) {
    setExpression(partialState.expression, partialState.intensity ?? FACE_STATE.intensity);
  }

  if (partialState.eyeDirection) {
    setEyeDirection(partialState.eyeDirection);
  }

  if (typeof partialState.intensity === "number" && !partialState.expression) {
    FACE_STATE.intensity = clamp(partialState.intensity, 0, 1.5);
  }

  if (typeof partialState.speaking === "boolean") {
    setSpeaking(partialState.speaking);
  }

  if (typeof partialState.mouthOpen === "number") {
    setMouthOpen(partialState.mouthOpen);
  }
}

export function createFaceController(canvas) {
  initFaceCanvas(canvas);

  return {
    setExpression,
    setEyeDirection,
    setSpeaking,
    setMouthOpen,
    blink,
    updateFaceState
  };
}

function renderFrame(now) {
  if (!canvasRef || !ctx) {
    return;
  }

  if (!FACE_STATE.blinkStartedAt && now >= FACE_STATE.nextAutoBlinkAt) {
    FACE_STATE.blinkStartedAt = now;
  }

  const width = canvasRef.clientWidth || 320;
  const height = canvasRef.clientHeight || 320;
  const blinkAmount = getBlinkAmount(now);
  const preset = EXPRESSION_PRESETS[FACE_STATE.expression] ?? EXPRESSION_PRESETS.neutral;
  const bob = Math.sin(now * 0.0016) * 6;

  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height, now);
  drawEye(width * 0.34, height * 0.5 + bob, width, height, preset, blinkAmount, "left", now);
  drawEye(width * 0.66, height * 0.5 + bob, width, height, preset, blinkAmount, "right", now);
  drawMouth(width, height, preset, now);

  animationFrameId = requestAnimationFrame(renderFrame);
}

function resizeCanvas() {
  if (!canvasRef || !ctx) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvasRef.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  canvasRef.width = Math.round(width * dpr);
  canvasRef.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBackground(width, height, now) {
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.28,
    width * 0.05,
    width * 0.5,
    height * 0.5,
    width * 0.6
  );

  gradient.addColorStop(0, "rgba(45, 91, 130, 0.25)");
  gradient.addColorStop(1, "rgba(2, 6, 12, 0.96)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(97, 211, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(
    width * 0.5,
    height * 0.52,
    width * (0.34 + Math.sin(now * 0.0008) * 0.015),
    0,
    Math.PI * 2
  );
  ctx.stroke();
  ctx.restore();
}

function drawEye(centerX, centerY, width, height, preset, blinkAmount, side, now) {
  const socketWidth = width * 0.22;
  const socketHeight = height * 0.28;
  const asymmetry = side === "right" ? 1 + (preset.asymmetry ?? 0) * FACE_STATE.intensity : 1;
  const openHeight = Math.max(
    socketHeight * 0.08,
    socketHeight * preset.eyeScaleY * asymmetry * (1 - blinkAmount * 0.92)
  );
  const direction = DIRECTION_VECTORS[FACE_STATE.eyeDirection] ?? DIRECTION_VECTORS.center;
  const pupilOffsetX = direction.x * socketWidth * 0.18;
  const pupilOffsetY = direction.y * socketHeight * 0.14;
  const shimmer = 0.88 + Math.sin(now * 0.004 + (side === "left" ? 0 : 1.2)) * 0.08;
  const tilt = preset.lidTilt * socketHeight * FACE_STATE.intensity * (side === "left" ? 1 : -1);

  ctx.save();

  ctx.fillStyle = "rgba(5, 11, 20, 0.95)";
  roundedRect(centerX - socketWidth / 2, centerY - socketHeight / 2, socketWidth, socketHeight, 24);
  ctx.fill();

  ctx.strokeStyle = "rgba(117, 209, 255, 0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.shadowColor = `rgba(97, 211, 255, ${preset.glow * shimmer})`;
  ctx.shadowBlur = 32;
  ctx.fillStyle = `rgba(97, 211, 255, ${0.74 * shimmer})`;
  roundedRect(
    centerX - socketWidth * 0.34,
    centerY - openHeight / 2,
    socketWidth * 0.68,
    openHeight,
    14
  );
  ctx.fill();

  if (openHeight > socketHeight * 0.18) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(3, 12, 22, 0.82)";
    roundedRect(
      centerX - socketWidth * 0.08 + pupilOffsetX,
      centerY - openHeight * 0.17 + pupilOffsetY,
      socketWidth * 0.16,
      openHeight * 0.34,
      8
    );
    ctx.fill();

    ctx.fillStyle = "rgba(245, 252, 255, 0.82)";
    roundedRect(
      centerX - socketWidth * 0.12 + pupilOffsetX,
      centerY - openHeight * 0.16 + pupilOffsetY,
      socketWidth * 0.06,
      Math.max(6, openHeight * 0.12),
      5
    );
    ctx.fill();
  }

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(164, 224, 255, 0.84)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(centerX - socketWidth * 0.4, centerY - socketHeight * 0.24 - tilt - preset.browLift * 10);
  ctx.quadraticCurveTo(
    centerX,
    centerY - socketHeight * 0.38 + tilt - preset.browLift * 12,
    centerX + socketWidth * 0.4,
    centerY - socketHeight * 0.24 + tilt - preset.browLift * 10
  );
  ctx.stroke();

  ctx.restore();
}

function drawMouth(width, height, preset, now) {
  const baseOpen = FACE_STATE.speaking
    ? 0.28 + Math.abs(Math.sin(now * 0.018)) * 0.72
    : FACE_STATE.mouthOpen;
  const mouthWidth = width * (0.16 + 0.04 * FACE_STATE.intensity);
  const mouthHeight = height * (0.018 + baseOpen * 0.055);
  const centerX = width * 0.5;
  const centerY = height * 0.72;

  ctx.save();
  ctx.shadowColor = `rgba(97, 211, 255, ${preset.glow + (FACE_STATE.speaking ? 0.18 : 0.04)})`;
  ctx.shadowBlur = FACE_STATE.speaking ? 22 : 10;
  ctx.fillStyle = FACE_STATE.speaking
    ? "rgba(97, 211, 255, 0.78)"
    : "rgba(97, 211, 255, 0.36)";
  roundedRect(centerX - mouthWidth / 2, centerY - mouthHeight / 2, mouthWidth, mouthHeight, 12);
  ctx.fill();
  ctx.restore();
}

function getBlinkAmount(now) {
  if (!FACE_STATE.blinkStartedAt) {
    return 0;
  }

  const elapsed = now - FACE_STATE.blinkStartedAt;
  const progress = elapsed / FACE_STATE.blinkDurationMs;

  if (progress >= 1) {
    FACE_STATE.blinkStartedAt = 0;
    scheduleNextBlink(now);
    return 0;
  }

  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}

function scheduleNextBlink(now) {
  FACE_STATE.nextAutoBlinkAt = now + 2200 + Math.random() * 2200;
}

function roundedRect(x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
