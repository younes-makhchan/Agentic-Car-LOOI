export class MockProvider {
  constructor({ model = "mock" } = {}) {
    this.model = model || "mock";
  }

  getName() {
    return "mock";
  }

  async status() {
    return {
      ok: true,
      provider: this.getName(),
      model: this.model,
      available: true,
      details: {
        deterministic: true
      }
    };
  }

  async think({ context } = {}) {
    const text = latestText(context).toLowerCase();
    const policy = context?.policy ?? {};

    if (/\b(stop|freeze|halt)\b/.test(text) || /\bdon'?t move\b/.test(text)) {
      return performResponse({
        policy,
        text: "Stopping.",
        movement: ["still"],
        reason: "stop phrase",
        confidence: 0.98
      });
    }

    if (/\b(take|snap|shoot|capture)\b.*\b(picture|photo|selfie)\b|\b(picture|photo|selfie)\b.*\b(me|my)\b/.test(text)) {
      return performResponse({
        policy,
        text: "Okay, hold still.",
        tone: "happy",
        movement: ["still"],
        scenario: "take_picture",
        reason: "take picture scenario",
        confidence: 0.9
      });
    }

    if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(text)) {
      return performResponse({
        policy,
        text: policy.localMotionArmed ? "Coming a little closer." : "My body is not armed yet.",
        tone: policy.localMotionArmed ? "happy" : "soft",
        movement: policy.localMotionArmed ? ["move_forward_tiny"] : ["still"],
        reason: "approach request",
        confidence: 0.86
      });
    }

    if (/\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Moving forward a little.",
        movement: ["move_forward_tiny"],
        reason: "drive forward request"
      });
    }

    if (/\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Moving back a little.",
        movement: ["move_backward_tiny"],
        reason: "drive backward request"
      });
    }

    if (/\b(turn|rotate)\s+left\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Turning left a little.",
        movement: ["look_left"],
        reason: "turn left request"
      });
    }

    if (/\b(turn|rotate)\s+right\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Turning right a little.",
        movement: ["look_right"],
        reason: "turn right request"
      });
    }

    if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b/.test(text)) {
      return performResponse({
        policy,
        text: policy.localMotionArmed ? "I'll give you room." : null,
        tone: "soft",
        movement: policy.localMotionArmed ? ["move_backward_tiny"] : ["still"],
        reason: "personal space request",
        confidence: 0.88
      });
    }

    if (/\blook around\b|\bcheck the room\b|\bscan\b/.test(text)) {
      return performResponse({
        policy,
        movement: ["curious_shift"],
        reason: "look around request",
        confidence: 0.82
      });
    }

    const visionAnswer = answerVisionQuestion(text, context);
    if (visionAnswer) {
      return performResponse({
        policy,
        text: visionAnswer,
        tone: "curious",
        movement: ["still"],
        reason: "vision question",
        confidence: 0.82
      });
    }

    if (Number(context?.lifeState?.boredom) > 0.82 && policy.autonomousMode) {
      return performResponse({
        policy,
        movement: policy.localMotionArmed && policy.allowAutonomousMovement
          ? ["curious_shift"]
          : ["look_up"],
        reason: "boredom high",
        confidence: 0.56
      });
    }

    if (/\b(hello|hi|hey|looi)\b/.test(text)) {
      return performResponse({
        policy,
        text: "Hi.",
        tone: "happy",
        movement: ["gentle_wiggle"],
        reason: "greeting",
        confidence: 0.74
      });
    }

    return performResponse({
      policy,
      movement: ["still"],
      reason: text ? "attentive fallback" : "quiet fallback",
      confidence: 0.45
    });
  }
}

function response({ text = null, action = null, reason = "mock", confidence = 0.8 } = {}) {
  return {
    ok: true,
    text,
    action,
    reason,
    confidence
  };
}

function performResponse({ policy = {}, text = "", tone = "soft", movement = ["still"], scenario = null, reason = "mock", confidence = 0.8 } = {}) {
  const speechText = policy.localSpeechAllowed === false ? "" : String(text ?? "").slice(0, 240);

  return response({
    text: speechText || null,
    action: {
      type: "perform",
      args: {
        speech: {
          text: speechText,
          tone
        },
        movement: Array.isArray(movement) && movement.length ? movement : ["still"],
        scenario,
        timing: "parallel",
        iterateMovement: false
      }
    },
    reason,
    confidence
  });
}

function movementResponse({ policy, text, movement, reason }) {
  if (!policy.localMotionArmed) {
    return performResponse({
      policy,
      text: "My body is not armed yet.",
      tone: "soft",
      movement: ["still"],
      reason: `${reason} blocked by policy`,
      confidence: 0.84
    });
  }

  return performResponse({
    policy,
    text,
    tone: "soft",
    movement,
    reason,
    confidence: 0.88
  });
}

function latestText(context = {}) {
  return String(
    context.triggerEvent?.payload?.text ??
      context.triggerEvent?.text ??
      context.recentEvents?.[0]?.text ??
      ""
  );
}

function answerVisionQuestion(text, context = {}) {
  if (!/\b(what can you see|can you see|do you see|see me)\b/.test(text)) {
    return null;
  }

  const vision = context.vision ?? {};
  if (vision.cameraRunning === false) {
    return "I can't see right now.";
  }

  const visibleObjects = Array.isArray(vision.objects)
    ? vision.objects.filter((object) => object?.visible !== false && object?.label)
    : [];
  const hasPerson = visibleObjects.some((object) => object.label === "person");

  if (/\b(me|my face|you see me)\b/.test(text)) {
    return hasPerson ? "Yes, I can see you." : "I can't see you right now.";
  }

  if (!visibleObjects.length) {
    return "I don't see any clear objects right now.";
  }

  return `I can see ${formatVisibleObjectsForSpeech(visibleObjects)}.`;
}

function formatVisibleObjectsForSpeech(objects = []) {
  const labels = [
    ...new Set(
      objects
        .map((object) => object.label === "person" ? "you" : withArticle(object.label))
        .filter(Boolean)
    )
  ];

  if (labels.length <= 1) {
    return labels[0] ?? "something";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function withArticle(label) {
  const value = String(label ?? "").trim();
  if (!value) {
    return "";
  }
  if (/^(you|me|person)$/i.test(value)) {
    return value;
  }
  return `${/^[aeiou]/i.test(value) ? "an" : "a"} ${value}`;
}
