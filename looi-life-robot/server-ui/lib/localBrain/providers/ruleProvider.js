export class RuleProvider {
  constructor({ model = "rule" } = {}) {
    this.model = model || "rule";
  }

  getName() {
    return "rule";
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
    const text = latestText(context);
    const classification = classifyText(text);
    const policy = context?.policy ?? {};

    switch (classification) {
      case "safety_stop":
        return performResponse({
          policy,
          text: "Stopping.",
          movement: ["still"],
          reason: classification,
          confidence: 0.99
        });
      case "direct_command_approach":
        return performResponse({
          policy,
          text: policy.localMotionArmed ? "Coming closer." : "My body is not armed yet.",
          movement: policy.localMotionArmed ? ["move_forward_tiny"] : ["still"],
          reason: classification,
          confidence: 0.86
        });
      case "scenario_take_picture":
        return performResponse({
          policy,
          text: "Okay, hold still.",
          tone: "happy",
          movement: ["still"],
          scenario: "take_picture",
          reason: classification,
          confidence: 0.9
        });
      case "direct_command_drive_forward":
        return movementResponse({
          policy,
          text: "Moving forward a little.",
          movement: ["move_forward_tiny"],
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_drive_backward":
        return movementResponse({
          policy,
          text: "Moving back a little.",
          movement: ["move_backward_tiny"],
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_turn_left":
        return movementResponse({
          policy,
          text: "Turning left a little.",
          movement: ["look_left"],
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_turn_right":
        return movementResponse({
          policy,
          text: "Turning right a little.",
          movement: ["look_right"],
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_retreat":
        return performResponse({
          policy,
          movement: policy.localMotionArmed ? ["move_backward_tiny"] : ["still"],
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_look":
        return performResponse({
          policy,
          movement: ["curious_shift"],
          reason: classification,
          confidence: 0.8
        });
      case "greeting":
        return performResponse({
          policy,
          text: "Hi.",
          tone: "happy",
          movement: ["gentle_wiggle"],
          reason: classification,
          confidence: 0.7
        });
      case "direct_question":
        return performResponse({
          policy,
          text: "I'm listening locally.",
          movement: ["look_up"],
          reason: classification,
          confidence: 0.55
        });
      case "background":
      case "unknown":
      default:
        return performResponse({
          policy,
          movement: ["still"],
          reason: classification,
          confidence: 0.35
        });
    }
  }
}

function classifyText(text) {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s'?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "background";
  if (/\b(stop|freeze|halt)\b/.test(normalized) || /\bdon'?t move\b/.test(normalized)) return "safety_stop";
  if (/\b(take|snap|shoot|capture)\b.*\b(picture|photo|selfie)\b|\b(picture|photo|selfie)\b.*\b(me|my)\b/.test(normalized)) return "scenario_take_picture";
  if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(normalized)) return "direct_command_approach";
  if (/\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/.test(normalized)) return "direct_command_drive_forward";
  if (/\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/.test(normalized)) return "direct_command_drive_backward";
  if (/\b(turn|rotate)\s+left\b/.test(normalized)) return "direct_command_turn_left";
  if (/\b(turn|rotate)\s+right\b/.test(normalized)) return "direct_command_turn_right";
  if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b/.test(normalized)) return "direct_command_retreat";
  if (/\blook around\b|\bcheck the room\b|\bscan\b/.test(normalized)) return "direct_command_look";
  if (/\b(hello|hi|hey|looi)\b/.test(normalized)) return "greeting";
  if (normalized.endsWith("?") || /^(why|what|who|how|can you|are you)\b/.test(normalized)) return "direct_question";
  return "unknown";
}

function performResponse({ policy = {}, text = "", tone = "soft", movement = ["still"], scenario = null, reason = "rule", confidence = 0.5 } = {}) {
  const speechText = policy.localSpeechAllowed === false ? "" : String(text ?? "").slice(0, 240);

  return brainResponse({
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

function movementResponse({ policy, text, movement, reason, confidence }) {
  if (!policy.localMotionArmed) {
    return performResponse({
      policy,
      text: "My body is not armed yet.",
      movement: ["still"],
      reason: `${reason}_motion_disarmed`,
      confidence
    });
  }

  return performResponse({
    policy,
    text,
    movement,
    reason,
    confidence
  });
}

function brainResponse({ text = null, action = null, reason = "rule", confidence = 0.5 } = {}) {
  return {
    ok: true,
    text,
    action,
    reason,
    confidence
  };
}

function latestText(context = {}) {
  return String(
    context.triggerEvent?.payload?.text ??
      context.triggerEvent?.text ??
      context.recentEvents?.[0]?.text ??
      ""
  );
}
