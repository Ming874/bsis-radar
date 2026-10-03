/*!
 * @file   RadarApp.h
 * @brief  【應用層】把各層模組組裝起來，並負責主迴圈排程與指令處理。
 *
 * 每次 loop 的資料流：
 *   C4001Radar（收資料）→ ThreatTracker（判斷）→ Telemetry（格式化）→ BleLink（送手機）
 *   BleLink / 序列埠（收指令）→ CommandParser（解析驗證）→ SettingsStore（存 NVS）
 */
#pragma once
#include <Arduino.h>

#include "../comm/BleLink.h"
#include "../core/DetectionConfig.h"
#include "../core/ThreatTracker.h"
#include "../drivers/C4001Radar.h"
#include "../drivers/StatusLed.h"
#include "../storage/SettingsStore.h"

class RadarApp {
 public:
  struct Wiring {
    HardwareSerial&     radarPort;
    Stream&             console;  // USB 序列埠：除錯輸出 + 接收指令
    C4001Radar::Settings radar;
    BleLink::Config     ble;
    int8_t              ledPin;
    uint32_t            telemetryPeriodMs;
    uint32_t            debugPeriodMs;
    const char*         firmwareVersion;
    bool                allowBleConfig;  // false：藍牙只能讀設定，修改要用 USB
  };

  explicit RadarApp(const Wiring& wiring);

  void begin();
  void loop();

 private:
  enum class Channel : uint8_t { Usb, Ble };

  void       pumpRadar(uint32_t nowMs);
  void       pumpCommands();
  void       pollUsbSerial();
  void       handleCommand(const char* text, Channel from);
  void       reply(Channel to, const char* line);
  void       sendConfig(Channel to);
  void       broadcastConfig();
  void       publishTelemetry(uint32_t nowMs, bool urgent);
  void       printDebug(uint32_t nowMs);
  LedPattern ledPattern() const;

  Stream&         console_;
  C4001Radar      radar_;
  ThreatTracker   tracker_;
  BleLink         ble_;
  BleLink::Config bleConfig_;
  StatusLed       led_;
  SettingsStore   store_;
  DetectionConfig config_;

  const uint32_t    telemetryPeriodMs_;
  const uint32_t    debugPeriodMs_;
  const char* const firmwareVersion_;
  const bool        allowBleConfig_;

  RadarMeasurement lastRaw_;
  bool             hasRaw_          = false;
  uint32_t         lastRawMs_       = 0;
  uint32_t         lastTelemetryMs_ = 0;
  uint32_t         lastDebugMs_     = 0;
  char             usbLine_[BleLink::kMaxCommandLen + 1] = {};
  size_t           usbLen_          = 0;
};
