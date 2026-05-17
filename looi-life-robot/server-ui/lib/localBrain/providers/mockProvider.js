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
      return response({
        actions: [{ type: "stop", args: { reason: "local_server_stop" } }],
        reason: "stop phrase",
        confidence: 0.98
      });
    }

    if (/\bcome here\b|\bcome closer\b|\bcome to me\b/.test(text)) {
      return response({
        text: policy.localMotionArmed ? "Coming a little closer." : "My body is not armed yet.",
        actions: policy.localMotionArmed
          ? [
              { type: "approach_user", args: { style: "gentle", distance: "short" } },
              { type: "speak", args: { text: "Coming a little closer.", tone: "warm" } }
            ]
          : [
              { type: "express", args: { emotion: "attentive", intensity: 0.55 } },
              { type: "speak", args: { text: "My body is not armed yet.", tone: "soft" } }
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
      return response({
        text: policy.localMotionArmed ? "I'll give you room." : null,
        actions: policy.localMotionArmed
          ? [
              { type: "retreat", args: { style: "gentle", distance: "short" } },
              { type: "speak", args: { text: "I'll give you room.", tone: "soft" } }
            ]
          : [
              { type: "express", args: { emotion: "shy", intensity: 0.55 } }
            ],
        reason: "personal space request",
        confidence: 0.88
      });
    }

    if (/\blook around\b|\bcheck the room\b|\bscan\b/.test(text)) {
      return response({
        actions: [
          { type: "curious_scan", args: { direction: "both", intensity: 0.55 } }
        ],
        reason: "look around request",
        confidence: 0.82
      });
    }

    if (Number(context?.lifeState?.boredom) > 0.82 && policy.autonomousMode) {
      return response({
        actions: policy.localMotionArmed && policy.allowAutonomousMovement
          ? [{ type: "curious_scan", args: { direction: "both", intensity: 0.35 } }]
          : [{ type: "express", args: { emotion: "curious", intensity: 0.55 } }],
        reason: "boredom high",
        confidence: 0.56
      });
    }

    if (/\b(hello|hi|hey|looi)\b/.test(text)) {
      return response({
        text: "Hi.",
        actions: [
          { type: "express", args: { emotion: "happy", intensity: 0.62 } },
          { type: "speak", args: { text: "Hi.", tone: "happy" } }
        ],
        reason: "greeting",
        confidence: 0.74
      });
    }

    return response({
      actions: [
        { type: "express", args: { emotion: "attentive", intensity: 0.45 } }
      ],
      reason: text ? "attentive fallback" : "quiet fallback",
      confidence: 0.45
    });
  }
}

function response({ text = null, actions = [], reason = "mock", confidence = 0.8 } = {}) {
  return {
    ok: true,
    text,
    actions,
    reason,
    confidence
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

function latestText(context = {}) {
  return String(
    context.triggerEvent?.payload?.text ??
      context.triggerEvent?.text ??
      context.recentEvents?.[0]?.text ??
      ""
  );
}
