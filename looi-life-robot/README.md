# LOOI Life Robot

LOOI Life Robot is a local-first phone-bodied life robot. The phone/browser runtime is the face, ears, eyes, body runtime, safety layer, and fast local life loop, while the ESP32 is the body motor controller.

The active runtime path no longer requires KimiClaw Cloud. Legacy KimiClaw files and bridge endpoints may remain for reference, but the browser app now routes future thinking through the local event bus and `LocalBrainEngine`.

## Local-First Branch

This branch removes KimiClaw Cloud from the active robot brain. The robot is designed around a local phone/browser runtime and an optional laptop local model server that will be added later.

Why local-first:
- Lower latency for body presence and stop handling.
- Works on local Wi-Fi without internet.
- Better privacy for microphone, camera, memory, and behavior state.
- More embodied: the Life Engine keeps LOOI alive even without a cloud model.
- Cloud can be added later only as an optional advisor, not the main control path.

Architecture:

```text
Phone Browser Runtime
  sensors -> LocalEventBus -> LifeEngine
                         |
                         v
                  LocalBrainEngine
                         |
                         v
                   ToolExecutor
                         |
                         v
                    SafetyGate
                         |
                         v
                   CommandQueue
                         |
                         v
                       ESP32
```

Local-first rules:
- `LifeEngine` handles instant presence, reflexes, mood, attention, and safe body language.
- `LocalBrainEngine` handles local thinking and future autonomous decisions.
- `ToolExecutor` remains the only action path for brain actions.
- The server hosts UI, memory, config, and ESP32 gateway endpoints. The server does not move the robot as a brain.
- ESP32 remains the muscle controller only.
- Local Motion Armed is false by default.
- Autonomous Mode is false by default.
- Stop always works.
- The local brain never directly controls ESP32.

Local-first testing:

```bash
cd server-ui
npm run dev
```

Then open the UI:

1. Enable Simulator Mode.
2. Start Local Brain.
3. Type `hello` and confirm a local expression/speech response.
4. Type `come here` and confirm movement is rejected while Local Motion is disarmed.
5. Arm Local Motion.
6. Type `come here` again and confirm simulator movement goes through ToolExecutor and LifeEngine.
7. Type or say `stop` and confirm immediate stop.

Run the smoke check:

```bash
cd server-ui
npm run smoke:local-first
```

## Local-First Step 2: Laptop Local Brain Server

The laptop `server-ui` process can now run local thinking. The browser asks `POST /api/local-brain/think`, the server returns strict JSON action suggestions, and the browser still executes through `ToolExecutor`, `LifeEngine`, `SafetyGate`, `CommandQueue`, and ESP32.

The server never moves the robot and never connects to ESP32 as a brain. For local-first mode use mock, rule, Ollama, or a local OpenAI-compatible server. If `LOCAL_BRAIN_PROVIDER=groq` or `LOCAL_BRAIN_PROVIDER=fireworks`, the server calls a hosted LLM provider, but the browser still only receives structured action suggestions and still executes through the local safety path.

Providers:

Mock:

```bash
LOCAL_BRAIN_PROVIDER=mock
```

Rule:

```bash
LOCAL_BRAIN_PROVIDER=rule
```

Groq hosted provider:

```bash
LOCAL_BRAIN_PROVIDER=groq
LOCAL_BRAIN_MODEL=llama-3.1-8b-instant
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=your_groq_api_key
```

Fireworks hosted provider:

```bash
LOCAL_BRAIN_PROVIDER=fireworks
LOCAL_BRAIN_MODEL=accounts/fireworks/models/gpt-oss-20b
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_API_KEY=your_fireworks_api_key
FIREWORKS_TOP_P=1
FIREWORKS_TOP_K=40
FIREWORKS_PRESENCE_PENALTY=0
FIREWORKS_FREQUENCY_PENALTY=0
LOCAL_BRAIN_MAX_OUTPUT_TOKENS=192
```

Ollama:

```bash
ollama pull llama3.2:3b
```

`.env`:

```bash
LOCAL_BRAIN_PROVIDER=ollama
LOCAL_BRAIN_MODEL=llama3.2:3b
LOCAL_BRAIN_BASE_URL=http://localhost:11434
```

LM Studio / OpenAI-compatible local server:

```bash
LOCAL_BRAIN_PROVIDER=openai-compatible
LOCAL_BRAIN_MODEL=your-local-model
LOCAL_BRAIN_OPENAI_BASE_URL=http://localhost:1234/v1
LOCAL_BRAIN_OPENAI_API_KEY=local-not-needed
```

Phone network note:
- Open the UI from the laptop IP, for example `http://LAPTOP_IP:3000`.
- The phone talks to the laptop local brain through the same server origin.
- ESP32 still uses the configured server gateway path to the body controller.
- Simulator Mode is the easiest safe development loop.

Testing:

1. `cd server-ui`
2. `npm run dev`
3. Open the UI from the phone or laptop.
4. Enable Simulator Mode.
5. Start Local Brain.
6. Confirm provider shows `mock`.
7. Type `come here`.
8. With Local Motion disarmed, movement should be rejected.
9. Arm Local Motion.
10. Type `come here` again.
11. Simulator should move through ToolExecutor/LifeEngine.

Curl test:

```bash
curl -X POST http://localhost:3000/api/local-brain/think \
  -H "Content-Type: application/json" \
  -d '{
    "reason":"manual",
    "triggerEvent":{"type":"user_text","payload":{"text":"come here"}},
    "context":{
      "lifeState":{"mood":"curious","energy":0.8,"boredom":0.4},
      "policy":{"localMotionArmed":false,"localSpeechAllowed":true}
    }
  }'
```

Expected: JSON action suggestions only. No physical movement comes from the server.

Smoke test:

```bash
cd server-ui
npm run smoke:local-brain-server
```

## Local-First Step 3: Always-Listening Local Mind Runtime

The browser mic can now behave like robot ears. Current test mode sends every non-empty final transcript to the Local Brain so the LLM can decide whether to act, speak, or return `none`. Wake names still open an attention window, deterministic intents still attach a suggested action, and stop/freeze bypasses the model for immediate local stop handling.

