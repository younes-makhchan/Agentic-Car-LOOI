#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include <math.h>

// This firmware intentionally contains no AI, personality, Kimi logic, or Life
// Engine logic. The phone/server side will decide high-level intent later.
// The ESP32 is only the final motor safety layer that executes short, clamped
// motion commands and automatically stops.

// Placeholder motor pins for the current L298N test setup.
// Update these if your wiring changes.
constexpr uint8_t LEFT_IN1 = 22;
constexpr uint8_t LEFT_IN2 = 21;
constexpr uint8_t LEFT_EN = 5;

constexpr uint8_t RIGHT_IN1 = 19;
constexpr uint8_t RIGHT_IN2 = 18;
constexpr uint8_t RIGHT_EN = 23;

// Flip one of these if a motor side spins the wrong way.
constexpr bool LEFT_INVERT = false;
constexpr bool RIGHT_INVERT = true;

// L298N notes:
// - Remove the ENA/ENB jumpers if you want ESP32 PWM speed control.
// - Connect the L298N enable pins to the ESP32 PWM pins below.
// - ESP32 GND and L298N GND must be tied together.
// - Do not power the motor driver or motors from the ESP32 5V pin.

constexpr uint32_t PWM_FREQUENCY_HZ = 1000;
constexpr uint8_t PWM_RESOLUTION_BITS = 8;
constexpr uint16_t PWM_MAX_DUTY = (1u << PWM_RESOLUTION_BITS) - 1u;

constexpr uint32_t SERIAL_BAUD = 115200;

// Step 12 setup: station mode puts the phone, laptop server, and ESP32 on the
// same Wi-Fi network. Edit these two values before uploading.
constexpr char WIFI_SSID[] = "YOUR_HOME_WIFI_NAME";
constexpr char WIFI_PASSWORD[] = "YOUR_HOME_WIFI_PASSWORD";

// Fallback AP starts only if the ESP32 cannot join your home Wi-Fi.
constexpr char FALLBACK_AP_SSID[] = "LOOI_BODY";
constexpr char FALLBACK_AP_PASSWORD[] = "looi123456";
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

constexpr uint16_t WS_PORT = 81;

constexpr float FIRMWARE_HARD_MAX_SPEED = 0.50f;
constexpr float DEFAULT_RUNTIME_MAX_SPEED = 0.40f;
constexpr uint32_t MAX_DURATION_MS = 1000;
constexpr uint32_t MIN_DURATION_MS = 50;
constexpr uint32_t DEFAULT_DURATION_MS = 300;
constexpr float DEFAULT_DEADBAND = 0.03f;
constexpr uint32_t DEFAULT_RAMP_MS = 120;
constexpr uint8_t DEFAULT_MIN_PWM = 210;
constexpr uint32_t MAX_RAMP_MS = 500;
constexpr uint32_t MOTOR_UPDATE_INTERVAL_MS = 20;

constexpr uint32_t TELEMETRY_INTERVAL_MS = 1000;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
constexpr uint8_t MAX_TRACKED_CLIENTS = 10;
constexpr size_t JSON_DOC_SIZE = 1024;

WebSocketsServer webSocket(WS_PORT);

bool clientConnected[MAX_TRACKED_CLIENTS] = {false};
uint8_t connectedClientCount = 0;

bool motionActive = false;
bool rampingDown = false;
float currentLinear = 0.0f;
float currentAngular = 0.0f;
float currentLeftSpeed = 0.0f;
float currentRightSpeed = 0.0f;
float startLeftSpeed = 0.0f;
float startRightSpeed = 0.0f;
float targetLeftSpeed = 0.0f;
float targetRightSpeed = 0.0f;

uint32_t motionStartAt = 0;
uint32_t motionEndAt = 0;
uint32_t rampDownStartAt = 0;
uint32_t motionRampMs = DEFAULT_RAMP_MS;
uint32_t lastCommandAt = 0;
uint32_t lastTelemetryAt = 0;
uint32_t lastMotorUpdateAt = 0;

float runtimeMaxSpeed = DEFAULT_RUNTIME_MAX_SPEED;
float leftTrim = 1.0f;
float rightTrim = 1.0f;
float runtimeDeadband = DEFAULT_DEADBAND;
uint32_t defaultRampMs = DEFAULT_RAMP_MS;
uint8_t minPwm = DEFAULT_MIN_PWM;
char motionLabel[48] = "";

