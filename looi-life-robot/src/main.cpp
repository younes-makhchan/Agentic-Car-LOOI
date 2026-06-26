#include <Arduino.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <esp_arduino_version.h>
#include <esp_bt.h>
#include <esp_err.h>
#include <nvs_flash.h>

#include <math.h>

// This firmware intentionally contains no AI, personality, or Life
// Engine logic. The phone/server side will decide high-level intent later.
// The ESP32 is only the final motor safety layer that executes short, clamped
// motion commands and automatically stops.

// Placeholder motor pins for the current L298N test setup.
// Update these if your wiring changes.
constexpr uint8_t LEFT_IN1 = 22;
constexpr uint8_t LEFT_IN2 = 21;
constexpr uint8_t LEFT_EN = 5;
constexpr uint8_t LEFT_PWM_CHANNEL = 0;

constexpr uint8_t RIGHT_IN1 = 19;
constexpr uint8_t RIGHT_IN2 = 18;
constexpr uint8_t RIGHT_EN = 23;
constexpr uint8_t RIGHT_PWM_CHANNEL = 1;

// The face/gimbal is now mounted on the opposite side of the chassis.
// Keep incoming commands in LOOI's face-frame, then flip them for the motor base.
constexpr int8_t CHASSIS_LINEAR_SIGN = -1;
constexpr int8_t CHASSIS_ANGULAR_SIGN = -1;

constexpr uint8_t HEAD_I2C_SDA = 32;
constexpr uint8_t HEAD_I2C_SCL = 33;
constexpr uint8_t HEAD_PITCH_SERVO_CHANNEL = 7;
constexpr uint8_t HEAD_SERVO_FREQUENCY_HZ = 50;
constexpr uint16_t HEAD_PITCH_SAFE_MIN_PULSE = 500;
constexpr uint16_t HEAD_PITCH_SAFE_MAX_PULSE = 620;
constexpr uint16_t HEAD_PITCH_DEFAULT_PULSE = 570;
constexpr uint32_t HEAD_PITCH_DEFAULT_DURATION_MS = 350;
constexpr uint32_t HEAD_PITCH_MAX_DURATION_MS = 2000;
constexpr uint32_t HEAD_PITCH_UPDATE_INTERVAL_MS = 20;
constexpr char HEAD_PITCH_DEFAULT_EASING[] = "ease_in_out_cubic";
constexpr char HEAD_PITCH_EASE_OUT_CUBIC[] = "ease_out_cubic";
constexpr char HEAD_PITCH_EASE_OUT_QUART[] = "ease_out_quart";
constexpr char HEAD_PITCH_EXPONENTIAL_SMOOTHING[] = "exponential_smoothing";
constexpr char HEAD_PITCH_CRITICALLY_DAMPED_SPRING[] =
    "critically_damped_spring";
constexpr char HEAD_PITCH_MINIMUM_JERK[] = "minimum_jerk";

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

constexpr char BLE_DEVICE_NAME[] = "LOOI Body";
constexpr char BLE_SERVICE_UUID[] = "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0001";
constexpr char BLE_COMMAND_CHARACTERISTIC_UUID[] =
    "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0002";
constexpr char BLE_EVENTS_CHARACTERISTIC_UUID[] =
    "7f2c2b6a-2d8f-4f6b-9a59-8a7f9d7c0003";
constexpr size_t BLE_NOTIFY_CHUNK_SIZE = 180;
constexpr size_t BLE_COMMAND_BUFFER_MAX = 4096;

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
constexpr size_t JSON_DOC_SIZE = 2048;

Adafruit_PWMServoDriver headServoDriver = Adafruit_PWMServoDriver(0x40);

NimBLEServer *bleServer = nullptr;
NimBLECharacteristic *bleEventsCharacteristic = nullptr;
String bleCommandBuffer;
bool bleClientConnected = false;
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
uint16_t currentHeadPitchPulse = HEAD_PITCH_DEFAULT_PULSE;
uint16_t headPitchStartPulse = HEAD_PITCH_DEFAULT_PULSE;
uint16_t headPitchTargetPulse = HEAD_PITCH_DEFAULT_PULSE;
uint32_t headPitchStartAt = 0;
uint32_t headPitchDurationMs = 0;
uint32_t headPitchLastUpdateAt = 0;
bool headPitchMoving = false;
char headPitchEasing[32] = "ease_in_out_cubic";