Runtime flow:

```text
microphone / typed text / camera / life events
  -> LocalEventBus
  -> SpeechGate + AttentionSystem
  -> LifeEngine instant reaction
  -> LocalBrainEngine
  -> laptop local brain server or rule/mock fallback
  -> ToolExecutor
  -> LifeEngine / SafetyGate / CommandQueue
  -> ESP32 or Simulator
```

Safety rules:
- Local Motion Armed is false by default.
- Allow Autonomous Movement is false by default.
- Speech recognition can restart automatically; non-empty speech is sent to the Local Brain, while autonomous/camera events do not call the LLM by default.
- Stop/freeze/don't move is handled immediately without waiting for the model.
- Physical motion still requires Local Motion Armed and goes through `ToolExecutor`.
- Autonomous physical movement also requires Allow Autonomous Movement.

Simulator test:

1. `cd server-ui`
2. `npm run dev`
3. Open the UI and enable Simulator Mode.
4. Start Local Brain.
5. Enable Always Listening or use typed input.
6. Type or say `LOOI` and confirm attention mode becomes attentive.
7. Type or say `come here`.
8. With Local Motion disarmed, confirm movement is rejected or replaced with a safe explanation.
9. Arm Local Motion.
10. Type or say `come here` again and confirm simulator approach behavior.
11. Type or say `stop` and confirm immediate stop without model delay.

Open speech test:

1. Close/let expire the attention window.
2. Say an unrelated phrase.
3. Confirm classification is `open_speech` and the Local Brain receives it.
4. Confirm the model may choose `none` if no action is needed.

Autonomous test:

1. Enable Autonomous Mode with Allow Autonomous Movement off.
2. Wait or inject boredom.
3. Confirm the local brain may express/speak but does not move.
4. In simulator only, enable Allow Autonomous Movement and confirm occasional safe autonomous movement.

Real robot warning: lift wheels first, verify manual Emergency Stop, then test stop phrases before arming motion. Do not arm autonomous movement unsupervised.

Run the smoke check:

```bash
cd server-ui
npm run smoke:always-listening
```

## Local-First Step 4: LOOI-Style Embodied Life Polish

The browser runtime now has an embodiment layer. The Local Brain chooses high-level intentions, `EmbodiedActionRouter` maps those intentions to expressive macros, and `MotionMacroSequencer` plays timed face, speech, and safe body frames. The ESP32 still only receives bounded motor commands through `CommandQueue`.

Architecture:

```text
Speech / Camera / Telemetry / Life Events
  -> LocalEventBus
  -> LifeEngine + AttentionSystem
  -> LocalBrainEngine
  -> ToolExecutor
  -> EmbodiedActionRouter
  -> MotionMacroSequencer
  -> Face + Voice + CommandQueue
  -> ESP32 or Simulator
```

What changed:
- Motion macros define LOOI-style behaviors such as `soft_listen`, `thinking_pose`, `happy_approach`, `shy_retreat`, `curious_scan`, `excited_wiggle`, and `sleepy_idle`.
- `PriorityScheduler` coordinates emergency stop, user attention, local brain actions, camera tracking, autonomous life events, and idle micro-behaviors.
- `IdleMicroBehavior` gives subtle face-only life by default and only uses motion when motion is explicitly armed and autonomous movement is allowed.
- `AttentionMotorController` uses camera observations for eye attention immediately. Body tracking is gentle and off by default.
- `WakeLockManager` can keep the screen awake after user action.
- `PerformanceMonitor` and `ReliabilityManager` reduce non-essential behavior under load.

Safety:
- Local Motion Armed is false by default.
- Allow Autonomous Movement is false by default.
- Attention body tracking is off by default.
- LOOI Mode does not automatically enable physical movement.
- Emergency Stop interrupts macros, scheduler tasks, speech, LifeEngine movement, and motors.
- Server-side local brain endpoints still only return suggestions; the server never moves the robot.

Testing flow:

1. `npm run dev`
2. Open the UI.
3. Enable Simulator Mode.
4. Enable LOOI Mode.
5. Run Simulator LOOI Demo.
6. Start Local Brain.
7. Type `LOOI` and confirm soft listen/thinking behavior.
8. Type `come here` with Local Motion disarmed and confirm no body movement or partial macro only.
9. Arm Local Motion in simulator.
10. Type `come here` again and confirm an approach macro.
11. Say/type `stop` and confirm macro interruption and motor stop.
12. Enable Always Listening and test wake name plus attention window.
13. Test idle micro-behaviors.
14. Connect real ESP32 with wheels lifted.
15. Run Wheels-Lifted Safety Test.
16. Only then test on a safe flat surface.

Performance note: if FPS drops, reliability mode lengthens idle intervals and reduces non-essential behavior. Stillness is acceptable and often more lifelike than constant motion.

Run the smoke check:

```bash
cd server-ui
npm run smoke:embodied
```

## Core Architecture

- Phone: face, screen UI, camera, microphone, speaker, Life Engine, Local Event Bus, Local Brain, ToolExecutor, and browser runtime.
- Laptop/server: static UI, local memory, ESP32 gateway, and future local model server.
- ESP32: body controller responsible for safe physical execution only.
- Life Engine turns local state and high-level requests into living behavior and safe motion.
- ESP32 only executes safe motor commands.

## Responsibilities

- Local Brain: local reasoning scaffold, mock/rule adapter today, future local model adapter later.
- Life Engine: low-latency reactions, mood, attention, drives, body language, and the safety gate.
- ESP32: motor PWM, timeout stop, telemetry, and safe physical execution.
- Node server: web UI hosting, memory storage, local config, and ESP32 gateway.
- Browser UI: face, speech, camera, Life Engine runtime, Local Brain, and ESP32 connection.

## Project Layout

