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

function performResponse({ policy = {}, text = "", tone = "soft", movement = ["still"], reason = "mock", confidence = 0.8 } = {}) {
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