void setupPins();
void setupWifi();
void setupWebSocket();
void handleWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t *payload,
                          size_t length);
void handleJsonMessage(uint8_t clientNum, uint8_t *payload, size_t length);
void handleMotionCommand(uint8_t clientNum, JsonObjectConst root);
void handleStopCommand(uint8_t clientNum, JsonObjectConst root);
void handleConfigUpdateCommand(uint8_t clientNum, JsonObjectConst root);
void handleConfigGetCommand(uint8_t clientNum, JsonObjectConst root);
void sendTelemetry();
void sendConfig(uint8_t clientNum, JsonVariantConst requestId);
void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId);
void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId,
             const char *reason);
void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId,
             float linear, float angular, uint32_t durationMs, float leftSpeed,
             float rightSpeed, uint32_t rampMs, const char *label);
void sendError(uint8_t clientNum, const char *cmd, const char *message,
               JsonVariantConst requestId);
void setDrive(float linear, float angular, uint32_t durationMs, uint32_t rampMs,
              const char *label);
void updateRampedMotion(bool force = false);
void applyMotorSpeeds(float leftSpeed, float rightSpeed);
void setMotorSide(uint8_t in1Pin, uint8_t in2Pin, uint8_t enablePin, float speed,
                  bool invert);
void stopMotors(const char *reason);
void addConfig(JsonObject target);
void addConfigWarnings(JsonArray warnings, const char *field, double requested,
                       double accepted);
void sanitizeLabel(const char *input, char *output, size_t outputSize);

bool isStrictNumber(JsonVariantConst value);
bool isFiniteNumber(double value);
float clampSpeed(float value);
float applyDeadband(float value);
float applyTrimAndClamp(float value, float trim);
uint32_t clampDuration(double durationMs);
uint32_t clampRamp(double rampMs, uint32_t durationMs);
uint8_t clampMinPwm(double value);
bool isStopped();
bool deadlineReached(uint32_t now, uint32_t deadline);
uint32_t motionRemainingMs(uint32_t now);
const char *motorState();
void trackClient(uint8_t clientNum, bool isConnected);
void addRequestId(JsonDocument &doc, JsonVariantConst requestId);

template <typename TDoc>
void sendJsonToClient(uint8_t clientNum, const TDoc &doc) {
  String message;
  serializeJson(doc, message);
  webSocket.sendTXT(clientNum, message);
}

template <typename TDoc>
void broadcastJson(const TDoc &doc) {
  if (connectedClientCount == 0) {
    return;
  }

  String message;
  serializeJson(doc, message);
  webSocket.broadcastTXT(message);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(250);

  Serial.println();
  Serial.println("[BOOT] LOOI body firmware starting");
  Serial.println("[BOOT] ESP32 will only execute short, safe motor commands");

  setupPins();
  setupWifi();
  setupWebSocket();
  stopMotors("boot");
}

void loop() {
  const uint32_t now = millis();

  webSocket.loop();

  updateRampedMotion();

  if (!motionActive && !isStopped()) {
    Serial.println("[SAFE] No active motion scheduled, forcing stop");
    stopMotors("idle_safety");
  }

  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    sendTelemetry();
  }
}

void setupPins() {
  pinMode(LEFT_IN1, OUTPUT);
  pinMode(LEFT_IN2, OUTPUT);
  pinMode(RIGHT_IN1, OUTPUT);
  pinMode(RIGHT_IN2, OUTPUT);

  if (!ledcAttach(LEFT_EN, PWM_FREQUENCY_HZ, PWM_RESOLUTION_BITS)) {
    Serial.println("[BOOT] Failed to attach left PWM pin");
  }

  if (!ledcAttach(RIGHT_EN, PWM_FREQUENCY_HZ, PWM_RESOLUTION_BITS)) {
    Serial.println("[BOOT] Failed to attach right PWM pin");
  }

  digitalWrite(LEFT_IN1, LOW);
  digitalWrite(LEFT_IN2, LOW);
  digitalWrite(RIGHT_IN1, LOW);
  digitalWrite(RIGHT_IN2, LOW);
  ledcWrite(LEFT_EN, 0);
  ledcWrite(RIGHT_EN, 0);

  Serial.println("[BOOT] Motor pins configured");
}

