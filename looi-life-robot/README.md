# LOOI Life Robot

LOOI Life Robot is a local-first phone-bodied life robot. The phone/browser runtime is the face, ears, eyes, body runtime, safety layer, and fast local life loop, while the ESP32 is the body motor controller.

## Local-First Branch

This branch is designed around a local phone/browser runtime and an optional laptop local model server.

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

1. Connect the ESP32 gateway with the wheels lifted.
2. Start Local Brain.
3. Type `hello` and confirm a local expression/speech response.
4. Type `come here` and confirm movement is rejected while Local Motion is disarmed.
5. Arm Local Motion.
6. Type `come here` again and confirm ESP32 movement goes through ToolExecutor and LifeEngine.
7. Type or say `stop` and confirm immediate stop.

Run the smoke check:

```bash
cd server-ui
npm run smoke:local-first
```

## Gemini Live Speech-To-Speech

The main live voice path can use Gemini Live speech-to-speech. The server mints a short-lived Live token with `GEMINI_API_KEY`; the browser streams microphone PCM directly to Gemini, plays Gemini's returned audio, and handles Gemini tool calls locally.

Gemini never receives raw motor access. Its tools are limited to `perform`, `stop`, `take_picture`, and `set_expression`. Movement names still come from the local movement catalog, scenarios still come from the local scenario catalog, and execution still goes through `ToolExecutor -> EmbodiedActionRouter -> MotionMacroSequencer -> CommandQueue -> ESP32`.

`.env`:

```bash
GEMINI_LIVE_ENABLED=true
GEMINI_API_KEY=your_gemini_api_key
GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview
GEMINI_LIVE_VOICE=Kore
GEMINI_LIVE_THINKING_LEVEL=minimal
GEMINI_LIVE_ALLOW_PUBLIC_TOKEN=false
```

`/api/gemini-live/token` is local/LAN/runtime-auth protected by default. If you test through a public tunnel before runtime auth is configured, set `GEMINI_LIVE_ALLOW_PUBLIC_TOKEN=true` only for that temporary test session.

Run:

```bash
cd server-ui
npm run dev
```

Manual test:

1. Open the UI on laptop or phone.
2. Click `Start Local Brain`.
3. Say `move backward more`.
4. Confirm Gemini Live shows mic streaming and the last tool call is `perform`.
5. Say `take a picture of me`.
6. Confirm the `take_picture` scenario runs and a photo preview appears.
7. Say `stop` and confirm Gemini audio, macros, queue, and motors stop.

Smoke test:

```bash
cd server-ui
npm run smoke:gemini-live
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
- For safe development, keep wheels lifted and Local Motion disarmed until the stop path is verified.

Testing:

1. `cd server-ui`
2. `npm run dev`
3. Open the UI from the phone or laptop.
4. Connect the ESP32 gateway with wheels lifted.
5. Start Local Brain.
6. Confirm provider shows `mock`.
7. Type `come here`.
8. With Local Motion disarmed, movement should be rejected.
9. Arm Local Motion.
10. Type `come here` again.
11. ESP32 movement should route through ToolExecutor/LifeEngine.

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
  -> ESP32
```

Safety rules:
- Local Motion Armed is false by default.
- Allow Autonomous Movement is false by default.
- Speech recognition can restart automatically; non-empty speech is sent to the Local Brain, while autonomous/camera events do not call the LLM by default.
- Stop/freeze/don't move is handled immediately without waiting for the model.
- Physical motion still requires Local Motion Armed and goes through `ToolExecutor`.
- Autonomous physical movement also requires Allow Autonomous Movement.

Real ESP32 test:

1. `cd server-ui`
2. `npm run dev`
3. Open the UI and connect the ESP32 gateway with wheels lifted.
4. Start Local Brain.
5. Enable Always Listening or use typed input.
6. Type or say `LOOI` and confirm attention mode becomes attentive.
7. Type or say `come here`.
8. With Local Motion disarmed, confirm movement is rejected or replaced with a safe explanation.
9. Arm Local Motion.
10. Type or say `come here` again and confirm ESP32 approach behavior.
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
4. Only while supervised with wheels lifted, enable Allow Autonomous Movement and confirm occasional safe autonomous movement.

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
  -> ESP32
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
3. Connect the ESP32 gateway with wheels lifted.
4. Enable LOOI Mode.
5. Run the manual scenario controls.
6. Start Local Brain.
7. Type `LOOI` and confirm soft listen/thinking behavior.
8. Type `come here` with Local Motion disarmed and confirm no body movement or partial macro only.
9. Arm Local Motion only while supervised.
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
            │   └── brainPolicy.js
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

### 4. Test With Motors Physically Safe

In the UI:

1. Lift the wheels before any body test.
2. Connect the ESP32 gateway.
3. Keep `Local Motion` disarmed.
4. Start Local Brain or Gemini Live.
5. Trigger a face-only scenario or typed message.
6. Confirm movement requests reject safely until Local Motion is armed.

Only after stop is verified, arm movement briefly.

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
5. Keep camera usage supervised.

### 8. Safety Rules Every Time

- Wheels lifted for first real movement.
- Emergency Stop visible and tested.
- Local Motion off unless supervised.
- Camera on only when supervised.
- Never give any model raw PWM or direct ESP32 access.
- Browser executes movement locally through safety gates.

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

The Life Engine runs locally in the browser. It makes LOOI feel alive by handling mood, drives, attention, shallow reactions, the behavior tree, motion styles, and the browser-side safety gate.

