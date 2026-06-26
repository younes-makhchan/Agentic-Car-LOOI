# Open-Source LOOI Context

This project should stay a browser-first, owner-controlled desk robot instead of a cloud-owned robot fleet. The phone or browser session owns the face, camera, microphone, Gemini Live session, local perception, personality, and behavior policy. The ESP32 body stays a simple nearby actuator over Web Bluetooth.

## Internet Research Snapshot

- Gemini Live API is Preview and built for low-latency bidirectional audio, video, and text sessions over WebSockets.
- Gemini Live supports native audio, tool/function calling, input and output transcription, session management, context window compression, session resumption, and ephemeral tokens.
- Google recommends ephemeral tokens for client-side Live connections so the browser never receives the long-lived API key.
- Google documents robotic and smart-glasses style agents as target Live API use cases, which fits LOOI's realtime voice, camera, and movement loop.

Sources:

- https://ai.google.dev/gemini-api/docs/live
- https://ai.google.dev/gemini-api/docs/live-api-ephemeral-tokens
- https://ai.google.dev/gemini-api/docs/live-api-tools
- https://ai.google.dev/gemini-api/docs/live-api-session-management

## Product Target

LOOI should feel like a small embodied companion:

- expressive face and voice
- camera-grounded conversation
- short, initiative but non-annoying comments
- explicit user control for movement, following, photos, and persistent state changes
- local safety gates for motion
- useful without hardware in browser-only mode
- no account, robot token, or public remote-control path required

## Current Architecture Fit

The repo already has the right split:

- `public/js/gemini/` handles Gemini Live audio, video frames, tool calls, and runtime lifecycle.
- `public/js/vision/` handles object detection, tracking, active targets, and follow metadata.
- `public/js/robot/` converts approved tool actions into local scenarios and body commands.
- `public/js/embodiment/` owns expressive movement and scenario sequencing.
- `lib/gemini/geminiLiveToken.js` mints short-lived Gemini Live auth tokens from the server.
- `src/main.cpp` keeps the ESP32 body small and safety-clamped.

## Gemini Live Design Rules

- Keep the API key on the server and mint single-use Live auth tokens.
- Send microphone audio directly from the browser to Gemini Live.
- Send video frames at a controlled interval and pause them during model speech.
- Use Gemini tools only for high-level local scenarios, not raw motor control.
- Let local code own safety, calibration, follow control, stop behavior, and BLE routing.
- Enable context compression for long-running sessions.
- Track session-resumption handles and GoAway notices, but reconnect only through an explicit runtime policy.

## Build Priorities

1. Stabilize Gemini Live session lifecycle: context compression, session resumption state, GoAway handling, and reconnect policy.
2. Tighten embodied tool schema around user-visible scenarios only.
3. Make vision grounding reliable: latest video frame is the source of truth, Roboflow state is only tracking metadata.
4. Keep local fallback brain usable when Gemini Live is disabled or unavailable.
5. Improve hardware bring-up: calibration, test motions, safe defaults, and firmware flashing docs.
6. Add repeatable smoke tests for audio/video/tool/session state without real hardware.
