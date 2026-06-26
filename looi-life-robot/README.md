# LOOI Life Robot

LOOI is a browser-first robot runtime. The website runs the face, camera,
conversation, memory, and behavior logic. The ESP32 body is optional and is
controlled directly from the user's browser over Web Bluetooth.

See `docs/open-source-looi-context.md` for the Gemini Live research notes and
the open-source LOOI architecture direction.

## Current Body Model

- No accounts.
- No robot tokens.
- No ESP32 IP address.
- No ESP32 Wi-Fi setup.
- No server-side ESP32 gateway.
- A user without hardware can choose **Skip and start without body**.
- A user with hardware flashes firmware, connects **LOOI Body** by Bluetooth,
  runs body tests, then starts LOOI.

This means a remote user cannot take over another user's body through the public
server. The browser must be physically near the ESP32 and paired through the
Bluetooth picker.

## Run The Web App

```sh
cd server-ui
npm install
npm run dev
```

Open the printed local URL. Public deployments must use HTTPS for Web Bluetooth.

## Firmware

Firmware source is in `src/main.cpp`. It exposes one BLE service:

- Service: `7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0001`
- Command characteristic: `7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0002`
- Events characteristic: `7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0003`

The browser sends newline-delimited JSON commands in small BLE chunks. Firmware
responds with newline-delimited JSON notifications.

Do not run PlatformIO until it is installed. After building firmware, sync the
browser-upload files with:

```sh
cd server-ui
npm run firmware:sync
```

## Checks

```sh
cd server-ui
npm run check
npm run smoke:body
```

`npm run smoke:all` runs the broader non-PlatformIO smoke suite.

## Safety

Firmware clamps speed, command duration, ramp, PWM, and head-pitch limits. It
auto-stops when motion expires, when invalid JSON arrives, and when Bluetooth
disconnects. Lift the wheels for first tests.