void setupPins();
void setupHeadServo();
void setupBle();
void initializeNvsForBle();
void releaseClassicBluetoothMemory();
void handleBleCommandData(const uint8_t *payload, size_t length);
void handleJsonMessage(const uint8_t *payload, size_t length);
void handleMotionCommand(JsonObjectConst root);
void handleHeadPitchCommand(JsonObjectConst root);
void handleStopCommand(JsonObjectConst root);
void handleConfigUpdateCommand(JsonObjectConst root);
void handleConfigGetCommand(JsonObjectConst root);
void sendTelemetry();
void sendConfig(JsonVariantConst requestId);
void sendAck(const char *cmd, JsonVariantConst requestId);
void sendAck(const char *cmd, JsonVariantConst requestId, const char *reason);
void sendAck(const char *cmd, JsonVariantConst requestId, float linear,
             float angular, uint32_t durationMs, float leftSpeed,
             float rightSpeed, uint32_t rampMs, const char *label);
void sendError(const char *cmd, const char *message, JsonVariantConst requestId);
void sendBleText(const String &message);
void setDrive(float linear, float angular, uint32_t durationMs, uint32_t rampMs,
              const char *label);
void updateRampedMotion(bool force = false);
void updateHeadPitchMotion(bool force = false);
void applyMotorSpeeds(float leftSpeed, float rightSpeed);
void setMotorSide(uint8_t in1Pin, uint8_t in2Pin, uint8_t enablePin, float speed,
                  bool invert, uint8_t pwmChannel);
bool attachMotorPwm(uint8_t pin, uint8_t channel);
void writeMotorPwm(uint8_t pin, uint8_t channel, uint32_t duty);
void writeHeadPitchPulse(uint16_t pulse);
void setHeadPitchImmediate(uint16_t pulse, const char *label);
void startHeadPitchTransition(uint16_t targetPulse, uint32_t durationMs,
                              const char *easing, const char *label);
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
float toChassisLinear(float logicalLinear);
float toChassisAngular(float logicalAngular);
uint16_t clampHeadPitchPulse(double pulse);
uint32_t clampHeadPitchDuration(double durationMs);
const char *normalizeHeadPitchEasing(JsonVariantConst value);
float easeHeadPitchProgress(float progress, const char *easing);
uint32_t clampDuration(double durationMs);
uint32_t clampRamp(double rampMs, uint32_t durationMs);
uint8_t clampMinPwm(double value);
bool isStopped();
bool deadlineReached(uint32_t now, uint32_t deadline);
uint32_t motionRemainingMs(uint32_t now);
const char *motorState();
void addRequestId(JsonDocument &doc, JsonVariantConst requestId);

template <typename TDoc>
void sendJsonEvent(const TDoc &doc) {
  String message;
  serializeJson(doc, message);
  message += '\n';
  sendBleText(message);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(250);

  Serial.println();
  Serial.println("[BOOT] LOOI body firmware starting");
  Serial.println("[BOOT] ESP32 will only execute short, safe motor commands");

  setupPins();
  setupHeadServo();
  setupBle();
  stopMotors("boot");
}

void loop() {
  const uint32_t now = millis();

  updateRampedMotion();
  updateHeadPitchMotion();

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

  if (!attachMotorPwm(LEFT_EN, LEFT_PWM_CHANNEL)) {
    Serial.println("[BOOT] Failed to attach left PWM pin");
  }

  if (!attachMotorPwm(RIGHT_EN, RIGHT_PWM_CHANNEL)) {
    Serial.println("[BOOT] Failed to attach right PWM pin");
  }

  digitalWrite(LEFT_IN1, LOW);
  digitalWrite(LEFT_IN2, LOW);
  digitalWrite(RIGHT_IN1, LOW);
  digitalWrite(RIGHT_IN2, LOW);
  writeMotorPwm(LEFT_EN, LEFT_PWM_CHANNEL, 0);
  writeMotorPwm(RIGHT_EN, RIGHT_PWM_CHANNEL, 0);

  Serial.println("[BOOT] Motor pins configured");
}

