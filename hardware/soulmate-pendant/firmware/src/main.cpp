#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <TFT_eSPI.h>
#include <Wire.h>
#include <driver/i2s.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <math.h>

#include "nc01_config.h"

namespace {

enum class DisplayState : uint8_t {
  Boot,
  Idle,
  Affection,
  Listening,
  Thinking,
  Speaking,
  Happy,
  Notice,
  Charging,
  LowPower,
  Sleep
};

struct CompanionSnapshot {
  String profileId = "local-prototype";
  String name = "NEXORA";
  String starter = "cute";
  String stage = "seed";
  String notice;
  uint16_t bond = 0;
  uint8_t battery = 76;
  uint16_t batteryMillivolts = 0;
  bool batteryPresent = false;
  bool connected = false;
  String diagnostic;
  bool diagnosticPassed = false;
  DisplayState state = DisplayState::Boot;
};

struct PendingPayload {
  size_t length = 0;
  char bytes[nexora::kMaxSnapshotBytes + 1] = {};
};

struct BatteryMeasurement {
  bool present = false;
  uint8_t percent = 0;
  uint16_t millivolts = 0;
};

TFT_eSPI display;
Preferences preferences;
CompanionSnapshot snapshot;
NimBLECharacteristic* snapshotCharacteristic = nullptr;
bool filesystemReady = false;
bool renderRequested = true;
bool profileDirty = false;
uint32_t lastInteractionAt = 0;
uint32_t lastAnimationAt = 0;
uint32_t lastBatterySampleAt = 0;
uint32_t profileDirtyAt = 0;
uint8_t animationFrame = 0;
QueueHandle_t snapshotQueue = nullptr;
volatile int8_t connectionEvent = 0;

uint16_t colorBackground;
uint16_t colorInk;
uint16_t colorMuted;
uint16_t colorCyan;
uint16_t colorCoral;
uint16_t colorDanger;

const char* stateName(DisplayState state) {
  switch (state) {
    case DisplayState::Boot: return "boot";
    case DisplayState::Idle: return "idle";
    case DisplayState::Affection: return "affection";
    case DisplayState::Listening: return "listening";
    case DisplayState::Thinking: return "thinking";
    case DisplayState::Speaking: return "speaking";
    case DisplayState::Happy: return "happy";
    case DisplayState::Notice: return "notice";
    case DisplayState::Charging: return "charging";
    case DisplayState::LowPower: return "low-power";
    case DisplayState::Sleep: return "sleep";
  }
  return "idle";
}

DisplayState parseState(const String& value) {
  if (value == "boot") return DisplayState::Boot;
  if (value == "affection") return DisplayState::Affection;
  if (value == "listening") return DisplayState::Listening;
  if (value == "thinking") return DisplayState::Thinking;
  if (value == "speaking") return DisplayState::Speaking;
  if (value == "happy") return DisplayState::Happy;
  if (value == "notice") return DisplayState::Notice;
  if (value == "charging") return DisplayState::Charging;
  if (value == "low-power") return DisplayState::LowPower;
  if (value == "sleep") return DisplayState::Sleep;
  return DisplayState::Idle;
}

bool isAllowed(const String& value, const char* first, const char* second, const char* third) {
  return value == first || value == second || value == third;
}

String compactText(const char* value, size_t maxBytes) {
  String result = value ? String(value) : String();
  result.trim();
  if (result.length() > maxBytes) {
    size_t boundary = maxBytes;
    while (boundary > 0 && (static_cast<uint8_t>(result[boundary]) & 0xc0) == 0x80) boundary -= 1;
    result.remove(boundary);
  }
  return result;
}

String framePath() {
  String poseCode = "i";
  switch (snapshot.state) {
    case DisplayState::Affection: poseCode = "a"; break;
    case DisplayState::Listening: poseCode = "l"; break;
    case DisplayState::Thinking: poseCode = "t"; break;
    case DisplayState::Speaking: poseCode = "s"; break;
    case DisplayState::Happy:
    case DisplayState::Notice: poseCode = "h"; break;
    default: break;
  }
  return "/characters/" + snapshot.starter + "-" + snapshot.stage + "-" + poseCode + ".nxr";
}

void setBacklight(bool enabled) {
  digitalWrite(nexora::kBacklightPin, enabled ? HIGH : LOW);
}

void touchActivity() {
  lastInteractionAt = millis();
  if (snapshot.state == DisplayState::Sleep) snapshot.state = DisplayState::Idle;
  setBacklight(true);
}

void drawFallbackCharacter() {
  const uint16_t accent = snapshot.starter == "cool"
    ? display.color565(37, 184, 202)
    : snapshot.starter == "beautiful"
      ? display.color565(227, 103, 133)
      : display.color565(244, 161, 73);
  display.fillCircle(120, 119, 55, accent);
  display.fillCircle(101, 108, 6, colorInk);
  display.fillCircle(139, 108, 6, colorInk);
  display.drawArc(120, 128, 18, 16, 30, 150, colorInk, colorBackground, true);
}

bool drawCharacterFrame() {
  if (!filesystemReady) return false;
  File file = LittleFS.open(framePath(), "r");
  if (!file || file.size() != 8 + nexora::kScreenWidth * nexora::kScreenHeight * 2) return false;
  uint8_t header[8];
  if (file.read(header, sizeof(header)) != sizeof(header) ||
      memcmp(header, "NXR1", 4) != 0 ||
      (header[4] | (header[5] << 8)) != nexora::kScreenWidth ||
      (header[6] | (header[7] << 8)) != nexora::kScreenHeight) {
    file.close();
    return false;
  }

  uint16_t row[nexora::kScreenWidth];
  display.startWrite();
  for (uint16_t y = 0; y < nexora::kScreenHeight; y += 1) {
    if (file.read(reinterpret_cast<uint8_t*>(row), sizeof(row)) != sizeof(row)) {
      display.endWrite();
      file.close();
      return false;
    }
    display.pushImage(0, y, nexora::kScreenWidth, 1, row);
  }
  display.endWrite();
  file.close();
  return true;
}

void drawConnectionAndBattery() {
  display.fillCircle(75, 28, 3, snapshot.connected ? colorCyan : colorMuted);
  if (!snapshot.batteryPresent) {
    display.setTextDatum(MC_DATUM);
    display.setTextColor(colorMuted, colorBackground);
    display.setTextFont(1);
    display.drawString("USB", 162, 28);
    return;
  }
  display.drawRoundRect(150, 22, 24, 11, 3, colorInk);
  display.fillRect(174, 25, 2, 5, colorInk);
  const uint8_t batteryWidth = map(snapshot.battery, 0, 100, 0, 18);
  const uint16_t batteryColor = snapshot.battery <= 10 ? colorDanger : colorInk;
  if (batteryWidth > 0) display.fillRect(153, 25, batteryWidth, 5, batteryColor);
}

void drawFooter() {
  display.setTextDatum(MC_DATUM);
  display.setTextColor(colorInk, colorBackground);
  display.setTextFont(2);
  char bond[12];
  snprintf(bond, sizeof(bond), "R %02u", min<uint16_t>(snapshot.bond, 99));
  display.drawString(bond, 120, 208);
}

void drawListening() {
  const int radius = 87 + (animationFrame % 3) * 4;
  display.drawCircle(120, 122, radius, colorCyan);
  display.drawCircle(120, 122, radius + 1, colorCyan);
}

void drawThinking() {
  for (uint8_t i = 0; i < 3; i += 1) {
    const uint8_t phase = (animationFrame + i) % 3;
    display.fillCircle(104 + i * 16, 188, phase == 0 ? 5 : 3, colorCyan);
  }
}

void drawSpeaking() {
  for (uint8_t i = 0; i < 5; i += 1) {
    const uint8_t height = 5 + ((animationFrame * 3 + i * 2) % 4) * 4;
    display.fillRoundRect(96 + i * 12, 181 - height / 2, 5, height, 2, colorCoral);
  }
}

void drawNotice() {
  display.fillCircle(176, 55, 8, colorCoral);
  display.fillCircle(176, 55, 3, colorBackground);
}

void drawCharging() {
  const int16_t x = 177;
  const int16_t y = 50;
  display.fillTriangle(x, y, x - 9, y + 17, x - 1, y + 17, colorCyan);
  display.fillTriangle(x - 1, y + 12, x + 7, y + 12, x - 7, y + 31, colorCyan);
}

void drawLowPower() {
  display.drawCircle(120, 120, 103, colorDanger);
  display.drawCircle(120, 120, 102, colorDanger);
}

void renderBoot() {
  display.fillScreen(colorInk);
  display.setTextDatum(MC_DATUM);
  display.setTextColor(TFT_WHITE, colorInk);
  display.setTextFont(2);
  display.drawString("NEXORA", 120, 106);
  display.setTextColor(colorCyan, colorInk);
  display.drawString("CORE / NC-01", 120, 130);
}

void renderDisplay() {
  renderRequested = false;
  if (snapshot.state == DisplayState::Sleep) {
    display.fillScreen(TFT_BLACK);
    setBacklight(false);
    return;
  }
  setBacklight(true);
  if (snapshot.state == DisplayState::Boot) {
    renderBoot();
    return;
  }
  if (!drawCharacterFrame()) {
    display.fillScreen(colorBackground);
    drawFallbackCharacter();
  }
  drawConnectionAndBattery();
  drawFooter();
  switch (snapshot.state) {
    case DisplayState::Listening: drawListening(); break;
    case DisplayState::Thinking: drawThinking(); break;
    case DisplayState::Speaking: drawSpeaking(); break;
    case DisplayState::Notice: drawNotice(); break;
    case DisplayState::Charging: drawCharging(); break;
    case DisplayState::LowPower: drawLowPower(); break;
    default: break;
  }
}

String serializeSnapshot() {
  JsonDocument document;
  document["v"] = 1;
  document["profileId"] = snapshot.profileId;
  document["name"] = snapshot.name;
  document["starter"] = snapshot.starter;
  document["stage"] = snapshot.stage;
  document["bond"] = snapshot.bond;
  document["state"] = stateName(snapshot.state);
  document["battery"] = snapshot.battery;
  document["batteryPresent"] = snapshot.batteryPresent;
  if (snapshot.batteryMillivolts > 0) document["batteryMv"] = snapshot.batteryMillivolts;
  if (!snapshot.notice.isEmpty()) document["notice"] = snapshot.notice;
  if (!snapshot.diagnostic.isEmpty()) {
    document["diagnostic"] = snapshot.diagnostic;
    document["diagnosticPassed"] = snapshot.diagnosticPassed;
  }
  String output;
  serializeJson(document, output);
  return output;
}

void publishSnapshot() {
  if (!snapshotCharacteristic) return;
  const String payload = serializeSnapshot();
  snapshotCharacteristic->setValue(
    reinterpret_cast<const uint8_t*>(payload.c_str()), payload.length());
  if (snapshot.connected) snapshotCharacteristic->notify();
}

void requestState(DisplayState state) {
  snapshot.state = snapshot.batteryPresent && snapshot.battery <= 10 &&
      state != DisplayState::Charging &&
      state != DisplayState::Boot &&
      state != DisplayState::Sleep
    ? DisplayState::LowPower
    : state;
  touchActivity();
  animationFrame = 0;
  renderRequested = true;
  publishSnapshot();
}

bool installAudioDriver(i2s_mode_t mode, i2s_channel_fmt_t channelFormat) {
  i2s_config_t config = {};
  config.mode = mode;
  config.sample_rate = nexora::kAudioSampleRate;
  config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  config.channel_format = channelFormat;
  config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  config.dma_buf_count = 4;
  config.dma_buf_len = 128;
  config.use_apll = false;
  config.tx_desc_auto_clear = true;
  config.fixed_mclk = 0;

  if (i2s_driver_install(I2S_NUM_0, &config, 0, nullptr) != ESP_OK) return false;
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = nexora::kAudioBitClockPin;
  pins.ws_io_num = nexora::kAudioWordSelectPin;
  pins.data_out_num = (mode & I2S_MODE_TX) ? nexora::kSpeakerDataPin : I2S_PIN_NO_CHANGE;
  pins.data_in_num = (mode & I2S_MODE_RX) ? nexora::kMicrophoneDataPin : I2S_PIN_NO_CHANGE;
  if (i2s_set_pin(I2S_NUM_0, &pins) == ESP_OK) return true;
  i2s_driver_uninstall(I2S_NUM_0);
  return false;
}

void finishDiagnostic(const String& name, bool passed, const String& detail) {
  snapshot.diagnostic = name;
  snapshot.diagnosticPassed = passed;
  snapshot.notice = compactText(detail.c_str(), 47);
  requestState(DisplayState::Notice);
  Serial.printf("DIAGNOSTIC %s %s: %s\n", name.c_str(), passed ? "PASS" : "FAIL", detail.c_str());
}

void runMicrophoneDiagnostic() {
  if (digitalRead(nexora::kMicMuteSensePin) == LOW) {
    finishDiagnostic("microphone", false, "MIC MUTED");
    return;
  }
  if (!installAudioDriver(
      static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX),
      I2S_CHANNEL_FMT_ONLY_LEFT)) {
    finishDiagnostic("microphone", false, "MIC I2S INIT");
    return;
  }

