#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

const int I2C_SDA_PIN = 13;
const int I2C_SCL_PIN = 14;
const int SERVO_CHANNEL = 0;

const int SERVO_MIN = 200;
const int SERVO_MAX = 500;
const int SERVO_DELAY_MS = 1000;

Adafruit_PWMServoDriver pca = Adafruit_PWMServoDriver(0x40);

void setup() {
  Serial.begin(115200);
  delay(500);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  pca.begin();
  pca.setPWMFreq(50);

  Serial.println("PCA9685 servo test ready");
}

void loop() {
  Serial.println("Servo -> 200");
  pca.setPWM(SERVO_CHANNEL, 0, SERVO_MIN);
  delay(SERVO_DELAY_MS);

  Serial.println("Servo -> 500");
  pca.setPWM(SERVO_CHANNEL, 0, SERVO_MAX);
  delay(SERVO_DELAY_MS);
}