```text
looi-life-robot/
├── README.md
├── .gitignore
├── platformio.ini
├── src/
│   └── main.cpp
└── server-ui/
    ├── package.json
    ├── .env.example
    ├── server.js
    ├── memory/
    │   ├── MEMORY.md
    │   └── daily/
    │       └── .gitkeep
    └── public/
        ├── index.html
        ├── styles.css
        └── js/
            ├── app.js
            ├── config.js
            ├── core/
            │   └── localEventBus.js
            ├── localBrain/
            │   ├── localBrainEngine.js
            │   ├── mockBrainAdapter.js
            │   ├── ruleBrainFallback.js
            │   ├── actionParser.js
            │   ├── brainPolicy.js
            │   └── brainPrompt.js
            ├── life/
            │   ├── state.js
            │   ├── lifeEngine.js
            │   ├── behaviorTree.js
            │   ├── motionStyles.js
            │   └── safetyGate.js
            ├── robot/
            │   ├── esp32Client.js
            │   ├── commandQueue.js
            │   └── toolExecutor.js
            ├── perception/
            │   ├── speech.js
            │   └── camera.js
            └── ui/
                └── faceCanvas.js
```

## Run The Web App

```bash
cd server-ui
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## Complete First Setup: Firmware To Local Runtime

Use this checklist when setting up the whole system from zero.

### 1. Install Tools

On your computer:

```bash
node --version
npm --version
platformio --version
```

If `platformio` is missing, install PlatformIO first. You can use the VS Code PlatformIO extension or PlatformIO Core.

### 2. Configure And Upload ESP32 Firmware

Edit `src/main.cpp` before uploading:

```cpp
constexpr char WIFI_SSID[] = "YOUR_HOME_WIFI_NAME";
constexpr char WIFI_PASSWORD[] = "YOUR_HOME_WIFI_PASSWORD";
```

Use the same Wi-Fi network that your laptop and phone use.

Connect the ESP32 to your computer with USB, then upload:

```bash
cd looi-life-robot
platformio run --target upload
```

After upload, open serial monitor if you want to confirm boot:

```bash
platformio device monitor
```

The ESP32 should print something like:

```text
[WIFI] Connected to home Wi-Fi
[WIFI] IP: 192.168.1.73
[WIFI] WebSocket URL: ws://192.168.1.73:81
```

Copy that WebSocket URL. You will paste it into the browser UI.

If home Wi-Fi fails, the ESP32 starts fallback AP mode:

- SSID: `LOOI_BODY`
- Password: `looi123456`
- Fallback WebSocket URL: `ws://192.168.4.1:81`

### 3. Start The Browser Server

In a terminal:

```bash
cd looi-life-robot/server-ui
npm install
cp .env.example .env
npm run dev
```

Open on the computer first:

```text
http://localhost:3000
```

### 4. Test Without Real Motors First

In the UI:

1. Press `Enable Simulator Mode`.
2. Press `Register Runtime`.
3. Press `Start Heartbeat`.
4. Press `Start KimiClaw Bridge`.
5. Keep `Cloud Motion` disarmed.
6. Press `Inject Observe Scene Action` or `Inject Speak Action`.
7. Confirm actions appear and complete/reject safely.

Only after simulator works, test real motors.

### 5. Connect Phone And ESP32 On The Same Network

After station-mode firmware upload, all three devices should be on your home Wi-Fi:

```text
Phone browser -> home Wi-Fi
Laptop server -> home Wi-Fi
ESP32 body -> home Wi-Fi
```

Find your laptop IP address on the home Wi-Fi.

On macOS, usually:

```bash
ipconfig getifaddr en0
```

If that returns empty, try:

```bash
ipconfig getifaddr en1
```

On the phone, open:

```text
http://YOUR_LAPTOP_IP:3000
```

Example:

```text
http://192.168.1.50:3000
```

In the UI:

1. Set ESP32 URL to the URL printed by Serial Monitor, for example `ws://192.168.1.73:81`.
2. Press `Connect ESP32`.
3. Lift the wheels off the ground.
4. Press `Emergency Stop` first.
5. Try tiny manual movement.

### 6. Body Calibration

In the UI:

1. Open `Body Tuning / Calibration`.
2. Keep wheels lifted.
3. Press `Apply to Robot`.
4. Press `Test Stop`.
5. Arm `Calibration Test`.
6. Test tiny forward/back/rotate.
7. Adjust trim/ramp/speed.
8. Press `Save Calibration`.
9. Disarm `Calibration Test`.

Do not put the robot on the floor until Stop is verified.

### 7. Voice And Camera

Voice:

1. Open the `Voice` panel.
2. Press `Start Listening`.
3. Grant microphone permission.
4. Say `hello`.
5. Say `stop` or `freeze` to verify local emergency stop.

Camera:

1. Open `Camera / Eyes`.
2. Press `Start Front Camera`.
3. Grant camera permission.
4. Press `Capture Snapshot`.
5. Leave `Cloud Camera` blocked unless supervised.

### 8. Create Public Bridge For KimiClaw

KimiClaw Cloud cannot call `localhost`. Expose `server-ui` through HTTPS.

Option A: Cloudflare Tunnel.

```bash
cloudflared tunnel --url http://localhost:3000
```

Option B: ngrok.

```bash
ngrok http 3000
```

Put the public HTTPS URL in `server-ui/.env`:

```env
ROBOT_BRIDGE_PUBLIC_URL=https://your-public-url.example
ROBOT_BRIDGE_TOKEN=choose-a-long-random-token
ROBOT_BRIDGE_ALLOW_UNAUTH_LOCAL=true
ROBOT_REQUIRE_RUNTIME_AUTH=false
```

Restart the server after editing `.env`:

```bash
npm run dev
```

For serious use, keep `ROBOT_BRIDGE_TOKEN` enabled and do not publish it.

### 9. Connect KimiClaw/OpenClaw Skill

Use the skill folder:

```text
openclaw-skills/looi-robot-body
```

Set environment variables wherever KimiClaw/OpenClaw runs the helper:

```bash
export ROBOT_BRIDGE_PUBLIC_URL="https://your-public-url.example"
export ROBOT_BRIDGE_TOKEN="same-token-from-env"
```

