export class AttentionSystem {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.mode = "idle";
    this.attentionTarget = "none";
    this.attentionUntil = 0;
    this.conversationUntil = 0;
    this.busyUntil = 0;
    this.stopRespectUntil = 0;
    this.lastWakeAt = 0;
    this.lastUserSpeechAt = 0;
    this.lastRobotSpeechAt = 0;
    this.lastReason = "init";
  }

  wake(reason = "wake", durationMs = 20000) {
    const now = Date.now();
    this.mode = "attentive";
    this.attentionTarget = "user";
    this.attentionUntil = Math.max(this.attentionUntil, now + clampDuration(durationMs, 1000, 60000, 20000));
    this.lastWakeAt = now;
    this.lastReason = reason;
    return this.getStatus();
  }

  enterConversation(reason = "conversation", durationMs = 30000) {
    const now = Date.now();
    this.mode = "conversation";
    this.attentionTarget = "user";
    this.attentionUntil = Math.max(this.attentionUntil, now + clampDuration(durationMs, 1000, 90000, 30000));
    this.conversationUntil = Math.max(this.conversationUntil, now + clampDuration(durationMs, 1000, 90000, 30000));
    this.lastUserSpeechAt = now;
    this.lastReason = reason;
    return this.getStatus();
  }

  enterBusy(reason = "busy", durationMs = 10000) {
    const now = Date.now();
    this.mode = "busy";
    this.busyUntil = Math.max(this.busyUntil, now + clampDuration(durationMs, 1000, 60000, 10000));
    this.lastReason = reason;
    return this.getStatus();
  }

  enterStopCooldown(reason = "stop", durationMs = 8000) {
    const now = Date.now();
    this.mode = "stop_cooldown";
    this.stopRespectUntil = Math.max(this.stopRespectUntil, now + clampDuration(durationMs, 1000, 30000, 8000));
    this.attentionUntil = Math.max(this.attentionUntil, this.stopRespectUntil);
    this.conversationUntil = 0;
    this.lastReason = reason;
    return this.getStatus();
  }

  update(now = Date.now()) {
    if (this.stopRespectUntil > now) {
      this.mode = "stop_cooldown";
    } else if (this.busyUntil > now) {
      this.mode = "busy";
    } else if (this.conversationUntil > now) {
      this.mode = "conversation";
    } else if (this.attentionUntil > now) {
      this.mode = "attentive";
    } else if (this.mode !== "asleep") {
      this.mode = "idle";
      this.attentionTarget = "none";
    }

    return this.getStatus(now);
  }

  shouldAttendToSpeech(classification) {
    this.update();
    return [
      "safety_stop",
      "wake_name",
      "direct_to_robot",
      "possible_direct_command",
      "question",
      "social_comment"
    ].includes(classification) || ["attentive", "conversation"].includes(this.mode);
  }

  shouldThinkAboutEvent(event) {
    this.update();

    if (event?.type === "local_stop_phrase") {
      return true;
    }

    if (this.mode === "stop_cooldown") {
      return false;
    }

    const classification = event?.payload?.classification;
    return this.shouldAttendToSpeech(classification) || event?.type === "autonomous_tick";
  }

  canAutonomouslyAct(policy = {}) {
    this.update();
    return Boolean(
      policy.autonomousMode &&
      this.mode !== "stop_cooldown" &&
      Date.now() >= Number(this.stopRespectUntil || 0)
    );
  }

  getStatus(now = Date.now()) {
    return {
      mode: this.mode,
      attentionTarget: this.attentionTarget,
      attentionUntil: this.attentionUntil,
      conversationUntil: this.conversationUntil,
      stopRespectUntil: this.stopRespectUntil,
      attentionRemainingMs: Math.max(0, this.attentionUntil - now),
      conversationRemainingMs: Math.max(0, this.conversationUntil - now),
      stopCooldownRemainingMs: Math.max(0, this.stopRespectUntil - now),
      lastWakeAt: this.lastWakeAt,
      lastUserSpeechAt: this.lastUserSpeechAt,
      lastRobotSpeechAt: this.lastRobotSpeechAt,
      lastReason: this.lastReason
    };
  }
}

function clampDuration(value, min, max, fallback) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}