  int32_t samples[128] = {};
  uint32_t peak = 0;
  size_t sampleCount = 0;
  const uint32_t startedAt = millis();
  while (millis() - startedAt < nexora::kMicrophoneDiagnosticMs) {
    size_t bytesRead = 0;
    if (i2s_read(I2S_NUM_0, samples, sizeof(samples), &bytesRead, pdMS_TO_TICKS(80)) != ESP_OK) continue;
    const size_t count = bytesRead / sizeof(samples[0]);
    sampleCount += count;
    for (size_t index = 0; index < count; index += 1) {
      const int64_t signedSample = samples[index];
      const uint32_t magnitude = static_cast<uint32_t>(signedSample < 0 ? -signedSample : signedSample);
      peak = max(peak, magnitude >> 8);
    }
  }
  i2s_driver_uninstall(I2S_NUM_0);
  const bool passed = sampleCount > 0 && peak > 0;
  finishDiagnostic("microphone", passed, "MIC PEAK " + String(peak));
}

void runSpeakerDiagnostic() {
  if (!installAudioDriver(
      static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX),
      I2S_CHANNEL_FMT_RIGHT_LEFT)) {
    finishDiagnostic("speaker", false, "SPK I2S INIT");
    return;
  }

  digitalWrite(nexora::kAmplifierShutdownPin, HIGH);
  i2s_zero_dma_buffer(I2S_NUM_0);
  delay(30);
  int32_t samples[128] = {};
  float phase = 0.0f;
  const float phaseStep = 2.0f * PI * 660.0f / nexora::kAudioSampleRate;
  size_t bytesWrittenTotal = 0;
  const uint32_t startedAt = millis();
  while (millis() - startedAt < nexora::kSpeakerDiagnosticMs) {
    for (size_t frame = 0; frame < 64; frame += 1) {
      const int32_t sample = static_cast<int32_t>(sinf(phase) * 134217728.0f);
      samples[frame * 2] = sample;
      samples[frame * 2 + 1] = sample;
      phase += phaseStep;
      if (phase >= 2.0f * PI) phase -= 2.0f * PI;
    }
    size_t bytesWritten = 0;
    if (i2s_write(I2S_NUM_0, samples, sizeof(samples), &bytesWritten, pdMS_TO_TICKS(100)) == ESP_OK) {
      bytesWrittenTotal += bytesWritten;
    }
  }
  i2s_zero_dma_buffer(I2S_NUM_0);
  digitalWrite(nexora::kAmplifierShutdownPin, LOW);
  i2s_driver_uninstall(I2S_NUM_0);
  finishDiagnostic("speaker", bytesWrittenTotal > 0, "SPK TONE 660HZ");
}