void setupHeadServo() {
  Wire.begin(HEAD_I2C_SDA, HEAD_I2C_SCL);
  headServoDriver.begin();
  headServoDriver.setPWMFreq(HEAD_SERVO_FREQUENCY_HZ);
  delay(10);
  setHeadPitchImmediate(HEAD_PITCH_DEFAULT_PULSE, "boot_center");

  Serial.printf("[BOOT] Head pitch servo configured sda=%u scl=%u channel=%u range=%u..%u default=%u duration=%lu\n",
                HEAD_I2C_SDA, HEAD_I2C_SCL, HEAD_PITCH_SERVO_CHANNEL,
                HEAD_PITCH_SAFE_MIN_PULSE, HEAD_PITCH_SAFE_MAX_PULSE,
                HEAD_PITCH_DEFAULT_PULSE,
                static_cast<unsigned long>(HEAD_PITCH_DEFAULT_DURATION_MS));
}

class LooiBleServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &connInfo) override {
    (void)server;
    (void)connInfo;
    bleClientConnected = true;
    connectedClientCount = 1;
    bleCommandBuffer = "";
    Serial.println("[BLE] Client connected");
    sendTelemetry();
    sendConfig(JsonVariantConst());
  }

  void onDisconnect(NimBLEServer *server, NimBLEConnInfo &connInfo,
                    int reason) override {
    (void)server;
    (void)connInfo;
    bleClientConnected = false;
    connectedClientCount = 0;
    bleCommandBuffer = "";
    Serial.printf("[BLE] Client disconnected reason=%d\n", reason);
    stopMotors("ble_disconnect");
    NimBLEDevice::startAdvertising();
  }
};

class LooiBleCommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *characteristic,
               NimBLEConnInfo &connInfo) override {
    (void)connInfo;
    std::string value = characteristic->getValue();
    if (value.empty()) {
      return;
    }

    handleBleCommandData(reinterpret_cast<const uint8_t *>(value.data()),
                         value.length());
  }
};

void setupBle() {
  initializeNvsForBle();
  releaseClassicBluetoothMemory();

  NimBLEDevice::init(BLE_DEVICE_NAME);
  NimBLEDevice::setPower(9);

  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new LooiBleServerCallbacks());

  NimBLEService *service = bleServer->createService(BLE_SERVICE_UUID);
  NimBLECharacteristic *commandCharacteristic = service->createCharacteristic(
      BLE_COMMAND_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE |
                                           NIMBLE_PROPERTY::WRITE_NR);
  commandCharacteristic->setCallbacks(new LooiBleCommandCallbacks());

  bleEventsCharacteristic = service->createCharacteristic(
      BLE_EVENTS_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName(BLE_DEVICE_NAME);
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->addTxPower();
  advertising->enableScanResponse(true);
  advertising->start();

  Serial.printf("[BLE] Advertising as %s service=%s\n", BLE_DEVICE_NAME,
                BLE_SERVICE_UUID);
}

void initializeNvsForBle() {
  esp_err_t result = nvs_flash_init();

  if (result == ESP_ERR_NVS_NO_FREE_PAGES ||
      result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    Serial.printf("[BLE] NVS reset required before BLE init err=0x%x\n",
                  static_cast<unsigned int>(result));
    const esp_err_t eraseResult = nvs_flash_erase();
    if (eraseResult != ESP_OK) {
      Serial.printf("[BLE] NVS erase failed err=0x%x\n",
                    static_cast<unsigned int>(eraseResult));
      return;
    }
    result = nvs_flash_init();
  }

  if (result == ESP_OK) {
    Serial.println("[BLE] NVS ready");
  } else {
    Serial.printf("[BLE] NVS init failed err=0x%x\n",
                  static_cast<unsigned int>(result));
  }
}

void releaseClassicBluetoothMemory() {
  const esp_err_t result = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);

  if (result == ESP_OK) {
    Serial.println("[BLE] Released Classic BT memory");
    return;
  }

  if (result == ESP_ERR_INVALID_STATE) {
    Serial.println("[BLE] Classic BT memory already released or controller initialized");
    return;
  }

  Serial.printf("[BLE] Classic BT memory release skipped err=0x%x\n",
                static_cast<unsigned int>(result));
}

