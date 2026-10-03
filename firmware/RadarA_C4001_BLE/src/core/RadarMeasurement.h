/*!
 * @file   RadarMeasurement.h
 * @brief  【核心層】雷達的一筆量測資料。
 *
 * 由驅動層（C4001Radar）填入、交給演算法層（ThreatTracker）使用。
 * 型別定義在核心層，驅動層依賴它，核心層不依賴任何硬體。
 */
#pragma once
#include <stdint.h>

// C4001 一次只回報「最強的一個目標」，沒有角度
struct RadarMeasurement {
  uint8_t  targets  = 0;     // 0 = 沒目標，1 = 有目標
  float    rangeM   = 0.0f;  // 距離（m）
  float    speedMps = 0.0f;  // 徑向速度（m/s），正負號依雷達原始定義
  uint32_t energy   = 0;     // 反射能量：物體越大、越近越強（汽機車 >> 人）
};
