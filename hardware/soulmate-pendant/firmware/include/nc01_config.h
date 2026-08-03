#pragma once

#include <Arduino.h>

namespace nexora {

constexpr uint16_t kScreenWidth = 240;
constexpr uint16_t kScreenHeight = 240;

constexpr uint8_t kDisplayDcPin = 8;
constexpr uint8_t kDisplayCsPin = 9;
constexpr uint8_t kDisplayClockPin = 10;
constexpr uint8_t kDisplayMosiPin = 11;
constexpr uint8_t kDisplayResetPin = 12;
constexpr uint8_t kBacklightPin = 40;

constexpr uint8_t kImuSdaPin = 6;
constexpr uint8_t kImuSclPin = 7;
constexpr uint8_t kImuInterrupt1Pin = 47;
constexpr uint8_t kImuInterrupt2Pin = 48;
constexpr uint8_t kBatteryAdcPin = 1;

// EVT-A expansion pins. Audio, mute, light, and haptic drivers remain disabled until bench hardware is attached.
constexpr uint8_t kAudioBitClockPin = 13;
constexpr uint8_t kAudioWordSelectPin = 14;
constexpr uint8_t kMicrophoneDataPin = 15;
constexpr uint8_t kSpeakerDataPin = 16;
constexpr uint8_t kAmplifierShutdownPin = 17;
constexpr uint8_t kStatusLightDataPin = 18;
constexpr uint8_t kMicMuteSensePin = 39;
constexpr uint8_t kHapticDrivePinA = 4;
constexpr uint8_t kHapticDrivePinB = 5;

constexpr char kBleDeviceName[] = "NEXORA NC-01";
constexpr char kServiceUuid[] = "c8a10000-5101-4e58-9a18-8f352dc80101";
constexpr char kSnapshotUuid[] = "c8a10001-5101-4e58-9a18-8f352dc80101";

constexpr uint32_t kBootDurationMs = 1600;
constexpr uint32_t kSleepAfterMs = 120000;
constexpr uint32_t kAnimationFrameMs = 180;
constexpr uint32_t kBatterySampleMs = 30000;
constexpr size_t kMaxSnapshotBytes = 384;

}  // namespace nexora
