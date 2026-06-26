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
    const text = normalizeText(latestText(context));
    const scenario = inferScenario(text, context);

    if (!scenario) {
      return response({
        text: text && /\b(hello|hi|hey|looi|louie|lui|robot)\b/.test(text) ? "Hi." : null,
        reason: text ? "mock_no_scenario" : "mock_quiet",
        confidence: 0.45
      });
    }

    return response({
      text: scenario.text,
      action: scenario.args
        ? {
            type: "run_scenario",
            args: scenario.args
          }
        : null,
      reason: scenario.reason,
      confidence: scenario.confidence
    });
  }
}

function inferScenario(text, context = {}) {
  if (!text) {
    return null;
  }

  // DISABLED_ROBOFLOW_FOLLOW: follow/track requests are conversational only.
  if (/\b(follow|track|keep following|keep tracking|stop following|stop tracking|cancel follow|cancel tracking|forget the target)\b/.test(text)) {
    return {
      args: null,
      text: "I can look with my camera, but continuous following is disabled.",
      reason: "follow_disabled",
      confidence: 0.78
    };
  }

  if (/\b(take|snap|shoot|capture)\b.*\b(picture|photo|selfie)\b|\b(picture|photo|selfie)\b.*\b(me|my)\b/.test(text)) {
    return {
      args: { name: "take_picture" },
      text: "Okay, hold still.",
      reason: "take_picture_request",
      confidence: 0.9
    };
  }

  if (/\bcome here\b|\bcome closer\b|\bcome to me\b|\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/.test(text)) {
    return {
      args: { name: "come_closer" },
      text: "Coming a little closer.",
      reason: "come_closer_request",
      confidence: 0.86
    };
  }

  if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b|\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/.test(text)) {
    return {
      args: { name: "back_up" },
      text: "I'll give you room.",
      reason: "back_up_request",
      confidence: 0.86
    };
  }

  if (/\b(turn|rotate|look)\s+left\b/.test(text)) {
    return {
      args: { name: "look_left" },
      text: "Looking left.",
      reason: "look_left_request",
      confidence: 0.82
    };
  }

  if (/\b(turn|rotate|look)\s+right\b/.test(text)) {
    return {
      args: { name: "look_right" },
      text: "Looking right.",
      reason: "look_right_request",
      confidence: 0.82
    };
  }

  return null;
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

function extractFollowLabel(text, context = {}) {
  if (!/\b(follow|track)\b/.test(text)) {
    return "";
  }

  const explicit = text.match(/\b(?:follow|track)\s+(?:the\s+|this\s+|that\s+)?([a-z][a-z -]{1,40})\b/);
  const label = explicit?.[1]?.replace(/\b(please|now|for me)\b/g, "").trim();
  if (label && !["it", "this", "that", "me"].includes(label)) {
    return label;
  }

  return String(
    context?.recentObjectReference?.label ??
      context?.vision?.activeTarget?.label ??
      context?.vision?.objects?.find?.((object) => object?.visible)?.label ??
      ""
  ).trim();
}

function latestText(context = {}) {
  return String(
    context.triggerEvent?.payload?.text ??
      context.triggerEvent?.text ??
      context.recentEvents?.[0]?.text ??
      ""
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s'?-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