void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  Serial.printf("[WIFI] Connecting to %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    const String localIp = WiFi.localIP().toString();
    Serial.println("[WIFI] Connected to home Wi-Fi");
    Serial.printf("[WIFI] SSID: %s\n", WIFI_SSID);
    Serial.printf("[WIFI] IP: %s\n", localIp.c_str());
    Serial.printf("[WIFI] WebSocket URL: ws://%s:%u\n", localIp.c_str(),
                  WS_PORT);
    return;
  }

  Serial.println("[WIFI] Home Wi-Fi failed, starting fallback access point");
  WiFi.disconnect(true);
  delay(250);
  WiFi.mode(WIFI_AP);

  if (!WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET)) {
    Serial.println("[WIFI] Failed to apply AP IP config, continuing");
  }

  if (!WiFi.softAP(FALLBACK_AP_SSID, FALLBACK_AP_PASSWORD)) {
    Serial.println("[WIFI] Failed to start fallback Wi-Fi access point");
    return;
  }

  const String apIp = WiFi.softAPIP().toString();
  Serial.println("[WIFI] Fallback AP started");
  Serial.printf("[WIFI] SSID: %s\n", FALLBACK_AP_SSID);
  Serial.printf("[WIFI] Password: %s\n", FALLBACK_AP_PASSWORD);
  Serial.printf("[WIFI] AP IP: %s\n", apIp.c_str());
  Serial.printf("[WIFI] WebSocket URL: ws://%s:%u\n", apIp.c_str(), WS_PORT);
}

void setupWebSocket() {
  webSocket.begin();
  webSocket.onEvent(handleWebSocketEvent);
  Serial.printf("[WS] WebSocket server started on port %u\n", WS_PORT);
}

void handleWebSocketEvent(uint8_t clientNum, WStype_t type, uint8_t *payload,
                          size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      trackClient(clientNum, true);
      const String remoteIp = webSocket.remoteIP(clientNum).toString();
      Serial.printf("[WS] Client %u connected from %s\n", clientNum,
                    remoteIp.c_str());
      sendTelemetry();
      break;
    }

    case WStype_DISCONNECTED:
      Serial.printf("[WS] Client %u disconnected\n", clientNum);
      trackClient(clientNum, false);
      stopMotors("websocket_disconnect");
      break;

    case WStype_TEXT:
      handleJsonMessage(clientNum, payload, length);
      break;

    default:
      break;
  }
}

void handleJsonMessage(uint8_t clientNum, uint8_t *payload, size_t length) {
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  const DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.printf("[SAFE] Invalid JSON received: %s\n", error.c_str());
    stopMotors("invalid_json");
    sendError(clientNum, "unknown", "Invalid JSON", JsonVariantConst());
    return;
  }

  if (!doc.is<JsonObjectConst>()) {
    Serial.println("[SAFE] Invalid JSON root, expected object");
    stopMotors("invalid_json_root");
    sendError(clientNum, "unknown", "JSON root must be an object",
              JsonVariantConst());
    return;
  }

  const JsonObjectConst root = doc.as<JsonObjectConst>();
  const JsonVariantConst requestId = root["id"];
  const JsonVariantConst typeValue = root["type"];

  if (!typeValue.is<const char *>()) {
    Serial.println("[SAFE] Unknown command: missing or invalid type");
    stopMotors("unknown_command");
    sendError(clientNum, "unknown", "Missing or invalid command type",
              requestId);
    return;
  }

  const char *type = typeValue.as<const char *>();

  if (strcmp(type, "motion") == 0) {
    handleMotionCommand(clientNum, root);
    return;
  }

  if (strcmp(type, "stop") == 0) {
    handleStopCommand(clientNum, root);
    return;
  }

  if (strcmp(type, "config_update") == 0) {
    handleConfigUpdateCommand(clientNum, root);
    return;
  }

  if (strcmp(type, "config_get") == 0) {
    handleConfigGetCommand(clientNum, root);
    return;
  }

  if (strcmp(type, "ping") == 0) {
    lastCommandAt = millis();

    StaticJsonDocument<128> response;
    addRequestId(response, requestId);
    response["type"] = "pong";
    response["uptime_ms"] = millis();

    sendJsonToClient(clientNum, response);
    return;
  }

  Serial.printf("[SAFE] Unknown command received: %s\n", type);
  stopMotors("unknown_command");
  sendError(clientNum, type, "Unknown command", requestId);
}