void runHapticDiagnostic() {
  digitalWrite(nexora::kHapticDrivePinA, HIGH);
  delay(nexora::kHapticDiagnosticMs);
  digitalWrite(nexora::kHapticDrivePinA, LOW);
  finishDiagnostic("haptic", true, "HAPTIC PULSE");
}

int readImuWhoAmI(uint8_t& address) {
  constexpr uint8_t candidates[] = {0x6a, 0x6b};
  for (const uint8_t candidate : candidates) {
    Wire.beginTransmission(candidate);
    Wire.write(0x00);
    if (Wire.endTransmission(false) != 0) continue;
    if (Wire.requestFrom(candidate, static_cast<uint8_t>(1)) != 1) continue;
    address = candidate;
    return Wire.read();
  }
  return -1;
}

void runImuDiagnostic() {
  uint8_t address = 0;
  const int identity = readImuWhoAmI(address);
  const bool passed = identity == 0x05;
  finishDiagnostic(
    "imu",
    passed,
    passed ? "IMU 0X" + String(identity, HEX) + " @0X" + String(address, HEX) : "IMU NOT FOUND");
}

void runMuteDiagnostic() {
  const bool muted = digitalRead(nexora::kMicMuteSensePin) == LOW;
  finishDiagnostic("mute", true, muted ? "MUTE CLOSED" : "MUTE OPEN");
}

