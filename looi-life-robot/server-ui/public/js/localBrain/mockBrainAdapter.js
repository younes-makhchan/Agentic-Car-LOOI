export class MockBrainAdapter {
  constructor({ logger } = {}) {
    this.logger = logger;
  }

  async isAvailable() {
    return true;
  }

  async think(context = {}) {
    const event = context.triggerEvent ?? latestEvent(context.recentEvents);
    const text = extractText(event).toLowerCase();
    const policy = context.policy ?? {};
    const classification = event?.payload?.classification ?? context.speechGateResult?.classification ?? null;

    if (["background", "noise"].includes(classification)) {
      return response({
        legacyPlan: [
          {
            type: "none",
            args: {},
            reason: "Background speech is ignored."
          }
        ],
        reason: "background_ignored",
        confidence: 0.72
      });
    }

    if (/\b(stop|freeze|halt)\b/.test(text) || /\bdon'?t move\b/.test(text)) {
      return response({
        legacyPlan: [
          {
            type: "stop",
            args: { reason: "local_brain_stop_phrase" },
            reason: "User asked LOOI to stop."
          }
        ],
        reason: "stop phrase",
        confidence: 0.98
      });
    }

    if (/\b(take|snap|shoot|capture)\b.*\b(picture|photo|selfie)\b|\b(picture|photo|selfie)\b.*\b(me|my)\b/.test(text)) {
      return response({
        text: policy.localSpeechAllowed === false ? null : "Okay, hold still.",
        legacyPlan: [
          {
            type: "scenario_take_picture",
            args: {},
            reason: "User asked LOOI to take a picture."
          },
          ...(policy.localSpeechAllowed === false
            ? []
            : [{ type: "speak", args: { text: "Okay, hold still.", tone: "happy" } }])
        ],
        reason: "take picture scenario",
        confidence: 0.9
      });
    }

    if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(text)) {
      if (!policy.localMotionArmed) {
        return response({
          text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
          legacyPlan: [
            {
              type: "express",
              args: { emotion: "attentive", intensity: 0.55 },
              reason: "Movement request heard, but Local Motion is disarmed."
            },
            ...(policy.localSpeechAllowed === false
              ? []
              : [
                  {
                    type: "speak",
                    args: { text: "My body is not armed yet.", tone: "soft" },
                    reason: "Explain the local safety gate."
                  }
                ])
          ],
          reason: "approach blocked by policy",
          confidence: 0.84
        });
      }

      return response({
        text: "Coming a little closer.",
        legacyPlan: [
          {
            type: "approach_user",
            args: { style: "gentle", distance: "short" },
            reason: "User asked LOOI to come closer."
          },
          {
            type: "speak",
            args: { text: "I'll come a little closer.", tone: "warm" },
            reason: "Acknowledge the request briefly."
          }
        ],
        reason: "approach request",
        confidence: 0.86
      });
    }

    if (/\b(move|go|drive|roll)\s+(forward|forwards|ahead|straight)\b|\bforward a little\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Moving forward a little.",
        action: { type: "drive", args: { linear: 0.12, angular: 0, durationMs: 350 } },
        blockedEmotion: "attentive",
        reason: "drive forward request"
      });
    }

    if (/\b(move|drive|roll)\s+(back|backward|backwards|reverse)\b|\breverse a little\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Moving back a little.",
        action: { type: "drive", args: { linear: -0.12, angular: 0, durationMs: 350 } },
        blockedEmotion: "shy",
        reason: "drive backward request"
      });
    }

    if (/\b(turn|rotate)\s+left\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Turning left a little.",
        action: { type: "drive", args: { linear: 0, angular: -0.12, durationMs: 320 } },
        blockedEmotion: "curious",
        reason: "turn left request"
      });
    }

    if (/\b(turn|rotate)\s+right\b/.test(text)) {
      return movementResponse({
        policy,
        text: "Turning right a little.",
        action: { type: "drive", args: { linear: 0, angular: 0.12, durationMs: 320 } },
        blockedEmotion: "curious",
        reason: "turn right request"
      });
    }

    if (/\bgive me (space|room)\b|\bgo back\b|\bback up\b|\bnot too close\b/.test(text)) {
      if (!policy.localMotionArmed) {
        return response({
          text: policy.localSpeechAllowed === false ? null : "I'll stay still and give you space.",
          legacyPlan: [
            {
              type: "express",
              args: { emotion: "shy", intensity: 0.55 },
              reason: "User requested space; motion is disarmed."
            },
            ...(policy.localSpeechAllowed === false
              ? []
              : [
                  {
                    type: "speak",
                    args: { text: "I'll stay still and give you space.", tone: "soft" },
                    reason: "Acknowledge safely without movement."
                  }
                ])
          ],
          reason: "retreat blocked by policy",
          confidence: 0.84
        });
      }

      return response({
        text: "I'll give you room.",
        legacyPlan: [
          {
            type: "retreat",
            args: { style: "gentle", distance: "short" },
            reason: "User asked for personal space."
          },
          {
            type: "speak",
            args: { text: "I'll give you room.", tone: "soft" },
            reason: "Respect personal space."
          }
        ],
        reason: "retreat request",
        confidence: 0.88
      });
    }

    if (/\blook around\b|\bcheck the room\b|\bscan\b/.test(text)) {
      if (!policy.localMotionArmed) {
        return response({
          legacyPlan: [
            policy.localCameraAllowed
              ? {
                  type: "observe_scene",
                  args: { includeSnapshot: false },
                  reason: "Observe without body motion."
                }
              : {
                  type: "express",
                  args: { emotion: "curious", intensity: 0.55 },
                  reason: "Curious face only because motion and camera are gated."
                }
          ],
          reason: policy.localCameraAllowed ? "observe without motion" : "look blocked by policy",
          confidence: 0.76
        });
      }

      return response({
        legacyPlan: [
          {
            type: "curious_scan",
            args: { direction: "both", intensity: 0.55 },
            reason: "User asked LOOI to look around."
          }
        ],
        reason: "look around request",
        confidence: 0.82
      });
    }

    if (!text && Number(context.lifeState?.boredom) > 0.82) {
      if (policy.localMotionArmed && policy.allowAutonomousMovement) {
        return response({
          legacyPlan: [
            {
              type: "curious_scan",
              args: { direction: "both", intensity: 0.35 },
              reason: "Low-frequency bored curiosity."
            }
          ],
          reason: "boredom high",
          confidence: 0.55
        });
      }

      return response({
        legacyPlan: [
          {
            type: "express",
            args: { emotion: "curious", intensity: 0.55 },
            reason: "Boredom is high, but movement is not allowed."
          }
        ],
        reason: "boredom expression",
        confidence: 0.5
      });
    }

    if (classification === "wake_name" || /\b(hello|hi|hey|looi|louie|lui|robot)\b/.test(text)) {
      return response({
        text: policy.localSpeechAllowed === false ? null : classification === "wake_name" ? "Hm?" : "Hi.",
        legacyPlan: [
          {
            type: "express",
            args: { emotion: classification === "wake_name" ? "attentive" : "happy", intensity: 0.65 },
            reason: classification === "wake_name" ? "Wake name heard." : "User greeted LOOI."
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
                  reason: "Short local acknowledgement."
                }
              ])
        ],
        reason: classification === "wake_name" ? "wake_name" : "greeting",
        confidence: 0.75
      });
    }

    if (context.reason === "autonomous_tick") {
      return response({
        legacyPlan: [
          {
            type: "express",
            args: { emotion: "curious", intensity: 0.45 },
            reason: "Quiet autonomous expression."
          }
        ],
        reason: "autonomous quiet expression",
        confidence: 0.45
      });
    }

    return response({
      legacyPlan: [
        {
          type: "express",
          args: { emotion: "attentive", intensity: 0.45 },
          reason: "Quiet attentive reaction."
        }
      ],
      reason: "mock attentive fallback",
      confidence: 0.45
    });
  }
}

