/*!
 * @file   DetectionConfig.h
 * @brief  【核心層】執行期可調整的偵測參數。
 *
 * 可由網頁或序列埠指令修改，並由儲存層存進 NVS（斷電不消失）。
 * 純邏輯，不依賴 Arduino，可在電腦上做單元測試。
 */
#pragma once
#include <stdint.h>

namespace limits {
constexpr float    kTestMinSpeedMps = 0.10f;        // 測試模式的接近速度門檻：人慢慢走近也會觸發
constexpr float    kMinSpeedLo      = 0.05f;        // MINSPD（m/s）
constexpr float    kMinSpeedHi      = 10.0f;        // C4001 測速上限 10 m/s
constexpr uint32_t kMinEnergyHi     = 100000000UL;  // MINE
constexpr float    kWarnRangeLo     = 1.0f;         // RANGE（m）
constexpr float    kWarnRangeHi     = 20.0f;        // 不可超過雷達設定的最遠偵測距離
constexpr float    kDangerTtcLo     = 0.5f;         // DTTC（s）
constexpr float    kDangerTtcHi     = 5.0f;
constexpr float    kDangerDistLo    = 1.0f;         // DDIST（m）
constexpr float    kDangerDistHi    = 10.0f;
constexpr uint16_t kHoldLo          = 200;          // HOLD（ms）
constexpr uint16_t kHoldHi          = 5000;
constexpr uint8_t  kConfirmLo       = 1;            // CONFIRM（筆）
constexpr uint8_t  kConfirmHi       = 6;
}  // namespace limits

struct DetectionConfig {
  bool     testMode;      // TEST    ：室內測試模式（接近速度門檻改用 kTestMinSpeedMps）
  float    minSpeedMps;   // MINSPD  ：上路模式，接近速度至少要多快才算來車（m/s）
  uint32_t minEnergy;     // MINE    ：反射能量門檻，0 = 不過濾（校正後再填）
  float    warnRangeM;    // RANGE   ：目標進入此距離內才警示（m）
  int8_t   approachSign;  // SIGN    ：-1 = 雷達速度為負代表接近；+1 相反；0 不判斷方向
  float    dangerTtcS;    // DTTC    ：到達時間 ≤ 此值 → 危險（s）
  float    dangerDistM;   // DDIST   ：距離 ≤ 此值 → 危險（m）
  uint16_t holdMs;        // HOLD    ：目標消失後警示再保持多久（ms）
  uint8_t  confirmHits;   // CONFIRM ：累積幾筆合格資料才確認是來車

  // 目前實際使用的接近速度門檻
  float effectiveMinSpeed() const { return testMode ? limits::kTestMinSpeedMps : minSpeedMps; }

  // 所有欄位都在允許範圍內才回傳 true（從 NVS 讀回時用來擋掉壞資料）
  bool isValid() const;

  static DetectionConfig defaults();
};