void handleBleCommandData(const uint8_t *payload, size_t length) {
  for (size_t index = 0; index < length; index++) {
    const char value = static_cast<char>(payload[index]);

    if (value == '\r') {
      continue;
    }

    if (value == '\n') {
      if (bleCommandBuffer.length() > 0) {
        handleJsonMessage(
            reinterpret_cast<const uint8_t *>(bleCommandBuffer.c_str()),
            bleCommandBuffer.length());
        bleCommandBuffer = "";
      }
      continue;
    }

    bleCommandBuffer += value;

    if (bleCommandBuffer.length() > BLE_COMMAND_BUFFER_MAX) {
      Serial.println("[SAFE] BLE command buffer overflow");
      bleCommandBuffer = "";
      stopMotors("ble_command_overflow");
      sendError("unknown", "BLE command too large", JsonVariantConst());
      return;
    }
  }
}

void handleJsonMessage(const uint8_t *payload, size_t length) {
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  const DeserializationError error = deserializeJson(doc, payload, length);

  if (error) {
    Serial.printf("[SAFE] Invalid JSON received: %s\n", error.c_str());
    stopMotors("invalid_json");
    sendError("unknown", "Invalid JSON", JsonVariantConst());
    return;
  }

  if (!doc.is<JsonObjectConst>()) {
    Serial.println("[SAFE] Invalid JSON root, expected object");
    stopMotors("invalid_json_root");
    sendError("unknown", "JSON root must be an object", JsonVariantConst());
    return;
  }

  const JsonObjectConst root = doc.as<JsonObjectConst>();
  const JsonVariantConst requestId = root["id"];
  const JsonVariantConst typeValue = root["type"];

  if (!typeValue.is<const char *>()) {
    Serial.println("[SAFE] Unknown command: missing or invalid type");
    stopMotors("unknown_command");
    sendError("unknown", "Missing or invalid command type", requestId);
    return;
  }

  const char *type = typeValue.as<const char *>();

  if (strcmp(type, "motion") == 0) {
    handleMotionCommand(root);
    return;
  }

  if (strcmp(type, "head_pitch") == 0) {
    handleHeadPitchCommand(root);
    return;
  }

  if (strcmp(type, "stop") == 0) {
    handleStopCommand(root);
    return;
  }

  if (strcmp(type, "config_update") == 0) {
    handleConfigUpdateCommand(root);
    return;
  }

  if (strcmp(type, "config_get") == 0) {
    handleConfigGetCommand(root);
    return;
  }

  if (strcmp(type, "ping") == 0) {
    lastCommandAt = millis();

    StaticJsonDocument<128> response;
    addRequestId(response, requestId);
    response["type"] = "pong";
    response["uptime_ms"] = millis();

    sendJsonEvent(response);
    return;
  }

  Serial.printf("[SAFE] Unknown command received: %s\n", type);
  stopMotors("unknown_command");
  sendError(type, "Unknown command", requestId);
}