void handleMotionCommand(uint8_t clientNum, JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  const JsonVariantConst linearValue = root["linear"];
  const JsonVariantConst angularValue = root["angular"];
  const JsonVariantConst durationValue = root["duration_ms"];
  const JsonVariantConst rampValue = root["ramp_ms"];

  if (!isStrictNumber(linearValue) || !isStrictNumber(angularValue)) {
    Serial.println("[SAFE] Motion rejected: linear/angular missing or invalid");
    stopMotors("invalid_motion");
    sendError(clientNum, "motion", "linear and angular must be numeric",
              requestId);
    return;
  }

  const double rawLinear = linearValue.as<double>();
  const double rawAngular = angularValue.as<double>();

  if (!isFiniteNumber(rawLinear) || !isFiniteNumber(rawAngular)) {
    Serial.println("[SAFE] Motion rejected: linear/angular not finite");
    stopMotors("invalid_motion");
    sendError(clientNum, "motion", "Motion values must be finite", requestId);
    return;
  }

  double rawDuration = DEFAULT_DURATION_MS;
  bool durationDefaulted = false;

  if (durationValue.isNull()) {
    durationDefaulted = true;
  } else if (!isStrictNumber(durationValue)) {
    durationDefaulted = true;
  } else {
    rawDuration = durationValue.as<double>();

    if (!isFiniteNumber(rawDuration)) {
      durationDefaulted = true;
    }
  }

  if (durationDefaulted) {
    rawDuration = DEFAULT_DURATION_MS;
    Serial.printf("[SAFE] Motion duration missing/invalid, using default %lu ms\n",
                  static_cast<unsigned long>(DEFAULT_DURATION_MS));
  }

  const float acceptedLinear =
      applyDeadband(clampSpeed(static_cast<float>(rawLinear)));
  const float acceptedAngular =
      applyDeadband(clampSpeed(static_cast<float>(rawAngular)));
  const uint32_t acceptedDuration = clampDuration(rawDuration);
  double rawRamp = defaultRampMs;

  if (!rampValue.isNull() && isStrictNumber(rampValue) &&
      isFiniteNumber(rampValue.as<double>())) {
    rawRamp = rampValue.as<double>();
  }

  const uint32_t acceptedRamp = clampRamp(rawRamp, acceptedDuration);
  char acceptedLabel[48] = "";
  sanitizeLabel(root["label"].is<const char *>() ? root["label"].as<const char *>()
                                                 : "motion",
                acceptedLabel, sizeof(acceptedLabel));

  Serial.printf(
      "[CMD] Motion received linear=%.3f angular=%.3f duration=%lu ramp=%lu "
      "label=%s\n",
                static_cast<float>(rawLinear), static_cast<float>(rawAngular),
      static_cast<unsigned long>(acceptedDuration),
      static_cast<unsigned long>(acceptedRamp), acceptedLabel);

  setDrive(acceptedLinear, acceptedAngular, acceptedDuration, acceptedRamp,
           acceptedLabel);

  const float mixedLeftBeforeClamp = acceptedLinear - acceptedAngular;
  const float mixedRightBeforeClamp = acceptedLinear + acceptedAngular;

  const bool commandAdjusted =
      fabsf(static_cast<float>(rawLinear) - acceptedLinear) > 0.0001f ||
      fabsf(static_cast<float>(rawAngular) - acceptedAngular) > 0.0001f ||
      fabsf(static_cast<float>(rawDuration) - acceptedDuration) > 0.5f ||
      fabsf(static_cast<float>(rawRamp) - acceptedRamp) > 0.5f ||
      fabsf(mixedLeftBeforeClamp - targetLeftSpeed) > 0.0001f ||
      fabsf(mixedRightBeforeClamp - targetRightSpeed) > 0.0001f;

  if (commandAdjusted) {
    Serial.printf(
        "[SAFE] Motion command clamped -> linear=%.3f angular=%.3f duration=%lu "
        "ramp=%lu left=%.3f right=%.3f\n",
        currentLinear, currentAngular,
        static_cast<unsigned long>(acceptedDuration),
        static_cast<unsigned long>(acceptedRamp), targetLeftSpeed,
        targetRightSpeed);
  }

  sendAck(clientNum, "motion", requestId, currentLinear, currentAngular,
          acceptedDuration, targetLeftSpeed, targetRightSpeed, acceptedRamp,
          motionLabel);
}

void handleStopCommand(uint8_t clientNum, JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  const char *reason = "stop_command";

  if (root["reason"].is<const char *>()) {
    reason = root["reason"].as<const char *>();
  }

  lastCommandAt = millis();
  Serial.printf("[CMD] Stop command received reason=%s\n", reason);
  stopMotors(reason);
  sendAck(clientNum, "stop", requestId, reason);
}

