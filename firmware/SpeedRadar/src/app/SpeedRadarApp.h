/*!
 * @file   SpeedRadarApp.h
 * @brief  【應用層】把各層模組組裝起來，並負責主迴圈排程與指令處理。
 *
 * 每次 loop 的資料流：
 *   LD2451Radar 測速（資料框）→ GroundSpeedEstimator（對地速度、里程）→ Telemetry（格式化）→ BleLink / USB
 *   LD2451Radar 後方（資料框）→ RearThreat（來車警示）→ Telemetry 的 REAR 行 → BleLink / USB
 *   WheelSensor（輪速脈衝）→ WheelSpeed（參考速度、里程）→ Telemetry 的 W / DW 欄位
 *   BleLink / USB（指令）→ CommandParser（解析驗證）→ SettingsStore（存 NVS）→ 必要時重新設定雷達
 */
#pragma once
#include <Arduino.h>

#include "../comm/BleLink.h"
#include "../core/GroundSpeedEstimator.h"
#include "../core/RearThreat.h"
#include "../core/SpeedConfig.h"
#include "../core/WheelSpeed.h"
#include "../drivers/LD2451Radar.h"
#include "../drivers/StatusLed.h"
#include "../drivers/WheelSensor.h"
#include "../storage/SettingsStore.h"

class SpeedRadarApp {
 public:
  struct Wiring {
    HardwareSerial&       radarPort;  // 測速雷達 LD2451（斜照路面）
    HardwareSerial&       rearPort;   // 後方來車雷達 LD2451（朝正後方）
    Stream&               console;    // USB 序列埠：輸出與 BLE 相同的遙測 + 接收指令
    LD2451Radar::Settings radar;
    LD2451Radar::Settings rear;
    BleLink::Config      ble;
    int8_t               ledPin;
    int8_t               wheelPin;  // 輪速感測器（霍爾開關），-1 = 不使用
    uint32_t             heartbeatMs;
    const char*          firmwareVersion;
    bool                 allowBleConfig;  // false：藍牙只能讀資料，修改設定要用 USB
  };

  explicit SpeedRadarApp(const Wiring& wiring);

  void begin();
  void loop();

 private:
  enum class Channel : uint8_t { Usb, Ble };

  void       pumpRadar(uint32_t nowMs);
  void       pumpRear(uint32_t nowMs);
  void       pumpCommands();
  void       pollUsbSerial();
  void       handleCommand(const char* text, Channel from);
  void       reply(Channel to, const char* line);
  void       sendConfig(Channel to);
  void       broadcastConfig();
  void       applyRadarDetection(uint32_t nowMs);
  void       applyRearDetection(uint32_t nowMs);
  void       logRearLevel();
  void       publishRear(uint32_t nowMs);
  void       publishTelemetry(uint32_t nowMs);
  LedPattern ledPattern() const;

  Stream&              console_;
  LD2451Radar          radar_;  // 測速雷達
  GroundSpeedEstimator estimator_;
  LD2451Radar          rear_;   // 後方來車雷達
  RearThreat           threat_;
  BleLink              ble_;
  BleLink::Config      bleConfig_;
  StatusLed            led_;
  WheelSensor          wheel_;
  WheelSpeed           wheelSpeed_;
  SettingsStore        store_;
  SpeedConfig          config_;

  const uint32_t    heartbeatMs_;
  const char* const firmwareVersion_;
  const bool        allowBleConfig_;

  RadarFrame       lastRaw_;
  FrameResult      lastResult_;
  bool             hasFrame_       = false;
  uint32_t         lastFrameMs_    = 0;
  uint32_t         lastPublishMs_  = 0;
  bool             radarWasOnline_ = false;

  RadarFrame        lastRearFrame_;
  bool             hasRearFrame_      = false;
  uint32_t         lastRearFrameMs_   = 0;
  uint32_t         rearFrames_        = 0;
  uint32_t         lastRearPublishMs_ = 0;
  bool             rearWasOnline_     = false;
  uint32_t         rearDisagreeSeen_  = 0;
  char             usbLine_[BleLink::kMaxCommandLen + 1] = {};
  size_t           usbLen_         = 0;
};
