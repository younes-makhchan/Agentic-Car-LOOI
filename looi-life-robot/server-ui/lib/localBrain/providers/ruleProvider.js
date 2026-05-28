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

    switch (classification) {
      case "scenario_stop_following":
        return brainResponse({
          text: "I'll stop following.",
          action: scenarioAction("stop_following", { reason: "rule_follow_stop" }),
          reason: classification,
          confidence: 0.9
        });
      case "scenario_follow_target": {
        const label = extractFollowLabel(text, context);
        return brainResponse({
          text: label ? `I'll follow the ${label}.` : null,
          action: label ? scenarioAction("follow_target", { label, mode: "gentle" }) : null,
          reason: label ? classification : "follow_target_missing_label",
          confidence: label ? 0.82 : 0.45
        });
      }
      case "scenario_take_picture":
        return brainResponse({
          text: "Okay, hold still.",
          action: scenarioAction("take_picture"),
          reason: classification,
          confidence: 0.9
        });
      case "scenario_come_closer":
        return brainResponse({
          text: "Coming a little closer.",
          action: scenarioAction("come_closer"),
          reason: classification,
          confidence: 0.86
        });
      case "scenario_back_up":
        return brainResponse({
          text: "I'll give you room.",
          action: scenarioAction("back_up"),
          reason: classification,
          confidence: 0.86
        });
      case "scenario_look_left":
        return brainResponse({
          text: "Looking left.",
          action: scenarioAction("look_left"),
          reason: classification,
          confidence: 0.82
        });
      case "scenario_look_right":
        return brainResponse({
          text: "Looking right.",
          action: scenarioAction("look_right"),
          reason: classification,
          confidence: 0.82
        });
      case "greeting":
        return brainResponse({
          text: "Hi.",
          action: null,
          reason: classification,
          confidence: 0.7
        });
      case "direct_question":
      case "safety_stop":
      case "background":
      case "unknown":
      default:
        return brainResponse({
          text: classification === "safety_stop" ? "Stopping." : null,
          action: null,
          reason: classification,
          confidence: classification === "background" ? 0.35 : 0.5
        });
    }
  }
}

function classifyText(text) {
  const normalized = normalizeText(text);

  if (!normalized) return "background";
  if (/\b(stop following|stop tracking|cancel follow|cancel tracking|forget the target|never mind|nevermind)\b/.test(normalized)) return "scenario_stop_following";
  if (!/\bstopping\b|\bstop by\b/.test(normalized) && (/\b(stop|freeze|halt)\b/.test(normalized) || /\bdon'?t move\b|\bdo not move\b|\bstay still\b/.test(normalized))) return "safety_stop";
  if (/\b(follow|track)\b/.test(normalized)) return "scenario_follow_target";
  if (/\b(take|snap|shoot|capture)\b.*\b(picture|photo|selfie)\b|\b(picture|photo|selfie)\b.*\b(me|my)\b/.test(normalized)) return "scenario_take_picture";
  if (/\bcome here\b|\bcome closer\b|\bcome to me\b|\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/.test(normalized)) return "scenario_come_closer";
  if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b|\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/.test(normalized)) return "scenario_back_up";
  if (/\b(turn|rotate|look)\s+left\b/.test(normalized)) return "scenario_look_left";
  if (/\b(turn|rotate|look)\s+right\b/.test(normalized)) return "scenario_look_right";
  if (/\b(hello|hi|hey|looi|louie|lui|robot)\b/.test(normalized)) return "greeting";
  if (normalized.endsWith("?") || /^(why|what|who|how|can you|are you)\b/.test(normalized)) return "direct_question";
  return "unknown";
}

function scenarioAction(name, args = {}) {
  return {
    type: "run_scenario",
    args: {
      name,
      ...args
    }
  };
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

function extractFollowLabel(text, context = {}) {
  const normalized = normalizeText(text);
  const explicit = normalized.match(/\b(?:follow|track)\s+(?:the\s+|this\s+|that\s+)?([a-z][a-z -]{1,40})\b/);
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