bool runDiagnostic(const String& value) {
  if (value == "microphone") runMicrophoneDiagnostic();
  else if (value == "speaker") runSpeakerDiagnostic();
  else if (value == "haptic") runHapticDiagnostic();
  else if (value == "imu") runImuDiagnostic();
  else if (value == "mute") runMuteDiagnostic();
  else return false;
  return true;
}

bool applyPayload(const String& payload) {
  if (payload.isEmpty() || payload.length() > nexora::kMaxSnapshotBytes) return false;
  JsonDocument document;
  if (deserializeJson(document, payload)) return false;
  bool visualChanged = false;
  bool identityChanged = false;

  if (document["profileId"].is<const char*>()) {
    const String next = compactText(document["profileId"], 63);
    if (!next.isEmpty() && next != snapshot.profileId) {
      snapshot.profileId = next;
      identityChanged = true;
    }
  }
  if (document["name"].is<const char*>()) {
    const String next = compactText(document["name"], 35);
    if (!next.isEmpty() && next != snapshot.name) {
      snapshot.name = next;
      identityChanged = true;
    }
  }
  if (document["starter"].is<const char*>()) {
    const String next = document["starter"].as<String>();
    if (isAllowed(next, "cute", "cool", "beautiful") && next != snapshot.starter) {
      snapshot.starter = next;
      visualChanged = true;
      identityChanged = true;
    }
  }
  if (document["stage"].is<const char*>()) {
    const String next = document["stage"].as<String>();
    if (isAllowed(next, "seed", "young", "resonance") && next != snapshot.stage) {
      snapshot.stage = next;
      visualChanged = true;
      identityChanged = true;
    }
  }
  if (document["bond"].is<int>()) {
    const uint16_t next = constrain(document["bond"].as<int>(), 0, 9999);
    if (next != snapshot.bond) {
      snapshot.bond = next;
      visualChanged = true;
      identityChanged = true;
    }
  }
  if (document["battery"].is<int>()) {
    snapshot.battery = constrain(document["battery"].as<int>(), 0, 100);
    snapshot.batteryPresent = true;
    visualChanged = true;
  }
  if (document["notice"].is<const char*>()) snapshot.notice = compactText(document["notice"], 47);
  if (document["state"].is<const char*>()) {
    requestState(parseState(document["state"].as<String>()));
  } else {
    touchActivity();
    renderRequested = renderRequested || visualChanged;
  }

  if (document["diagnostic"].is<const char*>()) {
    const String diagnostic = document["diagnostic"].as<String>();
    if (!runDiagnostic(diagnostic)) return false;
  }

  if (identityChanged) {
    profileDirty = true;
    profileDirtyAt = millis();
  }
  publishSnapshot();
  return true;
}