void handleConfigUpdateCommand(uint8_t clientNum, JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = "config_update";
  doc["accepted"] = true;
  JsonArray warnings = doc.createNestedArray("warnings");

  if (root.containsKey("max_speed")) {
    const JsonVariantConst value = root["max_speed"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      runtimeMaxSpeed = constrain(static_cast<float>(requested), 0.05f,
                                  FIRMWARE_HARD_MAX_SPEED);
      addConfigWarnings(warnings, "max_speed", requested, runtimeMaxSpeed);
    } else {
      warnings.add("max_speed_invalid");
    }
  }

  if (root.containsKey("left_trim")) {
    const JsonVariantConst value = root["left_trim"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      leftTrim = constrain(static_cast<float>(requested), 0.5f, 1.3f);
      addConfigWarnings(warnings, "left_trim", requested, leftTrim);
    } else {
      warnings.add("left_trim_invalid");
    }
  }

  if (root.containsKey("right_trim")) {
    const JsonVariantConst value = root["right_trim"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      rightTrim = constrain(static_cast<float>(requested), 0.5f, 1.3f);
      addConfigWarnings(warnings, "right_trim", requested, rightTrim);
    } else {
      warnings.add("right_trim_invalid");
    }
  }

  if (root.containsKey("deadband")) {
    const JsonVariantConst value = root["deadband"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      runtimeDeadband = constrain(static_cast<float>(requested), 0.0f, 0.12f);
      addConfigWarnings(warnings, "deadband", requested, runtimeDeadband);
    } else {
      warnings.add("deadband_invalid");
    }
  }

  if (root.containsKey("default_ramp_ms")) {
    const JsonVariantConst value = root["default_ramp_ms"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      defaultRampMs = clampRamp(requested, MAX_DURATION_MS * 2);
      addConfigWarnings(warnings, "default_ramp_ms", requested, defaultRampMs);
    } else {
      warnings.add("default_ramp_ms_invalid");
    }
  }

  if (root.containsKey("min_pwm")) {
    const JsonVariantConst value = root["min_pwm"];
    if (isStrictNumber(value) && isFiniteNumber(value.as<double>())) {
      const double requested = value.as<double>();
      minPwm = clampMinPwm(requested);
      addConfigWarnings(warnings, "min_pwm", requested, minPwm);
    } else {
      warnings.add("min_pwm_invalid");
    }
  }

  targetLeftSpeed = clampSpeed(targetLeftSpeed);
  targetRightSpeed = clampSpeed(targetRightSpeed);
  currentLeftSpeed = clampSpeed(currentLeftSpeed);
  currentRightSpeed = clampSpeed(currentRightSpeed);
  applyMotorSpeeds(currentLeftSpeed, currentRightSpeed);

  JsonObject config = doc.createNestedObject("config");
  addConfig(config);

  Serial.printf(
      "[CFG] max=%.3f left_trim=%.3f right_trim=%.3f deadband=%.3f ramp=%lu "
      "min_pwm=%u warnings=%u\n",
      runtimeMaxSpeed, leftTrim, rightTrim, runtimeDeadband,
      static_cast<unsigned long>(defaultRampMs), minPwm, warnings.size());

  lastCommandAt = millis();
  sendJsonToClient(clientNum, doc);
}

void handleConfigGetCommand(uint8_t clientNum, JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  lastCommandAt = millis();
  sendConfig(clientNum, requestId);
}

void sendTelemetry() {
  if (connectedClientCount == 0) {
    return;
  }

  const uint32_t now = millis();
  StaticJsonDocument<JSON_DOC_SIZE> doc;

  doc["type"] = "telemetry";
  doc["uptime_ms"] = now;
  doc["wifi_mode"] = WiFi.getMode() == WIFI_AP ? "fallback_ap" : "station";
  doc["ip"] =
      WiFi.getMode() == WIFI_AP ? WiFi.softAPIP().toString()
                                : WiFi.localIP().toString();
  doc["ap_ip"] = WiFi.softAPIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["clients"] = connectedClientCount;
  doc["battery"] = nullptr;
  doc["motor_state"] = motorState();
  doc["left_speed"] = currentLeftSpeed;
  doc["right_speed"] = currentRightSpeed;
  doc["current_left_speed"] = currentLeftSpeed;
  doc["current_right_speed"] = currentRightSpeed;
  doc["target_left_speed"] = targetLeftSpeed;
  doc["target_right_speed"] = targetRightSpeed;
  doc["ramp_ms"] = motionRampMs;
  doc["motion_label"] = motionLabel;
  doc["motion_remaining_ms"] = motionRemainingMs(now);
  doc["last_command_age_ms"] =
      lastCommandAt == 0 ? 0 : static_cast<uint32_t>(now - lastCommandAt);

  JsonObject limits = doc.createNestedObject("limits");
  limits["max_speed"] = runtimeMaxSpeed;
  limits["hard_max_speed"] = FIRMWARE_HARD_MAX_SPEED;
  limits["max_duration_ms"] = MAX_DURATION_MS;

  JsonObject config = doc.createNestedObject("config");
  addConfig(config);

  broadcastJson(doc);
}

