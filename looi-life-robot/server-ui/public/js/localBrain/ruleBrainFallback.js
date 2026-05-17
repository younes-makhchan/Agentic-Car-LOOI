export class RuleBrainFallback {
  classifyText(text, context = {}) {
    const gateClassification =
      context.triggerEvent?.payload?.classification ??
      context.speechGateResult?.classification ??
      null;

    if (["background", "noise"].includes(gateClassification)) {
      return "background";
    }

    if (gateClassification === "wake_name") {
      return "wake_name";
    }

    const normalized = normalizeText(text);

    if (!normalized) {
      return "background";
    }

    if (!/\bstopping\b|\bstop by\b/.test(normalized) && (/\b(stop|freeze|halt)\b/.test(normalized) || /\bdon'?t move\b|\bdo not move\b|\bstay still\b/.test(normalized))) {
      return "safety_stop";
    }

    if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(normalized)) {
      return "direct_command_approach";
    }

    if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b/.test(normalized)) {
      return "direct_command_retreat";
    }

    if (/\blook around\b|\bcheck the room\b|\bscan\b/.test(normalized)) {
      return "direct_command_look";
    }

    if (/\b(hello|hi|hey|looi|louie|lui|robot)\b/.test(normalized)) {
      return "greeting";
    }

    if (normalized.endsWith("?") || /^(why|what|who|how|can you|are you)\b/.test(normalized)) {
      return "direct_question";
    }

    if (context.reason === "autonomous_tick") {
      return "background";
    }

    return "unknown";
  }

  async think(context = {}) {
    const text = String(context.triggerEvent?.payload?.text ?? context.latestText ?? "");
    const classification = this.classifyText(text, context);
    const policy = context.policy ?? context.localPolicy ?? {};

    switch (classification) {
      case "safety_stop":
        return brainResponse({
          actions: [
            {
              type: "stop",
              args: { reason: "rule_brain_stop" },
              reason: "Safety stop phrase."
            }
          ],
          reason: classification,
          confidence: 0.99
        });
      case "direct_command_approach":
        if (!policy.localMotionArmed) {
          return brainResponse({
            text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
            actions: [
              {
                type: "express",
                args: { emotion: "attentive", intensity: 0.55 },
                reason: "User asked for movement while local motion is disarmed."
              },
              ...(policy.localSpeechAllowed === false
                ? []
                : [
                    {
                      type: "speak",
                      args: { text: "My body is not armed yet.", tone: "soft" },
                      reason: "Explain motion safety gate briefly."
                    }
                  ])
            ],
            reason: "motion_disarmed_approach",
            confidence: 0.82
          });
        }
        return brainResponse({
          actions: [
            {
              type: "approach_user",
              args: { style: "gentle", distance: "short" },
              reason: "User asked LOOI to come closer."
            }
          ],
          reason: classification,
          confidence: 0.86
        });
      case "direct_command_retreat":
        if (!policy.localMotionArmed) {
          return brainResponse({
            text: policy.localSpeechAllowed === false ? null : "I'll stay still and give you space.",
            actions: [
              {
                type: "express",
                args: { emotion: "shy", intensity: 0.55 },
                reason: "Respect personal space without moving because motion is disarmed."
              },
              ...(policy.localSpeechAllowed === false
                ? []
                : [
                    {
                      type: "speak",
                      args: { text: "I'll stay still and give you space.", tone: "soft" },
                      reason: "Acknowledge personal-space request safely."
                    }
                  ])
            ],
            reason: "motion_disarmed_retreat",
            confidence: 0.82
          });
        }
        return brainResponse({
          actions: [
            {
              type: "retreat",
              args: { style: "gentle", distance: "short" },
              reason: "User asked for more space."
            }
          ],
          reason: classification,
          confidence: 0.88
        });
      case "direct_command_look":
        if (!policy.localMotionArmed) {
          return brainResponse({
            actions: [
              policy.localCameraAllowed
                ? {
                    type: "observe_scene",
                    args: { includeSnapshot: false },
                    reason: "Look request handled as local observation while motion is disarmed."
                  }
                : {
                    type: "express",
                    args: { emotion: "curious", intensity: 0.55 },
                    reason: "Curious face only; motion and camera are not allowed."
                  }
            ],
            reason: policy.localCameraAllowed ? "observe_without_motion" : "curious_without_motion",
            confidence: 0.74
          });
        }
        return brainResponse({
          actions: [
            {
              type: "curious_scan",
              args: { direction: "both", intensity: 0.55 },
              reason: "User asked LOOI to look around."
            }
          ],
          reason: classification,
          confidence: 0.8
        });
      case "greeting":
      case "wake_name":
        return brainResponse({
          text: policy.localSpeechAllowed === false ? null : classification === "wake_name" ? "Hm?" : "Hi.",
          actions: [
            {
              type: "express",
              args: { emotion: classification === "wake_name" ? "attentive" : "happy", intensity: 0.6 },
              reason: classification === "wake_name" ? "Wake name heard." : "Friendly greeting."
            },
            ...(policy.localSpeechAllowed === false
              ? []
              : [
                  {
                    type: "speak",
                    args: {
                      text: classification === "wake_name" ? "Hm?" : "Hi.",
                      tone: classification === "wake_name" ? "soft" : "happy"
                    },
                    reason: "Short local attention response."
                  }
                ])
          ],
          reason: classification,
          confidence: 0.7
        });
      case "direct_question":
        return brainResponse({
          actions: [
            {
              type: "express",
              args: { emotion: "curious", intensity: 0.55 },
              reason: "A question deserves attention, but no real model is connected yet."
            },
            {
              type: "speak",
              args: { text: "I'm listening. My local brain is only a simple mock for now.", tone: "soft" },
              reason: "Explain current local-brain limitation briefly."
            }
          ],
          reason: classification,
          confidence: 0.55
        });
      case "background":
      case "unknown":
      default:
        if (context.reason === "autonomous_tick" && Number(context.lifeState?.boredom) > 0.82) {
          return brainResponse({
            actions: [
              {
                type: "express",
                args: { emotion: "curious", intensity: 0.5 },
                reason: "Quiet autonomous curiosity without movement."
              }
            ],
            reason: "autonomous_boredom_expression",
            confidence: 0.46
          });
        }

        return brainResponse({
          actions: [
            {
              type: "none",
              args: {},
              reason: "No safe local action needed."
            }
          ],
          reason: classification,
          confidence: 0.35
        });
    }
  }
}

function brainResponse({ text = null, actions = [], reason = "rule", confidence = 0.5 } = {}) {
  return {
    ok: true,
    source: "rule_fallback",
    text,
    actions,
    reason,
    confidence,
    shouldRemember: false
  };
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\w\s'?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