If the public URL is ngrok, every KimiClaw/OpenClaw bridge request must include this header:

```http
ngrok-skip-browser-warning: true
```

Use it together with:

```http
Authorization: Bearer ROBOT_BRIDGE_TOKEN
Content-Type: application/json
```

Check runtime status:

```bash
cd openclaw-skills/looi-robot-body
node scripts/send_robot_action.mjs --status
```

If using local testing without token:

```bash
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs --status --allow-no-token
```

### 10. Start Full Runtime In The Browser

In the phone/computer UI:

1. Press `Register Runtime`.
2. Press `Start Heartbeat`.
3. Press `Start KimiClaw Bridge`.
4. Connect Simulator or ESP32.
5. Keep `Cloud Motion` disarmed at first.
6. Keep `Cloud Camera` blocked at first.

From helper terminal:

```bash
node scripts/send_robot_action.mjs --status
node scripts/send_robot_action.mjs --type speak --args '{"text":"I am connected.","tone":"happy"}' --wait
node scripts/send_robot_action.mjs --type observe_scene --args '{"includeSnapshot":false}' --wait
```

For movement:

1. Use Simulator Mode first.
2. Arm `Cloud Motion`.
3. Send:

```bash
node scripts/send_robot_action.mjs \
  --type approach_user \
  --args '{"style":"happy","distance":"short"}' \
  --wait
```

4. Confirm safe movement.
5. Disarm `Cloud Motion`.

### 11. Safety Rules Every Time

- Wheels lifted for first real movement.
- Emergency Stop visible and tested.
- Cloud Motion off unless supervised.
- Cloud Camera off unless supervised.
- Never expose bridge without token.
- Never give KimiClaw raw PWM or direct ESP32 access.
- Server queues actions only; browser executes locally through safety gates.

## Build The ESP32 Firmware

```bash
platformio run
platformio run --target upload
```

## ESP32 Body Firmware

The ESP32 body firmware is a local motor controller only. In the current setup it joins your home Wi-Fi and accepts short, clamped motion commands over WebSocket.

Wi-Fi:
- Edit `WIFI_SSID` and `WIFI_PASSWORD` in `src/main.cpp`.
- Read the assigned ESP32 IP from Serial Monitor.
- WebSocket URL format: `ws://ESP32_IP:81`
- If home Wi-Fi fails, fallback AP starts as `LOOI_BODY` / `looi123456`.
- Fallback AP WebSocket URL: `ws://192.168.4.1:81`

JSON motion command:

```json
{
  "type": "motion",
  "linear": 0.2,
  "angular": 0.0,
  "duration_ms": 500
}
```

JSON stop command:

```json
{
  "type": "stop",
  "reason": "user_stop"
}
```

Safety limits:
- `MAX_SPEED = 0.40`
- `MAX_DURATION_MS = 1000`
- `MIN_DURATION_MS = 50`
- `DEFAULT_DURATION_MS = 300`
- `DEADBAND = 0.03`
- Every motion auto-stops after its deadline.
- Disconnecting a WebSocket client forces an immediate motor stop.

Pin table:

| Side | IN1 | IN2 | EN/PWM | Invert Flag |
| --- | --- | --- | --- | --- |
| Left | 22 | 21 | 5 | `LEFT_INVERT` |
| Right | 19 | 18 | 23 | `RIGHT_INVERT` |

Hardware reminders:
- Test with the wheels lifted off the ground first.
- Verify stop behavior before putting the robot on the floor.
- ESP32 GND and L298N GND must be connected together.
- Do not power the motors from the ESP32.
- Remove the L298N enable jumpers if you want PWM speed control from the ESP32.

## Step 3: Browser-To-ESP32 Body Test

Browser-to-ESP32 body test:
1. Upload the ESP32 firmware.
2. Power the ESP32 and motor driver.
3. Keep phone, laptop, and ESP32 on the same home Wi-Fi.
4. Open the web UI from the phone with `http://YOUR_LAPTOP_IP:3000`.
5. Set the WebSocket URL to the ESP32 URL printed in Serial Monitor, for example `ws://192.168.1.73:81`.
6. Lift the wheels off the ground.
7. Press `Connect ESP32`.
8. Confirm telemetry appears.
9. Test Forward, Backward, and Rotate briefly.
10. Press `Emergency Stop` and verify the motors stop.

Troubleshooting:
- If the browser cannot connect, make sure phone, laptop, and ESP32 are on the same Wi-Fi network.
- Check that the WebSocket URL matches the IP printed by ESP32 Serial Monitor.
- Check the ESP32 Serial Monitor for Wi-Fi and WebSocket logs.
- If home Wi-Fi fails, the fallback AP is `LOOI_BODY` and fallback URL is `ws://192.168.4.1:81`.
- Some browsers may block mixed content if the UI is served over HTTPS. For this step, use `http://localhost:3000` or another non-HTTPS local setup.
- If the motors move the wrong direction, edit `LEFT_INVERT` or `RIGHT_INVERT` in `src/main.cpp`.
- If motor speed does not change, remove the `ENA` and `ENB` jumpers on the L298N and connect the enable pins to the ESP32 PWM pins.

## Step 4: Life Engine Core

The Life Engine runs locally in the browser. It makes LOOI feel alive before Kimi is added by handling mood, drives, attention, shallow reactions, the behavior tree, motion styles, and the browser-side safety gate.

It does not understand deep language yet, does not call Kimi, and does not write memory. When the ESP32 is connected, expressive motion goes through `SafetyGate` and `CommandQueue`. When the ESP32 is disconnected, the Life Engine still animates the face and simulates body-language requests without crashing.

Life Engine testing:
1. Start `server-ui` with `npm run dev`.
2. Open `http://localhost:3000`.
3. Confirm the face animates.
4. Watch mood and drive values update.
5. Press `Simulate User Attention`.
6. Press `Test Curious`.
7. Press `Test Happy` or `Test Wiggle`.
8. Connect the ESP32 with the wheels lifted.
9. Test Life Engine movement behaviors briefly.
10. Press `Emergency Stop` and verify the motors stop.

