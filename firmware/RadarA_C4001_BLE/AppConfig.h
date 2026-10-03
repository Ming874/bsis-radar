/*!
 * @file   AppConfig.h
 * @brief  【應用層】編譯期設定：腳位、雷達設定、藍牙、輸出週期。
 *
 * 執行中可調整的偵測參數（測試模式、速度/能量門檻、警示距離）不在這裡，
 * 它們存在 NVS，用網頁「校正」頁或序列埠指令修改，見 src/core/DetectionConfig.h。
 * 演算法細部參數（確認筆數、危險 TTC…）見 src/core/ThreatTracker.h 的 tuning。
 */
#pragma once
#include <stdint.h>

#define FW_VERSION "2.0.0"

namespace app {

// ---------- 硬體接線 ----------
// C4001 VIN → 擴充板 V、GND → G、TX → GPIO16、RX → GPIO17、OUT 不接
constexpr int8_t   kPinRadarRx   = 16;      // ESP32 接收腳（接雷達 TX）
constexpr int8_t   kPinRadarTx   = 17;      // ESP32 傳送腳（接雷達 RX）
constexpr int8_t   kPinStatusLed = 2;       // 板載藍色 LED
constexpr uint32_t kRadarBaud    = 9600;    // C4001 固定 9600
constexpr uint32_t kUsbBaud      = 115200;  // 序列埠監控視窗鮑率

// ---------- 寫進 C4001 的偵測設定 ----------
constexpr float    kRadarMinRangeM  = 0.3f;   // 最近偵測距離
constexpr float    kRadarMaxRangeM  = 20.0f;  // 最遠偵測距離：比警示距離多 5 m，來車進 15 m 前就先確認
constexpr uint16_t kRadarThrFactor  = 30;     // 雷達內部偵測門檻（越大越不靈敏，小東西越不會被抓到）

// ---------- 藍牙（Nordic UART Service，一般藍牙序列 App 都認得） ----------
constexpr const char* kBleName        = "RadarA-ESP32";
constexpr const char* kNusServiceUuid = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr const char* kNusRxUuid      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";  // 手機 → ESP32（指令）
constexpr const char* kNusTxUuid      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";  // ESP32 → 手機（Notify）
constexpr uint16_t    kBleMtu         = 247;
// true：手機可以用藍牙修改偵測參數（校正期間方便）。
// 藍牙沒有加密，附近任何人都能連上改設定；正式上路建議改成 false，只能用 USB 序列埠修改。
constexpr bool        kAllowBleConfig = true;

// ---------- 週期 ----------
constexpr uint32_t kTelemetryPeriodMs = 200;  // 遙測送出週期；警示等級改變時會立刻送
constexpr uint32_t kDebugPeriodMs     = 200;  // 序列埠除錯輸出週期

}  // namespace app