void sendConfig(uint8_t clientNum, JsonVariantConst requestId) {
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  addRequestId(doc, requestId);
  doc["type"] = "config";
  JsonObject config = doc.createNestedObject("config");
  addConfig(config);
  sendJsonToClient(clientNum, doc);
}

void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId) {
  StaticJsonDocument<128> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = cmd;
  doc["accepted"] = true;
  sendJsonToClient(clientNum, doc);
}

void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId,
             const char *reason) {
  StaticJsonDocument<160> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = cmd;
  doc["accepted"] = true;
  doc["reason"] = reason;
  sendJsonToClient(clientNum, doc);
}

void sendAck(uint8_t clientNum, const char *cmd, JsonVariantConst requestId,
             float linear, float angular, uint32_t durationMs, float leftSpeed,
             float rightSpeed, uint32_t rampMs, const char *label) {
  StaticJsonDocument<384> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = cmd;
  doc["accepted"] = true;
  doc["linear"] = linear;
  doc["angular"] = angular;
  doc["duration_ms"] = durationMs;
  doc["ramp_ms"] = rampMs;
  doc["label"] = label;
  doc["left_speed"] = leftSpeed;
  doc["right_speed"] = rightSpeed;
  sendJsonToClient(clientNum, doc);
}

void sendError(uint8_t clientNum, const char *cmd, const char *message,
               JsonVariantConst requestId) {
  StaticJsonDocument<192> doc;
  addRequestId(doc, requestId);
  doc["type"] = "error";
  doc["cmd"] = cmd;
  doc["message"] = message;
  sendJsonToClient(clientNum, doc);
}

void setDrive(float linear, float angular, uint32_t durationMs, uint32_t rampMs,
              const char *label) {
  const uint32_t now = millis();

  currentLinear = applyDeadband(clampSpeed(linear));
  currentAngular = applyDeadband(clampSpeed(angular));

  const float leftSpeed =
      applyTrimAndClamp(applyDeadband(clampSpeed(currentLinear - currentAngular)),
                        leftTrim);
  const float rightSpeed =
      applyTrimAndClamp(applyDeadband(clampSpeed(currentLinear + currentAngular)),
                        rightTrim);

  lastCommandAt = now;

  if (fabsf(leftSpeed) < 0.0001f && fabsf(rightSpeed) < 0.0001f) {
    motionActive = false;
    motionEndAt = 0;
    targetLeftSpeed = 0.0f;
    targetRightSpeed = 0.0f;
    motionLabel[0] = '\0';
    applyMotorSpeeds(0.0f, 0.0f);
    return;
  }

  motionActive = true;
  rampingDown = false;
  motionStartAt = now;
  motionEndAt = now + durationMs;
  rampDownStartAt = 0;
  motionRampMs = clampRamp(rampMs, durationMs);
  startLeftSpeed = currentLeftSpeed;
  startRightSpeed = currentRightSpeed;
  targetLeftSpeed = leftSpeed;
  targetRightSpeed = rightSpeed;
  sanitizeLabel(label, motionLabel, sizeof(motionLabel));

  Serial.printf("[MOTION] label=%s target_left=%.3f target_right=%.3f ramp=%lu\n",
                motionLabel, targetLeftSpeed, targetRightSpeed,
                static_cast<unsigned long>(motionRampMs));

  updateRampedMotion(true);
}