function response({ text = null, legacyPlan = [], reason = "mock", confidence = 0.8 } = {}) {
  return {
    ok: true,
    source: "mock",
    text,
    action: normalizeOfficialAction(legacyPlan),
    reason,
    confidence,
    shouldRemember: false
  };
}

function normalizeOfficialAction(legacyPlan = []) {
  const list = Array.isArray(legacyPlan) ? legacyPlan : [];
  const speechAction = list.find((action) => action?.type === "speak");
  const movementAction = list.find((action) => action?.type !== "speak") ?? speechAction;

  return {
    type: "perform",
    args: {
      speech: speechForAction(speechAction),
      movement: movementForAction(movementAction),
      scenario: scenarioForAction(movementAction),
      timing: "parallel",
      iterateMovement: false
    },
    reason: movementAction?.reason ?? speechAction?.reason
  };
}

function speechForAction(action = {}) {
  if (action.type !== "speak") {
    return { text: "", tone: "soft" };
  }

  return {
    text: typeof action.args?.text === "string" ? action.args.text.slice(0, 240) : "",
    tone: typeof action.args?.tone === "string" ? action.args.tone.slice(0, 40) : "soft"
  };
}

function movementForAction(action = {}) {
  switch (action.type) {
    case "approach_user":
      return ["move_forward_tiny"];
    case "retreat":
      return ["move_backward_tiny"];
    case "curious_scan":
      return ["curious_shift"];
    case "excited_wiggle":
      return ["excited_wiggle"];
    case "scenario_take_picture":
      return ["still"];
    case "drive":
      return movementForDrive(action.args);
    case "express":
    case "observe_scene":
      return ["look_up"];
    case "speak":
    case "stop":
    case "none":
    default:
      return ["still"];
  }
}

function scenarioForAction(action = {}) {
  return action.type === "scenario_take_picture" ? "take_picture" : null;
}

function movementForDrive(args = {}) {
  const linear = Number(args.linear);
  const angular = Number(args.angular);

  if (Number.isFinite(linear) && Math.abs(linear) >= Math.abs(angular || 0) && Math.abs(linear) > 0.001) {
    return linear > 0 ? ["move_forward_tiny"] : ["move_backward_tiny"];
  }

  if (Number.isFinite(angular) && Math.abs(angular) > 0.001) {
    return angular < 0 ? ["look_left"] : ["look_right"];
  }

  return ["still"];
}

function movementResponse({ policy, text, action, blockedEmotion, reason }) {
  if (!policy.localMotionArmed) {
    return response({
      text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
      legacyPlan: [
        { type: "express", args: { emotion: blockedEmotion, intensity: 0.55 } },
        ...(policy.localSpeechAllowed === false
          ? []
          : [{ type: "speak", args: { text: "My body is not armed yet.", tone: "soft" } }])
      ],
      reason: `${reason} blocked by policy`,
      confidence: 0.84
    });
  }

  return response({
    text: policy.localSpeechAllowed === false ? null : text,
    legacyPlan: [
      action,
      ...(policy.localSpeechAllowed === false
        ? []
        : [{ type: "speak", args: { text, tone: "soft" } }])
    ],
    reason,
    confidence: 0.88
  });
}

function latestEvent(events = []) {
  return Array.isArray(events) && events.length ? events[0] : null;
}

function extractText(event = {}) {
  return String(event?.payload?.text ?? event?.text ?? "");
}