void loadProfile() {
  preferences.begin("nexora", false);
  snapshot.profileId = preferences.getString("profile", snapshot.profileId);
  snapshot.name = preferences.getString("name", snapshot.name);
  snapshot.starter = preferences.getString("starter", snapshot.starter);
  snapshot.stage = preferences.getString("stage", snapshot.stage);
  snapshot.bond = preferences.getUShort("bond", snapshot.bond);
  if (!isAllowed(snapshot.starter, "cute", "cool", "beautiful")) snapshot.starter = "cute";
  if (!isAllowed(snapshot.stage, "seed", "young", "resonance")) snapshot.stage = "seed";
}

void saveProfileIfDue() {
  if (!profileDirty || millis() - profileDirtyAt < 3000) return;
  preferences.putString("profile", snapshot.profileId);
  preferences.putString("name", snapshot.name);
  preferences.putString("starter", snapshot.starter);
  preferences.putString("stage", snapshot.stage);
  preferences.putUShort("bond", snapshot.bond);
  profileDirty = false;
}

BatteryMeasurement readBattery() {
  uint32_t total = 0;
  for (uint8_t sample = 0; sample < 8; sample += 1) total += analogRead(nexora::kBatteryAdcPin);
  const float adc = total / 8.0f;
  const float voltage = (3.3f / 4095.0f) * 3.0f * adc;
  BatteryMeasurement measurement;
  measurement.present = voltage >= nexora::kBatteryAbsentVoltage;
  measurement.millivolts = measurement.present ? static_cast<uint16_t>(voltage * 1000.0f) : 0;
  measurement.percent = measurement.present
    ? constrain(static_cast<int>((voltage - 3.3f) * (100.0f / 0.9f)), 0, 100)
    : 0;
  return measurement;
}

