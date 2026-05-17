# LOOI Robot Body Skill

## Body Calibration

The browser owns body calibration. KimiClaw Cloud does not receive raw motor controls and should not try to tune PWM directly.

Notes:
- Local calibration can change speed, ramp, trims, deadband, and Life Engine motion intensity.
- Physical actions may be rejected if Cloud Motion is disarmed or safety gates block movement.
- If motion feels wrong, use the browser `Body Tuning / Calibration` panel with wheels lifted.
- KimiClaw should avoid repeated fast movement and should respect failed/rejected action results.

## Camera / Eyes

The phone browser owns camera access. KimiClaw Cloud can request camera actions through the Robot Bridge, but those requests only run when the local browser user enables `Cloud Camera Allowed`.

Camera actions:
- `open_front_camera` opens the selfie/front camera.
- `open_back_camera` opens the rear/environment camera.
- `switch_camera` switches between front and back when supported.
- `close_camera` stops the local camera stream.
- `observe_scene` returns compact runtime, camera, and perception metadata.
- `capture_snapshot` returns a small optional thumbnail snapshot.

Example commands:

```bash
node scripts/send_robot_action.mjs --status
node scripts/send_robot_action.mjs --type open_front_camera --args '{}' --wait
node scripts/send_robot_action.mjs --type open_back_camera --args '{}' --wait
node scripts/send_robot_action.mjs --type observe_scene --args '{"includeSnapshot":false}' --wait
node scripts/send_robot_action.mjs --type capture_snapshot --args '{"includeDataUrl":true,"maxWidth":320}' --wait
node scripts/send_robot_action.mjs --type close_camera --args '{}' --wait
```

Privacy rules:
- The server never accesses the camera.
- Video is not streamed to the bridge.
- Cloud Camera is off by default in the browser UI.
- Snapshots are small and explicit, not continuous uploads.
- Do not confuse `ROBOT_BRIDGE_TOKEN` with the browser runtime token.
- Physical movement still requires `Cloud Motion Armed`; camera permission does not arm movement.

## Personality And Memory

LOOI should be treated as a small phone-bodied companion robot with body language, mood, limited senses, and memory. Keep replies short, warm, and embodied. Do not call her an RC car, and do not pretend to have senses or movement that status/tool results do not support.

Memory commands:

```bash
node scripts/send_robot_action.mjs --memory
node scripts/send_robot_action.mjs --write-memory "The user prefers gentle movement." --memory-type long_term
node scripts/send_robot_action.mjs --learned-phrases
node scripts/send_robot_action.mjs --add-learned-phrase --phrase "give me room" --meaning "increase distance from user" --action retreat --args-json '{"style":"gentle","distance":"short"}' --confidence medium
```

Learned phrases must map to safe high-level actions only. Do not learn raw motor behavior. Do not store tokens, API keys, passwords, or other secrets. If a phrase is ambiguous, ask a short clarification instead of guessing.

Life events such as `boredom_high`, `user_returned`, `low_energy`, or `ignored_too_long` are context, not commands. Respond only when useful and do not spam movement or speech.

This is a KimiClaw/OpenClaw skill for the LOOI phone-bodied robot. It is cloud-first: KimiClaw Cloud sends high-level action intentions to the public HTTPS Robot Bridge, and the phone browser executes approved actions locally.

This skill does not talk to the ESP32 directly, does not move motors directly, and never sends raw PWM.

## Physical Execution

- KimiClaw Cloud sends high-level actions to the Robot Bridge.
- The phone browser must be open and KimiClaw Bridge polling must be started.
- Physical movement only happens if Cloud Motion is armed in the browser UI.
- The local Life Engine may modify or reject actions for safety.
- Stop actions should always be sent immediately when requested by the user.

## Feedback Loop

The helper script can query runtime status and wait for action results. This lets KimiClaw avoid acting blindly.

Check runtime status:

```bash
node scripts/send_robot_action.mjs --status
```

Send a physical action and wait for completion:

