// Behavior selection only. Execution stays in motionStyles/LifeEngine.
export function chooseBehavior(state, now = Date.now(), options = {}) {
  const profile = options.personalityProfile ?? {};
  const traits = profile.coreTraits ?? {};
  const behaviorStyle = profile.behaviorStyle ?? {};

  if (Number(state?.stopRespectUntil || 0) > now) {
    return {
      name: state?.isListening ? "listen_pose" : "soft_idle",
      args: { respectStop: true },
      priority: 110
    };
  }

  if (state?.obstacle) {
    return {
      name: "scared_stop",
      args: { reason: "obstacle" },
      priority: 100
    };
  }

  if (state?.isListening) {
    return {
      name: "listen_pose",
      args: {},
      priority: 90
    };
  }

  if (state?.requestedBehavior) {
    return {
      name: state.requestedBehavior,
      args: state.requestedBehaviorArgs ?? {},
      priority: 80
    };
  }

  if (Number(state?.energy) < 0.2) {
    return {
      name: "sleepy_idle",
      args: {},
      priority: 60
    };
  }

  if (state?.userVisible && !state?.isSpeaking && !state?.isListening) {
    return {
      name: "listen_pose",
      args: { userVisible: true },
      priority: 45
    };
  }

  const idleThreshold = Math.max(
    0.68,
    0.82 - Number(behaviorStyle.idleActivity ?? 0.35) * 0.14
  );
  const curiosityThreshold = Math.max(
    0.72,
    0.88 - Number(traits.curiosity ?? 0.75) * 0.1
  );

  if (Number(state?.boredom) > idleThreshold && shouldAllowIdleMotion(state, now, options)) {
    return {
      name: "curious_scan",
      args: {
        direction: "both",
        intensity: Number(traits.shyness ?? 0.35) > 0.65 ? 0.3 : 0.45,
        style: Number(traits.shyness ?? 0.35) > 0.65 ? "shy" : "curious"
      },
      priority: 40
    };
  }

  if (Number(state?.curiosity) > curiosityThreshold && shouldAllowIdleMotion(state, now, options)) {
    return {
      name: "curious_scan",
      args: {
        direction: Math.random() > 0.5 ? "left" : "right",
        intensity: Number(traits.shyness ?? 0.35) > 0.65 ? 0.24 : 0.35
      },
      priority: 35
    };
  }

  return {
    name: "soft_idle",
    args: {},
    priority: 10
  };
}

export function shouldAllowIdleMotion(state, now = Date.now(), options = {}) {
  if (!state) {
    return false;
  }

  const calibration = options.calibration?.getSettings?.() ?? options.calibration ?? {};

  if (calibration.idleMotionEnabled === false) {
    return false;
  }

  if (now - Number(state.lastMotionAt || 0) < 4000) {
    return false;
  }

  if (now - Number(state.lastBehaviorAt || 0) < 2500) {
    return false;
  }

  if (state.isSpeaking || state.isListening) {
    return false;
  }

  if (Number(state.stopRespectUntil || 0) > now) {
    return false;
  }

  if (Number(state.fear) > 0.5 || state.obstacle) {
    return false;
  }

  return true;
}
