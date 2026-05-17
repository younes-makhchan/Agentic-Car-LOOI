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
        return brainResponse({
          actions: [{ type: "stop", args: { reason: "local_rule_stop" } }],
          reason: classification,
          confidence: 0.99
        });
      case "direct_command_approach":
        return brainResponse({
          text: policy.localMotionArmed ? "Coming closer." : "My body is not armed yet.",
          actions: policy.localMotionArmed
            ? [{ type: "approach_user", args: { style: "gentle", distance: "short" } }]
            : [{ type: "speak", args: { text: "My body is not armed yet.", tone: "soft" } }],
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_drive_forward":
        return movementResponse({
          policy,
          text: "Moving forward a little.",
          action: { type: "drive", args: { linear: 0.12, angular: 0, durationMs: 350 } },
          blockedEmotion: "attentive",
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_drive_backward":
        return movementResponse({
          policy,
          text: "Moving back a little.",
          action: { type: "drive", args: { linear: -0.12, angular: 0, durationMs: 350 } },
          blockedEmotion: "shy",
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_turn_left":
        return movementResponse({
          policy,
          text: "Turning left a little.",
          action: { type: "drive", args: { linear: 0, angular: -0.12, durationMs: 320 } },
          blockedEmotion: "curious",
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_turn_right":
        return movementResponse({
          policy,
          text: "Turning right a little.",
          action: { type: "drive", args: { linear: 0, angular: 0.12, durationMs: 320 } },
          blockedEmotion: "curious",
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_retreat":
        return brainResponse({
          actions: policy.localMotionArmed
            ? [{ type: "retreat", args: { style: "gentle", distance: "short" } }]
            : [{ type: "express", args: { emotion: "shy", intensity: 0.55 } }],
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_look":
        return brainResponse({
          actions: [{ type: "curious_scan", args: { direction: "both", intensity: 0.55 } }],
          reason: classification,
          confidence: 0.8
        });
      case "greeting":
        return brainResponse({
          text: "Hi.",
          actions: [
            { type: "express", args: { emotion: "happy", intensity: 0.6 } },
            { type: "speak", args: { text: "Hi.", tone: "happy" } }
          ],
          reason: classification,
          confidence: 0.7
        });
      case "direct_question":
        return brainResponse({
          text: "I'm listening locally.",
          actions: [
            { type: "express", args: { emotion: "curious", intensity: 0.55 } },
            { type: "speak", args: { text: "I'm listening locally.", tone: "soft" } }
          ],
          reason: classification,
          confidence: 0.55
        });
      case "background":
      case "unknown":
      default:
        return brainResponse({
          actions: [],
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

function movementResponse({ policy, text, action, blockedEmotion, reason, confidence }) {
  if (!policy.localMotionArmed) {
    return brainResponse({
      text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
      actions: [
        { type: "express", args: { emotion: blockedEmotion, intensity: 0.55 } },
        ...(policy.localSpeechAllowed === false
          ? []
          : [{ type: "speak", args: { text: "My body is not armed yet.", tone: "soft" } }])
      ],
      reason: `${reason}_motion_disarmed`,
      confidence
    });
  }

  return brainResponse({
    text: policy.localSpeechAllowed === false ? null : text,
    actions: [
      action,
      ...(policy.localSpeechAllowed === false
        ? []
        : [{ type: "speak", args: { text, tone: "soft" } }])
    ],
    reason,
    confidence
  });
}

function brainResponse({ text = null, actions = [], reason = "rule", confidence = 0.5 } = {}) {
  return {
    ok: true,
    text,
    actions,
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