void handleMotionCommand(JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  const JsonVariantConst linearValue = root["linear"];
  const JsonVariantConst angularValue = root["angular"];
  const JsonVariantConst durationValue = root["duration_ms"];
  const JsonVariantConst rampValue = root["ramp_ms"];

  if (!isStrictNumber(linearValue) || !isStrictNumber(angularValue)) {
    Serial.println("[SAFE] Motion rejected: linear/angular missing or invalid");
    stopMotors("invalid_motion");
    sendError("motion", "linear and angular must be numeric", requestId);
    return;
  }

  const double rawLinear = linearValue.as<double>();
  const double rawAngular = angularValue.as<double>();

  if (!isFiniteNumber(rawLinear) || !isFiniteNumber(rawAngular)) {
    Serial.println("[SAFE] Motion rejected: linear/angular not finite");
    stopMotors("invalid_motion");
    sendError("motion", "Motion values must be finite", requestId);
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

  const float chassisLinear = toChassisLinear(acceptedLinear);
  const float chassisAngular = toChassisAngular(acceptedAngular);
  const float mixedLeftBeforeClamp = chassisLinear - chassisAngular;
  const float mixedRightBeforeClamp = chassisLinear + chassisAngular;

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

  sendAck("motion", requestId, currentLinear, currentAngular, acceptedDuration,
          targetLeftSpeed, targetRightSpeed, acceptedRamp, motionLabel);
}

void handleHeadPitchCommand(JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  JsonVariantConst pulseValue = root["pulse"];

  if (pulseValue.isNull()) {
    pulseValue = root["orientation"];
  }

  if (!isStrictNumber(pulseValue) || !isFiniteNumber(pulseValue.as<double>())) {
    sendError("head_pitch", "pulse must be numeric", requestId);
    return;
  }

  const double requestedPulse = pulseValue.as<double>();
  const uint16_t acceptedPulse = clampHeadPitchPulse(requestedPulse);
  const JsonVariantConst durationValue = root["duration_ms"];
  double rawDuration = HEAD_PITCH_DEFAULT_DURATION_MS;

  if (!durationValue.isNull() && isStrictNumber(durationValue) &&
      isFiniteNumber(durationValue.as<double>())) {
    rawDuration = durationValue.as<double>();
  }

  const uint32_t acceptedDuration = clampHeadPitchDuration(rawDuration);
  const char *acceptedEasing = normalizeHeadPitchEasing(root["easing"]);
  char acceptedLabel[48] = "";
  sanitizeLabel(root["label"].is<const char *>() ? root["label"].as<const char *>()
                                                 : "head_pitch",
                acceptedLabel, sizeof(acceptedLabel));

  updateHeadPitchMotion(true);
  startHeadPitchTransition(acceptedPulse, acceptedDuration, acceptedEasing,
                           acceptedLabel);
  lastCommandAt = millis();

  StaticJsonDocument<512> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = "head_pitch";
  doc["accepted"] = true;
  doc["pulse"] = acceptedPulse;
  doc["target_pulse"] = acceptedPulse;
  doc["start_pulse"] = headPitchStartPulse;
  doc["current_pulse"] = currentHeadPitchPulse;
  doc["requested_pulse"] = requestedPulse;
  doc["clamped"] = fabs(requestedPulse - acceptedPulse) > 0.5;
  doc["duration_ms"] = acceptedDuration;
  doc["requested_duration_ms"] = rawDuration;
  doc["duration_clamped"] = fabs(rawDuration - acceptedDuration) > 0.5;
  doc["easing"] = acceptedEasing;
  doc["safe_min"] = HEAD_PITCH_SAFE_MIN_PULSE;
  doc["safe_max"] = HEAD_PITCH_SAFE_MAX_PULSE;
  doc["label"] = acceptedLabel;
  sendJsonEvent(doc);
}

void handleStopCommand(JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  const char *reason = "stop_command";

  if (root["reason"].is<const char *>()) {
    reason = root["reason"].as<const char *>();
  }

  lastCommandAt = millis();
  Serial.printf("[CMD] Stop command received reason=%s\n", reason);
  stopMotors(reason);
  sendAck("stop", requestId, reason);
}

void handleConfigUpdateCommand(JsonObjectConst root) {
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
  sendJsonEvent(doc);
}

void handleConfigGetCommand(JsonObjectConst root) {
  const JsonVariantConst requestId = root["id"];
  lastCommandAt = millis();
  sendConfig(requestId);
}

void sendTelemetry() {
  if (connectedClientCount == 0) {
    return;
  }

  const uint32_t now = millis();
  StaticJsonDocument<JSON_DOC_SIZE> doc;

  doc["type"] = "telemetry";
  doc["uptime_ms"] = now;
  doc["transport"] = "ble";
  doc["ble_connected"] = bleClientConnected;
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

  sendJsonEvent(doc);
}

void sendConfig(JsonVariantConst requestId) {
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  addRequestId(doc, requestId);
  doc["type"] = "config";
  JsonObject config = doc.createNestedObject("config");
  addConfig(config);
  sendJsonEvent(doc);
}

void sendAck(const char *cmd, JsonVariantConst requestId) {
  StaticJsonDocument<128> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = cmd;
  doc["accepted"] = true;
  sendJsonEvent(doc);
}

void sendAck(const char *cmd, JsonVariantConst requestId, const char *reason) {
  StaticJsonDocument<160> doc;
  addRequestId(doc, requestId);
  doc["type"] = "ack";
  doc["cmd"] = cmd;
  doc["accepted"] = true;
  doc["reason"] = reason;
  sendJsonEvent(doc);
}

void sendAck(const char *cmd, JsonVariantConst requestId, float linear,
             float angular, uint32_t durationMs, float leftSpeed,
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
  sendJsonEvent(doc);
}

void sendError(const char *cmd, const char *message, JsonVariantConst requestId) {
  StaticJsonDocument<192> doc;
  addRequestId(doc, requestId);
  doc["type"] = "error";
  doc["cmd"] = cmd;
  doc["message"] = message;
  sendJsonEvent(doc);
}

void sendBleText(const String &message) {
  if (!bleClientConnected || !bleEventsCharacteristic) {
    return;
  }

  for (size_t offset = 0; offset < message.length(); offset += BLE_NOTIFY_CHUNK_SIZE) {
    const size_t chunkLength =
        min(BLE_NOTIFY_CHUNK_SIZE, message.length() - offset);
    bleEventsCharacteristic->setValue(
        reinterpret_cast<const uint8_t *>(message.c_str() + offset),
        chunkLength);
    bleEventsCharacteristic->notify();
    delay(2);
  }
}

void setDrive(float linear, float angular, uint32_t durationMs, uint32_t rampMs,
              const char *label) {
  const uint32_t now = millis();

  currentLinear = applyDeadband(clampSpeed(linear));
  currentAngular = applyDeadband(clampSpeed(angular));

  const float chassisLinear = toChassisLinear(currentLinear);
  const float chassisAngular = toChassisAngular(currentAngular);
  const float leftSpeed =
      applyTrimAndClamp(applyDeadband(clampSpeed(chassisLinear - chassisAngular)),
                        leftTrim);
  const float rightSpeed =
      applyTrimAndClamp(applyDeadband(clampSpeed(chassisLinear + chassisAngular)),
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

void updateHeadPitchMotion(bool force) {
  if (!headPitchMoving) {
    return;
  }

  const uint32_t now = millis();

  if (!force && now - headPitchLastUpdateAt < HEAD_PITCH_UPDATE_INTERVAL_MS) {
    return;
  }

  headPitchLastUpdateAt = now;

  if (headPitchDurationMs == 0 ||
      now - headPitchStartAt >= headPitchDurationMs) {
    writeHeadPitchPulse(headPitchTargetPulse);
    headPitchMoving = false;
    Serial.printf("[HEAD] pitch complete pulse=%u easing=%s\n",
                  currentHeadPitchPulse, headPitchEasing);
    return;
  }

  const float progress = constrain(
      static_cast<float>(now - headPitchStartAt) /
          static_cast<float>(headPitchDurationMs),
      0.0f, 1.0f);
  const float easedProgress = easeHeadPitchProgress(progress, headPitchEasing);
  const float nextPulse =
      static_cast<float>(headPitchStartPulse) +
      (static_cast<float>(headPitchTargetPulse) -
       static_cast<float>(headPitchStartPulse)) *
          easedProgress;

  writeHeadPitchPulse(static_cast<uint16_t>(lroundf(nextPulse)));
}

void applyMotorSpeeds(float leftSpeed, float rightSpeed) {
  currentLeftSpeed = applyDeadband(clampSpeed(leftSpeed));
  currentRightSpeed = applyDeadband(clampSpeed(rightSpeed));

  setMotorSide(LEFT_IN1, LEFT_IN2, LEFT_EN, currentLeftSpeed, LEFT_INVERT,
               LEFT_PWM_CHANNEL);
  setMotorSide(RIGHT_IN1, RIGHT_IN2, RIGHT_EN, currentRightSpeed, RIGHT_INVERT,
               RIGHT_PWM_CHANNEL);
}

void setMotorSide(uint8_t in1Pin, uint8_t in2Pin, uint8_t enablePin, float speed,
                  bool invert, uint8_t pwmChannel) {
  const float effectiveSpeed = invert ? -speed : speed;
  uint32_t duty = static_cast<uint32_t>(
      roundf(fabsf(effectiveSpeed) * static_cast<float>(PWM_MAX_DUTY)));

  if (fabsf(effectiveSpeed) < 0.0001f) {
    digitalWrite(in1Pin, LOW);
    digitalWrite(in2Pin, LOW);
    writeMotorPwm(enablePin, pwmChannel, 0);
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

  writeMotorPwm(enablePin, pwmChannel, duty);
}

bool attachMotorPwm(uint8_t pin, uint8_t channel) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  return ledcAttach(pin, PWM_FREQUENCY_HZ, PWM_RESOLUTION_BITS);
#else
  ledcSetup(channel, PWM_FREQUENCY_HZ, PWM_RESOLUTION_BITS);
  ledcAttachPin(pin, channel);
  return true;
#endif
}

void writeMotorPwm(uint8_t pin, uint8_t channel, uint32_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  ledcWrite(channel, duty);
#endif
}

void writeHeadPitchPulse(uint16_t pulse) {
  currentHeadPitchPulse = clampHeadPitchPulse(pulse);
  headServoDriver.setPWM(HEAD_PITCH_SERVO_CHANNEL, 0, currentHeadPitchPulse);
}

void setHeadPitchImmediate(uint16_t pulse, const char *label) {
  headPitchMoving = false;
  headPitchStartPulse = currentHeadPitchPulse;
  headPitchTargetPulse = clampHeadPitchPulse(pulse);
  headPitchDurationMs = 0;
  writeHeadPitchPulse(headPitchTargetPulse);

  Serial.printf("[HEAD] pitch immediate pulse=%u label=%s\n",
                currentHeadPitchPulse,
                label && strlen(label) > 0 ? label : "head_pitch");
}

void startHeadPitchTransition(uint16_t targetPulse, uint32_t durationMs,
                              const char *easing, const char *label) {
  const uint16_t acceptedTarget = clampHeadPitchPulse(targetPulse);
  const uint32_t acceptedDuration = clampHeadPitchDuration(durationMs);
  const char *acceptedEasing = easing && strlen(easing) > 0
                                   ? easing
                                   : HEAD_PITCH_DEFAULT_EASING;

  if (acceptedDuration == 0 || acceptedTarget == currentHeadPitchPulse) {
    setHeadPitchImmediate(acceptedTarget, label);
    return;
  }

  headPitchStartPulse = currentHeadPitchPulse;
  headPitchTargetPulse = acceptedTarget;
  headPitchStartAt = millis();
  headPitchDurationMs = acceptedDuration;
  headPitchLastUpdateAt = 0;
  headPitchMoving = true;
  strncpy(headPitchEasing, acceptedEasing, sizeof(headPitchEasing) - 1);
  headPitchEasing[sizeof(headPitchEasing) - 1] = '\0';

  Serial.printf(
      "[HEAD] pitch transition start=%u target=%u duration=%lu easing=%s "
      "label=%s\n",
      headPitchStartPulse, headPitchTargetPulse,
      static_cast<unsigned long>(headPitchDurationMs), headPitchEasing,
      label && strlen(label) > 0 ? label : "head_pitch");

  updateHeadPitchMotion(true);
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
  JsonObject head = target.createNestedObject("head_pitch");
  head["pulse"] = currentHeadPitchPulse;
  head["safe_min"] = HEAD_PITCH_SAFE_MIN_PULSE;
  head["safe_max"] = HEAD_PITCH_SAFE_MAX_PULSE;
  head["default"] = HEAD_PITCH_DEFAULT_PULSE;
  head["default_duration_ms"] = HEAD_PITCH_DEFAULT_DURATION_MS;
  head["max_duration_ms"] = HEAD_PITCH_MAX_DURATION_MS;
  head["update_interval_ms"] = HEAD_PITCH_UPDATE_INTERVAL_MS;
  head["moving"] = headPitchMoving;
  head["target_pulse"] = headPitchTargetPulse;
  head["duration_ms"] = headPitchDurationMs;
  head["easing"] = headPitchEasing;
  JsonArray easingModes = head.createNestedArray("easing_modes");
  easingModes.add(HEAD_PITCH_DEFAULT_EASING);
  easingModes.add(HEAD_PITCH_EASE_OUT_CUBIC);
  easingModes.add(HEAD_PITCH_EASE_OUT_QUART);
  easingModes.add(HEAD_PITCH_EXPONENTIAL_SMOOTHING);
  easingModes.add(HEAD_PITCH_CRITICALLY_DAMPED_SPRING);
  easingModes.add(HEAD_PITCH_MINIMUM_JERK);
  head["channel"] = HEAD_PITCH_SERVO_CHANNEL;
  head["sda"] = HEAD_I2C_SDA;
  head["scl"] = HEAD_I2C_SCL;
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

float toChassisLinear(float logicalLinear) {
  return logicalLinear * static_cast<float>(CHASSIS_LINEAR_SIGN);
}

float toChassisAngular(float logicalAngular) {
  return logicalAngular * static_cast<float>(CHASSIS_ANGULAR_SIGN);
}

uint16_t clampHeadPitchPulse(double pulse) {
  const double bounded =
      constrain(pulse, static_cast<double>(HEAD_PITCH_SAFE_MIN_PULSE),
                static_cast<double>(HEAD_PITCH_SAFE_MAX_PULSE));
  return static_cast<uint16_t>(lround(bounded));
}

uint32_t clampHeadPitchDuration(double durationMs) {
  const double bounded =
      constrain(durationMs, 0.0, static_cast<double>(HEAD_PITCH_MAX_DURATION_MS));
  return static_cast<uint32_t>(lround(bounded));
}

const char *normalizeHeadPitchEasing(JsonVariantConst value) {
  if (!value.is<const char *>()) {
    return HEAD_PITCH_DEFAULT_EASING;
  }

  const char *requested = value.as<const char *>();

  if (!requested) {
    return HEAD_PITCH_DEFAULT_EASING;
  }

  if (strcmp(requested, HEAD_PITCH_DEFAULT_EASING) == 0) {
    return HEAD_PITCH_DEFAULT_EASING;
  }

  if (strcmp(requested, HEAD_PITCH_EASE_OUT_CUBIC) == 0) {
    return HEAD_PITCH_EASE_OUT_CUBIC;
  }

  if (strcmp(requested, HEAD_PITCH_EASE_OUT_QUART) == 0) {
    return HEAD_PITCH_EASE_OUT_QUART;
  }

  if (strcmp(requested, HEAD_PITCH_EXPONENTIAL_SMOOTHING) == 0) {
    return HEAD_PITCH_EXPONENTIAL_SMOOTHING;
  }

  if (strcmp(requested, HEAD_PITCH_CRITICALLY_DAMPED_SPRING) == 0) {
    return HEAD_PITCH_CRITICALLY_DAMPED_SPRING;
  }

  if (strcmp(requested, HEAD_PITCH_MINIMUM_JERK) == 0) {
    return HEAD_PITCH_MINIMUM_JERK;
  }

  return HEAD_PITCH_DEFAULT_EASING;
}

float easeHeadPitchProgress(float progress, const char *easing) {
  const float t = constrain(progress, 0.0f, 1.0f);

  if (!easing || strcmp(easing, HEAD_PITCH_DEFAULT_EASING) == 0) {
    return t < 0.5f ? 4.0f * t * t * t
                    : 1.0f - powf(-2.0f * t + 2.0f, 3.0f) / 2.0f;
  }

  if (strcmp(easing, HEAD_PITCH_EASE_OUT_CUBIC) == 0) {
    const float inverse = 1.0f - t;
    return 1.0f - inverse * inverse * inverse;
  }

  if (strcmp(easing, HEAD_PITCH_EASE_OUT_QUART) == 0) {
    const float inverse = 1.0f - t;
    return 1.0f - inverse * inverse * inverse * inverse;
  }

  if (strcmp(easing, HEAD_PITCH_EXPONENTIAL_SMOOTHING) == 0) {
    constexpr float response = 5.0f;
    const float normalizedEnd = 1.0f - expf(-response);
    return (1.0f - expf(-response * t)) / normalizedEnd;
  }

  if (strcmp(easing, HEAD_PITCH_CRITICALLY_DAMPED_SPRING) == 0) {
    constexpr float response = 6.0f;
    const float value = 1.0f - (1.0f + response * t) * expf(-response * t);
    const float endValue = 1.0f - (1.0f + response) * expf(-response);
    return value / endValue;
  }

  if (strcmp(easing, HEAD_PITCH_MINIMUM_JERK) == 0) {
    const float t2 = t * t;
    const float t3 = t2 * t;
    return 10.0f * t3 - 15.0f * t3 * t + 6.0f * t3 * t2;
  }

  return t;
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