void updateRampedMotion(bool force) {
  if (!motionActive) {
    return;
  }

  const uint32_t now = millis();

  if (!force && now - lastMotorUpdateAt < MOTOR_UPDATE_INTERVAL_MS) {
    return;
  }

  lastMotorUpdateAt = now;

  if (!rampingDown && deadlineReached(now, motionEndAt)) {
    if (motionRampMs == 0) {
      Serial.println("[SAFE] Auto stop by duration");
      stopMotors("duration_timeout");
      return;
    }

    rampingDown = true;
    rampDownStartAt = now;
    startLeftSpeed = currentLeftSpeed;
    startRightSpeed = currentRightSpeed;
    targetLeftSpeed = 0.0f;
    targetRightSpeed = 0.0f;
    Serial.printf("[MOTION] Ramp down label=%s ramp=%lu\n", motionLabel,
                  static_cast<unsigned long>(motionRampMs));
  }

  const uint32_t rampStart = rampingDown ? rampDownStartAt : motionStartAt;
  const uint32_t elapsed = now - rampStart;
  const float progress = motionRampMs == 0
                             ? 1.0f
                             : constrain(static_cast<float>(elapsed) /
                                             static_cast<float>(motionRampMs),
                                         0.0f, 1.0f);
  const float nextLeft =
      startLeftSpeed + (targetLeftSpeed - startLeftSpeed) * progress;
  const float nextRight =
      startRightSpeed + (targetRightSpeed - startRightSpeed) * progress;

  applyMotorSpeeds(nextLeft, nextRight);

  if (rampingDown && progress >= 1.0f) {
    Serial.println("[SAFE] Auto stop after ramp down");
    stopMotors("duration_timeout");
  }
}

void applyMotorSpeeds(float leftSpeed, float rightSpeed) {
  currentLeftSpeed = applyDeadband(clampSpeed(leftSpeed));
  currentRightSpeed = applyDeadband(clampSpeed(rightSpeed));

  setMotorSide(LEFT_IN1, LEFT_IN2, LEFT_EN, currentLeftSpeed, LEFT_INVERT);
  setMotorSide(RIGHT_IN1, RIGHT_IN2, RIGHT_EN, currentRightSpeed, RIGHT_INVERT);
}

void setMotorSide(uint8_t in1Pin, uint8_t in2Pin, uint8_t enablePin, float speed,
                  bool invert) {
  const float effectiveSpeed = invert ? -speed : speed;
  uint32_t duty = static_cast<uint32_t>(
      roundf(fabsf(effectiveSpeed) * static_cast<float>(PWM_MAX_DUTY)));

  if (fabsf(effectiveSpeed) < 0.0001f) {
    digitalWrite(in1Pin, LOW);
    digitalWrite(in2Pin, LOW);
    ledcWrite(enablePin, 0);
    return;
  }

  if (minPwm > 0 && duty > 0) {
    duty = max(static_cast<uint32_t>(minPwm), duty);
  }

  if (effectiveSpeed > 0.0f) {
    digitalWrite(in1Pin, HIGH);
    digitalWrite(in2Pin, LOW);
  } else {
    digitalWrite(in1Pin, LOW);
    digitalWrite(in2Pin, HIGH);
  }

  ledcWrite(enablePin, duty);
}

void stopMotors(const char *reason) {
  const bool wasMoving = motionActive || !isStopped();

  motionActive = false;
  rampingDown = false;
  motionEndAt = 0;
  rampDownStartAt = 0;
  currentLinear = 0.0f;
  currentAngular = 0.0f;
  startLeftSpeed = 0.0f;
  startRightSpeed = 0.0f;
  targetLeftSpeed = 0.0f;
  targetRightSpeed = 0.0f;
  motionLabel[0] = '\0';
  applyMotorSpeeds(0.0f, 0.0f);

  if (wasMoving) {
    Serial.printf("[SAFE] Motor stop: %s\n", reason);
  }
}

void addConfig(JsonObject target) {
  target["max_speed"] = runtimeMaxSpeed;
  target["hard_max_speed"] = FIRMWARE_HARD_MAX_SPEED;
  target["left_trim"] = leftTrim;
  target["right_trim"] = rightTrim;
  target["deadband"] = runtimeDeadband;
  target["default_ramp_ms"] = defaultRampMs;
  target["min_pwm"] = minPwm;
}

void addConfigWarnings(JsonArray warnings, const char *field, double requested,
                       double accepted) {
  if (fabs(requested - accepted) <= 0.0001) {
    return;
  }

  char warning[48];
  snprintf(warning, sizeof(warning), "%s_clamped", field);
  warnings.add(warning);
  Serial.printf("[CFG] %s clamped %.3f -> %.3f\n", field, requested,
                accepted);
}