It does not directly control motors or bypass memory/safety. When the ESP32 is connected, expressive motion goes through `SafetyGate` and `CommandQueue`. When the ESP32 is disconnected, the Life Engine still animates the face and keeps body-language requests non-physical.

Life Engine testing:
1. Start `server-ui` with `npm run dev`.
2. Open `http://localhost:3000`.
3. Confirm the face animates.
4. Watch mood and drive values update.
5. Trigger a scenario or type a short user message.
6. Press `Test Curious`.
7. Press `Test Happy` or `Test Wiggle`.
8. Connect the ESP32 with the wheels lifted.
9. Test Life Engine movement behaviors briefly.
10. Press `Emergency Stop` and verify the motors stop.

## Step 5: ESP32 Body Connection

The browser sends body commands only through the ESP32 gateway. Keep the wheels lifted while validating the command path, then test short movements under supervision.

ESP32 testing:
1. `cd server-ui`
2. `npm run dev`
3. Open `http://localhost:3000`.
4. Connect the ESP32 WebSocket URL printed in Serial Monitor, for example `ws://192.168.1.73:81`.
5. Confirm telemetry appears.
6. Press Forward, Backward, and Rotate.
7. Press `Scenario: Come Here`.
8. Press `Scenario: Give Me Space`.
9. Press `Scenario: Look Around`.
10. Press `Scenario: Obstacle`.
11. Confirm forward Life Engine movement is rejected while obstacle is true.
12. Press `Emergency Stop`.

You can also run the ESP32 gateway smoke check:

```bash
cd server-ui
npm run smoke:esp32
```

## Step 6: Camera And Visual Observation

The phone browser now acts as the robot's local eyes. Camera access stays in the browser: the server never opens the camera, never streams video, and never moves the robot from camera events.

Camera privacy:
- Manual browser camera buttons can open/capture locally because the user is directly controlling the UI.
- Gemini Live and local perception use compact camera context; do not leave the camera running unnecessarily.
- Snapshots are small thumbnails by default and are only created from explicit local UI/scenario actions.

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

Privacy warnings:
- Do not request continuous image uploads.
- Do not request full-resolution images.
- Do not leave the camera running unnecessarily.
- Do not let any model claim image details that are not supported by the live camera/context.

You can run the camera smoke check:

```bash
cd server-ui
npm run smoke:camera
```

## Step 7: Body Calibration And Smooth Motion

The ESP32 now supports smooth motor ramping and runtime calibration. The browser can tune speed, ramp, trim, deadband, minimum PWM, and Life Engine motion intensity. These settings are stored locally in the browser and can be applied to the real ESP32.

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
3. Keep wheels lifted before real floor movement.
4. Keep max speed low.
5. Do not arm Local Motion unless intentionally testing movement.
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
4. Connect the ESP32 gateway with wheels lifted.
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

## Step 8: Personality, Memory, And Living Behavior

LOOI has a local personality profile, learned phrase memory, server-side memory storage, and low-frequency life events. Gemini Live and the local brain use this context, while the browser Life Engine uses personality for local mood, attention, hesitation, and gentle body-language dynamics.

What changed:
- The browser has a `Personality / Memory` panel for identity, traits, behavior style, memory notes, learned phrases, and Life Events.
- Runtime context includes compact personality, life signals, stop-respect state, and learned phrase count.
- User text can include inferred known intent from default mappings and learned phrases.
- Non-stop learned phrases are context for the local brain and Gemini Live; physical execution still goes through the local safety path.
- Stop/freeze phrases still trigger immediate local stop and a stop-respect cooldown.
- Memory is stored under `server-ui/memory` as markdown/JSON and rejects obvious token/API key/password text.
- Life events can post context such as boredom, user returned, low energy, obstacle fear, or ignored too long into the local event stream.

Memory and learned phrase commands:

Use the `Personality / Memory` panel in the browser UI to add memory notes and learned phrases.

Testing flow:
1. `cd server-ui`
2. `npm run dev`
3. Open the UI.
4. Open `Personality / Memory`.
5. Change curiosity/playfulness/gentleness and save personality.
6. Add memory: `The user prefers gentle movement.`
7. Add learned phrase: `give me room` -> `retreat`.
8. Type or say `give me room`.
9. Confirm the runtime context includes inferred intent.
10. Enable Life Events and trigger boredom/user return/low energy.
11. Confirm life events appear in the local event list.

Safety:
- Personality never overrides safety.
- Memory should not store secrets.
- Proactive life events do not move the robot.
- Local Motion and camera remain manually controlled.

You can run the personality smoke check:

```bash
cd server-ui
npm run smoke:personality
```

## Safety Rule

Never let any model directly control raw motor PWM.

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
Local brain or Gemini action
→ phone runtime ToolExecutor
→ LifeEngine
→ SafetyGate
→ CommandQueue
→ server ESP32 gateway
→ ESP32
```

The server gateway forwards commands approved by the phone runtime; models must not talk directly to ESP32.

Configuration in `server-ui/.env`:

```env
ESP32_DEFAULT_WS_URL=ws://192.168.1.xx:81
ESP32_CONNECT_ON_START=true
ESP32_CONNECT_TIMEOUT_MS=8000
ROBOT_ESP32_GATEWAY_ALLOW_PUBLIC=false
```

When `ESP32_CONNECT_ON_START=true`, the server connects to ESP32 before it starts listening. If ESP32 is not reachable, the server exits instead of starting in a broken state.

Local/LAN phone access can use the gateway directly. Avoid public tunnels for ESP32 control unless you explicitly enable and secure the gateway.

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