```bash
node scripts/send_robot_action.mjs \
  --type approach_user \
  --args '{"style":"happy","distance":"short"}' \
  --reason "user asked me to come closer" \
  --wait \
  --timeout-ms 15000
```

Fetch a specific action:

```bash
node scripts/send_robot_action.mjs --get-action action_123
```

Terminal statuses:
- `completed`: the phone browser accepted and completed the action result path.
- `failed`: execution hit an error.
- `rejected`: local browser safety policy or Life Engine rejected the action.
- Timed out: `--wait` did not see a terminal status before timeout.

If `cloudMotionArmed` is false, physical movement should be expected to reject. If runtime is offline, the phone browser is not currently listening.

## Event Inbox

KimiClaw Cloud cannot hear the phone microphone directly. The browser runtime uses local Web Speech recognition and posts transcripts to the Robot Event Inbox. KimiClaw can fetch or wait for those events, then respond with bridge actions.

Fetch new speech/text events:

```bash
node scripts/send_robot_action.mjs --new-events
```

Wait for the user to speak:

```bash
node scripts/send_robot_action.mjs --wait-event --event-types user_speech,user_text --timeout-ms 30000
```

Claim events:

```bash
node scripts/send_robot_action.mjs --claim-events
```

Mark an event handled:

```bash
node scripts/send_robot_action.mjs --mark-event-handled event_123
```

Example cloud workflow:
- User speaks to the phone.
- Browser posts a `user_speech` event.
- KimiClaw waits for or claims the event.
- KimiClaw sends a short `speak`, `express`, or physical action through the Robot Bridge.
- Browser executes or rejects safely.
- KimiClaw marks the event handled.

Physical motion still requires Cloud Motion Armed in the UI.

## Pairing And Tokens

- KimiClaw Cloud uses `ROBOT_BRIDGE_TOKEN` to enqueue actions, query status, and wait for results.
- The browser runtime can be protected separately with `ROBOT_RUNTIME_PAIRING_CODE`.
- After pairing, the browser receives a runtime token for heartbeat and claim/complete/fail/reject endpoints.
- Do not confuse the bridge token with the runtime token.
- Do not publish real tokens.

## Configuration

Set these environment variables in your KimiClaw/OpenClaw environment:

```bash
ROBOT_BRIDGE_PUBLIC_URL=https://your-public-url
ROBOT_BRIDGE_TOKEN=your-secret-token
```

For KimiClaw Cloud, `ROBOT_BRIDGE_PUBLIC_URL` must be a public HTTPS URL from a secure tunnel or deployed bridge server. Keep `ROBOT_BRIDGE_TOKEN` private and do not hardcode it in skill files.

For local OpenClaw testing, `ROBOT_BRIDGE_PUBLIC_URL` can be `http://localhost:3000`. Use `--allow-no-token` only for local development with `ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL=true`.

## Usage

```bash
node scripts/send_robot_action.mjs --type curious_scan --args '{"direction":"both","intensity":0.7}' --reason "user asked me to look around" --wait
```

```bash
node scripts/send_robot_action.mjs --type stop --args '{"reason":"user_stop"}' --reason "user asked me to stop" --wait
```

```bash
node scripts/send_robot_action.mjs --type speak --args '{"text":"Okay, I am here.","tone":"happy"}'
```

```bash
node scripts/send_robot_action.mjs --add-learned-phrase --phrase "give me room" --meaning "increase distance from user" --action retreat --args-json '{"style":"gentle","distance":"short"}' --confidence medium
```

Never publish this skill with real tokens.
## Ngrok Bridge Header

If the robot bridge is exposed through ngrok, every bridge API request must include:

```http
ngrok-skip-browser-warning: true
```

Use it together with the normal bridge headers:

```http
Authorization: Bearer ROBOT_BRIDGE_TOKEN
Content-Type: application/json
ngrok-skip-browser-warning: true
```

This avoids ngrok returning its browser warning HTML page instead of the robot bridge JSON response.