void sanitizeLabel(const char *input, char *output, size_t outputSize) {
  if (!output || outputSize == 0) {
    return;
  }

  const char *source = input && strlen(input) > 0 ? input : "motion";
  size_t index = 0;

  for (; source[index] != '\0' && index < outputSize - 1; index++) {
    const char value = source[index];
    const bool safeChar =
        (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
        (value >= '0' && value <= '9') || value == '_' || value == '-' ||
        value == '.';
    output[index] = safeChar
                        ? value
                        : '_';
  }

  output[index] = '\0';
}

bool isStrictNumber(JsonVariantConst value) {
  if (value.isNull() || value.is<const char *>() || value.is<bool>() ||
      value.is<JsonArrayConst>() || value.is<JsonObjectConst>()) {
    return false;
  }

  return value.is<int>() || value.is<unsigned int>() || value.is<long>() ||
         value.is<unsigned long>() || value.is<float>() || value.is<double>();
}

bool isFiniteNumber(double value) {
  return !isnan(value) && !isinf(value);
}

float clampSpeed(float value) {
  return constrain(value, -runtimeMaxSpeed, runtimeMaxSpeed);
}

float applyDeadband(float value) {
  return fabsf(value) < runtimeDeadband ? 0.0f : value;
}

float applyTrimAndClamp(float value, float trim) {
  return applyDeadband(clampSpeed(value * trim));
}

uint32_t clampDuration(double durationMs) {
  const double bounded =
      constrain(durationMs, static_cast<double>(MIN_DURATION_MS),
                static_cast<double>(MAX_DURATION_MS));
  return static_cast<uint32_t>(lround(bounded));
}

uint32_t clampRamp(double rampMs, uint32_t durationMs) {
  const double safeRamp = constrain(rampMs, 0.0, static_cast<double>(MAX_RAMP_MS));
  const uint32_t bounded = static_cast<uint32_t>(lround(safeRamp));
  const uint32_t maxForDuration = durationMs / 2;
  return bounded < maxForDuration ? bounded : maxForDuration;
}

uint8_t clampMinPwm(double value) {
  const double bounded = constrain(value, 0.0, static_cast<double>(PWM_MAX_DUTY));
  return static_cast<uint8_t>(lround(bounded));
}

bool isStopped() {
  return fabsf(currentLeftSpeed) < 0.0001f && fabsf(currentRightSpeed) < 0.0001f;
}

bool deadlineReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

uint32_t motionRemainingMs(uint32_t now) {
  if (!motionActive) {
    return 0;
  }

  if (rampingDown) {
    const uint32_t rampEndAt = rampDownStartAt + motionRampMs;
    return deadlineReached(now, rampEndAt) ? 0 : rampEndAt - now;
  }

  return deadlineReached(now, motionEndAt) ? 0 : motionEndAt - now;
}

const char *motorState() {
  if (isStopped()) {
    return "stopped";
  }

  if (fabsf(currentAngular) > runtimeDeadband &&
      fabsf(currentLinear) <= runtimeDeadband) {
    return currentAngular > 0.0f ? "rotating_right" : "rotating_left";
  }

  if (fabsf(currentLinear) > runtimeDeadband &&
      fabsf(currentAngular) <= runtimeDeadband) {
    return currentLinear > 0.0f ? "moving_forward" : "moving_backward";
  }

  return "mixed";
}

void trackClient(uint8_t clientNum, bool isConnected) {
  if (clientNum >= MAX_TRACKED_CLIENTS) {
    return;
  }

  if (isConnected && !clientConnected[clientNum]) {
    clientConnected[clientNum] = true;
    connectedClientCount++;
  } else if (!isConnected && clientConnected[clientNum]) {
    clientConnected[clientNum] = false;
    if (connectedClientCount > 0) {
      connectedClientCount--;
    }
  }
}

void addRequestId(JsonDocument &doc, JsonVariantConst requestId) {
  if (requestId.isNull()) {
    return;
  }

  if (requestId.is<const char *>()) {
    doc["id"] = requestId.as<const char *>();
    return;
  }

  if (requestId.is<long>()) {
    doc["id"] = requestId.as<long>();
    return;
  }

  if (requestId.is<unsigned long>()) {
    doc["id"] = requestId.as<unsigned long>();
    return;
  }

  if (requestId.is<bool>()) {
    doc["id"] = requestId.as<bool>();
    return;
  }

  String fallback;
  serializeJson(requestId, fallback);
  doc["id"] = fallback;
}