## Step 5: Simulator Mode

Simulator Mode lets you test the Life Engine and body command path without a real ESP32. It emits fake telemetry, logs motion commands instead of moving motors, and uses the same `CommandQueue` and Life Engine `SafetyGate` path as real movement. This is the safe development loop before adding Kimi/KimiClaw.

Simulator testing:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000`.
4. Enable `Simulator Mode`.
5. Confirm simulated telemetry appears.
6. Press Forward, Backward, and Rotate.
7. Press `Scenario: Come Here`.
8. Press `Scenario: Give Me Space`.
9. Press `Scenario: Look Around`.
10. Press `Scenario: Obstacle`.
11. Confirm forward Life Engine movement is rejected while obstacle is true.
12. Press `Emergency Stop`.

You can also run the simulator smoke check:

```bash
cd server-ui
npm run smoke:sim
```

When using the real ESP32, disable Simulator Mode and connect to the ESP32 WebSocket URL printed in Serial Monitor, for example `ws://192.168.1.73:81`.

## Legacy Reference: KimiClaw Cloud Robot Bridge

The sections below describe the old cloud bridge path. They remain as historical/reference notes only. On the local-first branch, `app.js` does not import the KimiClaw bridge client, does not start runtime heartbeat polling, and does not require public tunnels.

KimiClaw Cloud runs outside the robot's local network. It cannot reach `localhost` or the ESP32 WebSocket directly. Instead, KimiClaw Cloud calls a public HTTPS Robot Bridge URL. The server only queues high-level actions, and the phone browser polls that queue and receives actions locally.

Step 6 only proved the cloud-to-browser queue path. At that stage, claimed actions were logged in the browser and marked received without physical execution. Step 7 below connects approved actions to `ToolExecutor` and the Life Engine.

Public bridge options:
- Option A: Cloudflare Tunnel. Run `server-ui` locally, expose `http://localhost:3000` as HTTPS with `cloudflared`, set `ROBOT_BRIDGE_PUBLIC_URL` to the tunnel URL, and keep `ROBOT_BRIDGE_TOKEN` enabled.
- Option B: ngrok. Run `server-ui` locally, use `ngrok http 3000`, set `ROBOT_BRIDGE_PUBLIC_URL` to the ngrok HTTPS URL, and keep `ROBOT_BRIDGE_TOKEN` enabled.
- Option C: Deploy bridge server. Deploy `server-ui` to a small VPS/cloud service. The phone browser connects to that public server, while ESP32 remains local to the phone.

Important warnings:
- Do not expose the bridge without `ROBOT_BRIDGE_TOKEN`.
- Do not send raw motor commands from KimiClaw Cloud.
- Do not execute physical movement on the server.
- Physical robot execution must remain local in the phone browser.

Bridge setup:
1. `cd server-ui`
2. `cp .env.example .env`
3. Set `ROBOT_BRIDGE_TOKEN` in `.env`.
4. Set `ROBOT_BRIDGE_PUBLIC_URL` to your public HTTPS URL for cloud use.
5. `npm run dev`
6. Open the UI.
7. Start the `KimiClaw Cloud Bridge` panel.
8. Run a local test:

```bash
curl -X POST http://localhost:3000/api/robot-bridge/actions \
  -H "Content-Type: application/json" \
  -d '{"source":"test","type":"curious_scan","args":{"direction":"both","intensity":0.7},"reason":"local test"}'
```

Cloud-style test:

```bash
curl -X POST "$ROBOT_BRIDGE_PUBLIC_URL/api/robot-bridge/actions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ROBOT_BRIDGE_TOKEN" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"source":"kimi_claw_cloud","type":"approach_user","args":{"style":"happy","distance":"short"},"reason":"cloud test"}'
```

Expected result:
- The action appears in the KimiClaw Cloud Bridge panel.
- It is marked received but not physically executed.

OpenClaw skill setup:
- Copy `openclaw-skills/looi-robot-body` to your OpenClaw workspace skills folder.
- Set `ROBOT_BRIDGE_PUBLIC_URL=https://your-public-url` for KimiClaw Cloud.
- Set `ROBOT_BRIDGE_TOKEN=your_token`.
- Ask KimiClaw/OpenClaw: "Use the LOOI robot body skill and ask my robot to look around."

Security:
- Never expose the bridge without `ROBOT_BRIDGE_TOKEN`.
- Do not publish tokens.
- Do not allow raw motor tools.
- The server queue does not move the robot; browser Life Engine must approve actions.

You can run the bridge smoke check:

```bash
cd server-ui
npm run smoke:bridge
```

## Step 7: Safe KimiClaw Action Execution

KimiClaw Cloud actions now flow from the Robot Bridge into the browser-side `ToolExecutor`. The executor validates each high-level action, applies the browser execution policy, and routes physical behavior through `LifeEngine`, `SafetyGate`, and `CommandQueue`. The server still only stores and serves queued actions; it never moves the robot.

Physical cloud movement requires `Cloud Motion Armed` in the browser UI. This is off by default on every page load. `stop` actions always execute, even while cloud motion is disarmed. Non-physical actions include `speak`, `express`, `observe_scene`, and `remember`. Physical actions include `drive`, `approach_user`, `retreat`, body-moving `curious_scan`, and `excited_wiggle`.

Simulator test:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000`.
4. Enable `Simulator Mode`.
5. Start `KimiClaw Bridge`.
6. Inject `Come Here Action`.
7. Confirm it is rejected while `Cloud Motion` is disarmed.
8. Arm `Cloud Motion`.
9. Inject `Come Here Action` again.
10. Confirm the simulator receives short movement.
11. Inject `Stop Action`.
12. Confirm the queue stops.

Real robot test:
1. Upload the ESP32 firmware.
2. Power the robot.
3. Open the UI.
4. Connect to ESP32.
5. Lift wheels off the ground.
6. Start `KimiClaw Bridge`.
7. Arm `Cloud Motion`.
8. Send a cloud action from KimiClaw or curl.
9. Verify movement is short and safe.
10. Press `Emergency Stop`.
11. Disarm `Cloud Motion` before leaving the robot unattended.

Cloud curl example:

```bash
curl -X POST "$ROBOT_BRIDGE_PUBLIC_URL/api/robot-bridge/actions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ROBOT_BRIDGE_TOKEN" \
  -d '{
    "source":"kimi_claw_cloud",
    "type":"approach_user",
    "args":{"style":"happy","distance":"short"},
    "reason":"cloud execution test"
  }'
