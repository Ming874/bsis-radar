/*!
 * @file   AppConfig.h
 * @brief  【應用層】編譯期設定：腳位、藍牙、輸出週期。
 *
 * 執行中可調整的參數（安裝角度、高度、朝向、速度模型、校正係數、訊噪比門檻、輪周長、後方來車警示）不在這裡，
 * 它們存在 NVS，用網頁或序列埠指令修改，見 src/core/SpeedConfig.h。
 * 演算法內部參數（距離窗口、卡爾曼濾波、狀態機）見 src/core/GroundSpeedEstimator.h。
 */
#pragma once
#include <stdint.h>

#define FW_VERSION "4.0.0"

namespace app {

// ---------- 硬體接線 ----------
// 兩顆雷達都是 HLK-LD2451（24 GHz FMCW，UART 3.3 V、鮑率自動偵測，原廠 115200），VIN 一定要接 5 V（供電能力 > 300 mA）。
// 測速雷達（斜照路面，取代 3.x 的 C4001，沿用同兩支腳）：VIN → 擴充板 5V、GND → G、TX → GPIO16、RX → GPIO17。
// RX 沒接也能用（只接收），但雷達會照它自己存的設定輸出，強烈建議接上（docs/GETTING_STARTED.md §3）
constexpr int8_t   kPinRadarRx   = 16;  // ESP32 接收腳（接測速 LD2451 TX）
constexpr int8_t   kPinRadarTx   = 17;  // ESP32 傳送腳（接測速 LD2451 RX）
constexpr int8_t   kPinStatusLed = 2;   // 板載藍色 LED
// 輪速感測器（選用，只當參考值：校正與驗證雷達用）。3144 霍爾開關 VCC → V、GND → G、OUT → GPIO27；
// 或磁簧開關兩端接 GPIO27 與 G。-1 = 不使用。沒接時腳位由內建上拉維持高電位，不會有假脈衝
constexpr int8_t   kPinWheelSensor = 27;
// 後方來車雷達（選用）：VIN → 擴充板 5V、GND → G、TX → GPIO25、RX → GPIO26。
// RX 沒接也能用（只接收，用雷達目前存的設定）；接了 ESP32 才能寫入偵測設定。-1 = 沒有後方雷達
constexpr int8_t   kPinRearRx = 25;  // ESP32 接收腳（接後方 LD2451 TX）
constexpr int8_t   kPinRearTx = 26;  // ESP32 傳送腳（接後方 LD2451 RX）
constexpr uint32_t kUsbBaud   = 115200;  // 序列埠監看鮑率

// ---------- 藍牙（Nordic UART Service，一般藍牙序列 App 都認得） ----------
constexpr const char* kBleName        = "BSIS-Speed";
constexpr const char* kNusServiceUuid = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr const char* kNusRxUuid      = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";  // 手機 → ESP32（指令）
constexpr const char* kNusTxUuid      = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";  // ESP32 → 手機（Notify）
constexpr uint16_t    kBleMtu         = 247;
// true：手機可以用藍牙修改參數（安裝、校正期間方便）。
// 藍牙沒有加密，附近任何人都能連上改設定；校正完成後建議改成 false，只能用 USB 序列埠修改。
constexpr bool        kAllowBleConfig = true;

// ---------- 週期 ----------
// 遙測跟著雷達資料框送（約 10 Hz）；雷達沒有資料時每 250 ms 送一行心跳
constexpr uint32_t kHeartbeatMs = 250;

}  // namespace app