void sampleBattery(bool force = false) {
  if (!force && millis() - lastBatterySampleAt < nexora::kBatterySampleMs) return;
  lastBatterySampleAt = millis();
  const BatteryMeasurement measured = readBattery();
  const bool wasPresent = snapshot.batteryPresent;
  snapshot.batteryPresent = measured.present;
  snapshot.batteryMillivolts = measured.millivolts;
  if (measured.present) {
    snapshot.battery = wasPresent
      ? static_cast<uint8_t>((snapshot.battery * 3 + measured.percent) / 4)
      : measured.percent;
  } else if (snapshot.state == DisplayState::LowPower) {
    snapshot.state = DisplayState::Idle;
  }
  if (snapshot.batteryPresent && snapshot.battery <= 10 && snapshot.state != DisplayState::Charging &&
      snapshot.state != DisplayState::Boot && snapshot.state != DisplayState::Sleep) {
    snapshot.state = DisplayState::LowPower;
  }
  renderRequested = true;
  publishSnapshot();
}

class ServerCallbacks final : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    connectionEvent = 1;
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    connectionEvent = -1;
    NimBLEDevice::startAdvertising();
  }
};

class SnapshotCallbacks final : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    const std::string value = characteristic->getValue();
    if (!snapshotQueue || value.empty() || value.length() > nexora::kMaxSnapshotBytes) return;
    PendingPayload pending;
    pending.length = value.length();
    memcpy(pending.bytes, value.data(), pending.length);
    pending.bytes[pending.length] = '\0';
    xQueueSend(snapshotQueue, &pending, 0);
  }
};