```

Expected result:
- If `Cloud Motion` is disarmed, the browser rejects physical movement.
- If armed and the robot or simulator is connected, the action executes through the Life Engine safety path.

Safety:
- Keep the robot supervised.
- Test real movement with wheels lifted first.
- Never expose `ROBOT_BRIDGE_TOKEN`.
- Never add raw motor or PWM tools.
- Never let KimiClaw Cloud connect directly to ESP32.

You can run the tool execution smoke check:

```bash
cd server-ui
npm run smoke:tools
```

## Step 8: Feedback Loop And Runtime Heartbeat

The phone browser can now register as the active robot runtime and send heartbeat snapshots to the Robot Bridge. KimiClaw Cloud can query whether the robot body is online, whether Cloud Motion is armed, whether simulator mode is active, whether the body is connected, current mood/behavior, obstacle state, motor state, and the latest action summary.

KimiClaw Cloud can also send an action and wait for the browser to mark it `completed`, `failed`, or `rejected`. The server still never moves the robot; it only stores actions, receives heartbeat/status updates, and returns action results.

Runtime pairing:
- `ROBOT_BRIDGE_TOKEN` is for KimiClaw Cloud and helper scripts.
- `ROBOT_RUNTIME_PAIRING_CODE` is entered in the browser UI when runtime auth is enabled.
- The browser receives a separate runtime token after pairing.
- Runtime tokens protect claim/complete/fail/reject/heartbeat endpoints when `ROBOT_REQUIRE_RUNTIME_AUTH=true`.
- Do not expose or publish either token.

Local feedback test:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000`.
4. Register runtime.
5. Start heartbeat.
6. Enable `Simulator Mode`.
7. Start `KimiClaw Bridge`.
8. Keep `Cloud Motion` disarmed.
9. From another terminal:

```bash
cd ../openclaw-skills/looi-robot-body
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs --status --allow-no-token
```

10. Send an action with wait:

```bash
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs \
  --type approach_user \
  --args '{"style":"happy","distance":"short"}' \
  --wait \
  --allow-no-token
```

11. Confirm the result is rejected because `Cloud Motion` is disarmed.
12. Arm `Cloud Motion` in the UI.
13. Send the action again with `--wait`.
14. Confirm the result is completed and simulator movement is logged.

Cloud test:
1. Expose `server-ui` with an HTTPS tunnel or deployed public server.
2. Set `ROBOT_BRIDGE_PUBLIC_URL` to that public HTTPS URL.
3. Set `ROBOT_BRIDGE_TOKEN`.
4. Register the phone browser runtime.
5. Start heartbeat and bridge polling.
6. In KimiClaw Cloud skill, call `node scripts/send_robot_action.mjs --status`.
7. Send physical actions with `--wait` so KimiClaw sees completion or rejection.

Safety:
- Do not arm cloud motion unattended.
- Keep the robot supervised.
- Stop action always works.
- Emergency Stop still works locally.
- KimiClaw Cloud still never talks to ESP32 directly.

You can run the runtime feedback smoke check:

```bash
cd server-ui
npm run smoke:runtime
```

## Step 9: Voice And Robot Event Inbox

The phone browser now acts as the robot's local ears and voice. Browser speech recognition uses the Web Speech API, and robot voice output uses local `speechSynthesis`. Typed input remains a fallback.

Speech transcripts are posted to the Robot Event Inbox so KimiClaw Cloud can fetch or wait for what the user said. The browser reacts immediately with an attentive face, but it does not execute commands like "come here" locally. Only local emergency stop phrases such as "stop", "freeze", "halt", "do not move", and "emergency stop" trigger immediate local stop for safety.

KimiClaw Cloud can read events through the helper script:

```bash
cd openclaw-skills/looi-robot-body
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs --new-events --allow-no-token
```

Local voice test:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000`.
4. Register runtime.
5. Start heartbeat.
6. Start KimiClaw Bridge.
7. Enable Simulator Mode.
8. Press `Start Listening`.
9. Say "hello".
10. Confirm transcript appears.
11. Confirm event is posted.
12. In another terminal, run:

```bash
cd ../openclaw-skills/looi-robot-body
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs --new-events --allow-no-token
```

13. Confirm a `user_speech` event appears.

Local stop test:
1. Start simulator or connect the robot.
2. Start listening.
3. Say "stop" or "freeze".
4. Confirm `CommandQueue` emergency stop triggers locally.
5. Confirm a `local_stop_phrase` event is posted.

Voice output test:
1. Press `Speak Test`.
2. Confirm the phone speaks.
3. Confirm the face mouth animates.
4. Send a KimiClaw `speak` action through the bridge.
5. Confirm `ToolExecutor` speaks through `VoiceOutput`.

KimiClaw event response test:
1. Browser posts a speech event.
2. KimiClaw helper waits for the event:

```bash
ROBOT_BRIDGE_PUBLIC_URL=http://localhost:3000 node scripts/send_robot_action.mjs \
  --wait-event \
  --event-types user_speech,user_text \
  --timeout-ms 30000 \
  --allow-no-token
