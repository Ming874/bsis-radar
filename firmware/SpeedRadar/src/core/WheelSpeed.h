/*!
 * @file   WheelSpeed.h
 * @brief  【核心層】輪速感測器：由霍爾感測器脈衝算出車速與里程，作為雷達測速的參考值（純邏輯，可單元測試）。
 *
 * 雷達才是主要的測速來源；輪速只用來校正（距離比）與驗證（docs/ALGORITHM.md §7、§8）。
 * 輻條上一顆磁鐵、車架上一個霍爾感測器（或磁簧開關）：輪子每轉一圈產生一個脈衝。
 *   車速 = 輪周長 ÷ 兩次脈衝的間隔（取最近兩個間隔的平均，比較穩）
 * 減速時下一個脈衝還沒來，就用「距離上一個脈衝已經過了多久」當間隔的下限，車速會平順地往下掉；
 * 超過 kStopMs 沒有脈衝就當作停止。和一般腳踏車碼表的算法相同。
 */
#pragma once
#include <stdint.h>

namespace wheel_tuning {
constexpr uint32_t kMinPeriodMs = 40;    // 間隔比這個短的脈衝當雜訊（周長 2.1 m 時相當於 190 km/h）
constexpr uint32_t kStopMs      = 3000;  // 超過這麼久沒有脈衝 → 0 km/h（周長 2.1 m 時約 2.5 km/h 以下）
}  // namespace wheel_tuning

class WheelSpeed {
 public:
  void reset();

  // 磁鐵經過感測器一次。回傳是否採用（間隔太短的當雜訊丟掉）
  bool onPulse(uint32_t tMs);

  // 開機後有沒有收過脈衝：沒接感測器時就不回報車速，網頁也不會顯示一個假的 0 km/h
  bool seen() const { return pulses_ > 0; }

  // 目前車速（m/s）；circumferenceMm = 輪周長（mm）
  float speedMps(uint32_t nowMs, uint16_t circumferenceMm) const;

  // 第一個脈衝之後轉了幾圈；里程 = 圈數 × 輪周長
  uint32_t revolutions() const { return pulses_ > 0 ? pulses_ - 1 : 0; }

 private:
  uint32_t pulses_     = 0;
  uint32_t lastMs_     = 0;
  uint32_t periods_[2] = {0, 0};  // 最近兩個間隔（ms），[0] 是最新的
  uint8_t  nPeriods_   = 0;
};