void handleBluetoothEvents() {
  const int8_t event = connectionEvent;
  if (event != 0) {
    connectionEvent = 0;
    snapshot.connected = event > 0;
    if (snapshot.connected) touchActivity();
    renderRequested = true;
    publishSnapshot();
  }
  PendingPayload pending;
  while (snapshotQueue && xQueueReceive(snapshotQueue, &pending, 0) == pdTRUE) {
    if (!applyPayload(String(pending.bytes, pending.length))) Serial.println("BLE snapshot rejected");
  }
}

void startBluetooth() {
  NimBLEDevice::init(nexora::kBleDeviceName);
  NimBLEDevice::setSecurityAuth(true, false, true);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* service = server->createService(nexora::kServiceUuid);
  snapshotCharacteristic = service->createCharacteristic(
    nexora::kSnapshotUuid,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY |
      NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::WRITE_ENC);
  snapshotCharacteristic->setCallbacks(new SnapshotCallbacks());
  snapshotCharacteristic->setValue(serializeSnapshot().c_str());
  server->start();
  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(nexora::kServiceUuid);
  advertising->enableScanResponse(true);
  advertising->setName(nexora::kBleDeviceName);
  advertising->start();
}

void handleSerial() {
  static String line;
  while (Serial.available()) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\n') {
      line.trim();
      if (!line.isEmpty()) {
        const bool accepted = applyPayload(line);
        Serial.println(accepted ? serializeSnapshot() : "Snapshot rejected");
      }
      line = "";
    } else if (value != '\r' && line.length() < nexora::kMaxSnapshotBytes) {
      line += value;
    }
  }
}

bool needsAnimation(DisplayState state) {
  return state == DisplayState::Listening || state == DisplayState::Thinking ||
    state == DisplayState::Speaking || state == DisplayState::Charging;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(nexora::kBacklightPin, OUTPUT);
  setBacklight(true);
  analogReadResolution(12);
  analogSetPinAttenuation(nexora::kBatteryAdcPin, ADC_11db);
  pinMode(nexora::kAmplifierShutdownPin, OUTPUT);
  digitalWrite(nexora::kAmplifierShutdownPin, LOW);
  pinMode(nexora::kHapticDrivePinA, OUTPUT);
  digitalWrite(nexora::kHapticDrivePinA, LOW);
  pinMode(nexora::kMicMuteSensePin, INPUT_PULLUP);
  Wire.begin(nexora::kImuSdaPin, nexora::kImuSclPin);

  display.init();
  display.setRotation(0);
  display.setSwapBytes(false);
  colorBackground = display.color565(239, 243, 242);
  colorInk = display.color565(21, 29, 34);
  colorMuted = display.color565(139, 151, 154);
  colorCyan = display.color565(30, 190, 205);
  colorCoral = display.color565(232, 102, 116);
  colorDanger = display.color565(217, 55, 70);

  loadProfile();
  sampleBattery(true);
  filesystemReady = LittleFS.begin(false);
  renderBoot();
  snapshotQueue = xQueueCreate(4, sizeof(PendingPayload));
  startBluetooth();
  lastInteractionAt = millis();
  Serial.println("NEXORA NC-01 ready. Send one compact JSON snapshot per line.");
  Serial.println("EVT diagnostics: microphone, speaker, haptic, imu, mute.");
}

void loop() {
  handleBluetoothEvents();
  handleSerial();
  saveProfileIfDue();
  sampleBattery();

  const uint32_t now = millis();
  if (snapshot.state == DisplayState::Boot && now >= nexora::kBootDurationMs) requestState(DisplayState::Idle);
  if (snapshot.state != DisplayState::Sleep && snapshot.state != DisplayState::Boot &&
      now - lastInteractionAt >= nexora::kSleepAfterMs) {
    snapshot.state = DisplayState::Sleep;
    renderRequested = true;
  }
  if (needsAnimation(snapshot.state) && now - lastAnimationAt >= nexora::kAnimationFrameMs) {
    lastAnimationAt = now;
    animationFrame += 1;
    renderRequested = true;
  }
  if (renderRequested) renderDisplay();
  delay(5);
}
