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
        actions: [
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
        actions: [
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

    if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(text)) {
      if (!policy.localMotionArmed) {
        return response({
          text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
          actions: [
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
        actions: [
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
          actions: [
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
        actions: [
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
          actions: [
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
        actions: [
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
          actions: [
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
        actions: [
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
        actions: [
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
        actions: [
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
      actions: [
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

function response({ text = null, actions = [], reason = "mock", confidence = 0.8 } = {}) {
  return {
    ok: true,
    source: "mock",
    text,
    actions,
    reason,
    confidence,
    shouldRemember: false
  };
}

function movementResponse({ policy, text, action, blockedEmotion, reason }) {
  if (!policy.localMotionArmed) {
    return response({
      text: policy.localSpeechAllowed === false ? null : "My body is not armed yet.",
      actions: [
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
    actions: [
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