```

3. Send a `speak` or movement action with `--wait`.
4. Confirm browser executes or rejects safely.
5. Mark the event handled.

Warnings:
- Browser speech recognition may require HTTPS or localhost.
- Browser support varies.
- Mobile Chrome requires microphone permission.
- Do not rely on speech recognition as the only emergency safety layer; keep the physical UI Emergency Stop available.
- Do not arm cloud motion unattended.

You can run voice/event smoke checks:

```bash
cd server-ui
npm run smoke:voice
npm run smoke:events
```

## Step 10: Camera And Visual Observation

The phone browser now acts as the robot's local eyes. Camera access stays in the browser: the server never opens the camera, never streams video, and never moves the robot from camera events.

Camera privacy:
- `Cloud Camera Allowed` is off by default.
- Manual browser camera buttons can open/capture locally because the user is directly controlling the UI.
- KimiClaw camera actions are rejected until `Cloud Camera Allowed` is enabled in the browser.
- `observe_scene` without a snapshot can return compact metadata, status, and local perception context.
- Snapshots are small thumbnails by default and are only returned when explicitly requested and allowed.

Available camera actions:
- `open_front_camera`
- `open_back_camera`
- `switch_camera`
- `close_camera`
- `capture_snapshot`
- `observe_scene` with optional `includeSnapshot`

Local camera test:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000` or an HTTPS URL.
4. Press `Start Front Camera`.
5. Grant camera permission.
6. Confirm preview works.
7. Press `Capture Snapshot`.
8. Confirm the thumbnail appears.
9. Confirm camera status and observation fields update.
10. If the browser supports `FaceDetector`, confirm `userVisible` and `faceCount` update.

KimiClaw camera action test:
1. Enable `Simulator Mode`.
2. Register runtime and start heartbeat.
3. Start `KimiClaw Bridge`.
4. Keep `Cloud Camera` blocked.
5. Inject `Observe Scene Action`.
6. Confirm it returns metadata but no snapshot.
7. Inject `Open Front Camera Action`.
8. Confirm it is rejected because `Cloud Camera` is disabled.
9. Enable `Cloud Camera`.
10. Inject `Open Front Camera Action` again.
11. Confirm the camera opens.
12. Inject `Capture Snapshot Action`.
13. Confirm a small snapshot result is returned.

Privacy warnings:
- Do not enable Cloud Camera unless supervised.
- Do not expose the bridge without `ROBOT_BRIDGE_TOKEN`.
- Do not request continuous image uploads.
- Do not request full-resolution images.
- Do not leave the camera running unnecessarily.
- KimiClaw should not pretend to see image details when only metadata is available.

You can run the camera smoke check:

```bash
cd server-ui
npm run smoke:camera
```

## Step 11: Body Calibration And Smooth Motion

The ESP32 now supports smooth motor ramping and runtime calibration. The browser can tune speed, ramp, trim, deadband, minimum PWM, and Life Engine motion intensity. These settings are stored locally in the browser and can be applied to either the real ESP32 or Simulator Mode.

What changed:
- Normal motion commands can include `ramp_ms` and `label`.
- ESP32 `config_update` tunes runtime motor limits without reflashing.
- ESP32 `config_get` returns the current runtime config.
- Telemetry includes current/target wheel speeds, ramp, motion label, and config.
- Life Engine body language uses local calibration settings for gentler, more characterful motion.
- Calibration test movement has its own browser `Calibration Test Armed` gate.
- Default `min_pwm` is `210` to overcome the current motor/driver startup deadzone.

Safety instructions:
1. Lift wheels before calibration.
2. Verify `Test Stop` first.
3. Use Simulator Mode before real motors.
4. Keep max speed low.
5. Do not arm Cloud Motion during calibration unless intentionally testing KimiClaw.
6. Do not leave the robot unattended.

Tuning guide:
- If the robot veers left when moving forward, reduce right trim or increase left trim carefully.
- If the robot veers right, reduce left trim or increase right trim carefully.
- If movement is jerky or too strong, increase `ramp_ms`, reduce `min_pwm`, or reduce speed.
- If the robot does not move at very low speeds, slightly increase `gentleSpeed` or `min_pwm`.
- If the browser was opened before this change, press `Reset Calibration`, then `Apply to Robot` so the new `min_pwm: 210` default is sent.
- If it feels too much like an RC car, reduce speed, increase ramp, and use shorter Life Engine movements.
- If the L298N gets hot, reduce speed and duty cycle; consider TB6612FNG or DRV8833 later.

Testing flow:
1. `cd server-ui`
2. `npm run dev`
3. Open the UI.
4. Enable `Simulator Mode`.
5. Open `Body Tuning / Calibration`.
6. Arm `Calibration Test`.
7. Test forward, backward, rotate, and wiggle.
8. Adjust values and save calibration.
9. Connect the real ESP32 with wheels lifted.
10. Apply calibration.
11. Test Stop.
12. Test tiny forward, backward, and rotate.
13. Put the robot on the floor only after Stop is verified.

You can run the calibration smoke check:

```bash
cd server-ui
npm run smoke:calibration
```

## Step 12: Personality, Memory, And Living Behavior

LOOI now has a local personality profile, learned phrase memory, server-side memory storage, and low-frequency life events. KimiClaw remains the conscious language/reasoning layer; the browser Life Engine uses personality only for local mood, attention, hesitation, and gentle body-language dynamics.

What changed:
- The browser has a `Personality / Memory` panel for identity, traits, behavior style, memory notes, learned phrases, and Life Events.
- Runtime heartbeat includes compact personality, life signals, stop-respect state, and learned phrase count.
- User text/speech events can include `inferredKnownIntent` from default mappings and learned phrases.
- Non-stop learned phrases are not executed locally; they are context for KimiClaw.
- Stop/freeze phrases still trigger immediate local stop and a stop-respect cooldown.
- Memory is stored under `server-ui/memory` as markdown/JSON and rejects obvious token/API key/password text.
- Life events can post context such as boredom, user returned, low energy, obstacle fear, or ignored too long into the Robot Event Inbox.

Memory and learned phrase commands:

```bash
cd openclaw-skills/looi-robot-body
node scripts/send_robot_action.mjs --memory
node scripts/send_robot_action.mjs --write-memory "The user prefers gentle movement." --memory-type long_term
node scripts/send_robot_action.mjs --learned-phrases
node scripts/send_robot_action.mjs --add-learned-phrase --phrase "give me room" --meaning "increase distance from user" --action retreat --args-json '{"style":"gentle","distance":"short"}' --confidence medium
```

Testing flow:
1. `cd server-ui`
2. `npm run dev`
3. Open the UI.
4. Register runtime and start heartbeat.
5. Enable Simulator Mode and start KimiClaw Bridge.
6. Open `Personality / Memory`.
7. Change curiosity/playfulness/gentleness and save personality.
8. Add memory: `The user prefers gentle movement.`
9. Add learned phrase: `give me room` -> `retreat`.
10. Type or say `give me room`.
11. Confirm the event payload includes inferred intent.
12. Send a retreat action with `--wait` and confirm movement still requires Cloud Motion armed.
13. Enable Life Events and simulate boredom/user return/low energy.
14. Confirm life events appear in the event inbox.

Safety:
- Personality never overrides safety.
- Memory should not store secrets.
- Proactive life events do not move the robot.
- KimiClaw should not spam movement or speech.
- Cloud Motion and Cloud Camera remain manually controlled.

You can run the personality smoke check:

```bash
cd server-ui
npm run smoke:personality
```

## Step 13: Production Kimi Agent

The production Kimi path runs on the laptop/server, not in the phone browser. The Kimi API key stays in `server-ui/.env`. Kimi reads robot events from the local bridge, decides safe high-level actions, and writes those actions back into the bridge. The phone browser still claims and executes actions through ToolExecutor, LifeEngine, SafetyGate, CommandQueue, and ESP32.

Flow:

```text
phone voice/text/camera/life event
→ server robot event inbox
→ laptop Kimi agent
→ Kimi API
→ safe high-level bridge actions
→ phone browser runtime
→ ESP32
```

Setup:

1. Edit `server-ui/.env`.
2. Set `KIMI_API_KEY` to your Moonshot/Kimi API key.
3. Keep `KIMI_BASE_URL=https://api.moonshot.ai/v1`.
4. Keep `KIMI_MODEL=kimi-k2.6` unless you intentionally change models.
5. For local private Wi-Fi testing only, `ROBOT_BRIDGE_ALLOW_UNAUTH_LAN=true` is convenient.
6. Do not expose the server publicly while LAN unauth is enabled.

If the bridge URL uses ngrok, KimiClaw or any helper calling the bridge must always send:

```http
ngrok-skip-browser-warning: true
```

The production `npm run kimi:agent` runner includes this header automatically.

Run:

```bash
cd server-ui
npm run dev
```

In the phone UI:

1. Connect ESP32.
2. Start Voice if you want speech events.
3. Start KimiClaw Bridge.
4. Register/start runtime heartbeat if runtime auth is enabled.
5. Keep Cloud Motion disarmed for the first test.
6. Keep Cloud Camera disallowed unless you intentionally test camera actions.

In a second terminal:

```bash
cd server-ui
npm run kimi:agent
```

One-shot test mode:

```bash
cd server-ui
npm run kimi:agent:once
```

Dry-run mode, no Kimi API call:

```bash
cd server-ui
node scripts/run-kimi-agent.mjs --dry-run --once
```

Testing flow:

1. Start server with `npm run dev`.
2. Open phone UI.
3. Connect ESP32.
4. Start KimiClaw Bridge.
5. Start the Kimi agent in a second terminal.
6. Say or type `hello looi`.
7. Kimi should usually enqueue a short `speak` or `express` action.
8. Say `come here` while Cloud Motion is OFF.
9. Movement should be rejected or avoided.
10. Arm Cloud Motion only when supervised.
11. Say `come here` again.
12. Movement should still be short, calibrated, and safety-gated.

Safety:

- Kimi never receives raw motor PWM access.
- Kimi never talks directly to ESP32.
- Server never moves the robot directly.
- Phone browser remains the runtime that executes actions safely.
- Cloud Motion and Cloud Camera remain manually controlled.
- Do not paste API keys into chat or memory.

You can run the Kimi agent smoke check without calling Kimi:

```bash
cd server-ui
npm run smoke:kimi
```

## Safety Rule

Never let Kimi directly control raw motor PWM.

All physical movement must go through the Life Engine safety gate and ESP32 safety firmware.

## ESP32 Server Gateway Mode

The browser no longer needs to open `ws://ESP32_IP:81` directly. The laptop server owns the ESP32 WebSocket connection, and the phone browser talks to the server through normal HTTP/HTTPS API calls.

This avoids browser mixed-content problems such as:

```text
HTTPS phone UI trying to open insecure ws://ESP32_IP:81
```

New path:

```text
Phone browser UI
→ /api/esp32 on laptop server
→ server WebSocket client
→ ESP32 ws://ESP32_IP:81
```

The safety path is still preserved:

```text
Kimi/Cloud action
→ phone runtime ToolExecutor
→ LifeEngine
→ SafetyGate
→ CommandQueue
→ server ESP32 gateway
→ ESP32
```

The server gateway forwards commands approved by the phone runtime; Kimi still must not talk directly to ESP32.

Configuration in `server-ui/.env`:

```env
ESP32_DEFAULT_WS_URL=ws://192.168.1.xx:81
ESP32_CONNECT_ON_START=true
ESP32_CONNECT_TIMEOUT_MS=8000
ROBOT_ESP32_GATEWAY_ALLOW_PUBLIC=false
```

When `ESP32_CONNECT_ON_START=true`, the server connects to ESP32 before it starts listening. If ESP32 is not reachable, the server exits instead of starting in a broken state.

Local/LAN phone access can use the gateway directly. If the phone UI is opened through a public ngrok URL, register the runtime first so the browser has a runtime token before connecting ESP32.

Startup:

```bash
cd server-ui
npm run dev
```

Expected success:

```text
[BOOT] Connecting to ESP32 before server start: ws://192.168.1.xx:81
[BOOT] ESP32 connected: ws://192.168.1.xx:81
LOOI Life Server listening on http://localhost:3000
```

Expected failure if ESP32 is offline or the IP is wrong:

```text
[BOOT] Server startup failed: Timed out connecting to ESP32 at ws://192.168.1.xx:81.
```

Testing:

```bash
cd server-ui
npm run smoke:esp32
```
