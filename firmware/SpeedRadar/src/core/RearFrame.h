/*!
 * @file   RearFrame.h
 * @brief  【核心層】後方來車雷達（HLK-LD2451）一個資料框的內容，與硬體無關。
 *
 * LD2451 每個資料框最多回報 5 個「正在移動」的目標（靜止物體不回報），每個目標：
 *   角度（度，整數；0 = 正後方）、距離（m，整數）、方向（原始位元組）、速度（km/h，整數）、訊噪比。
 * 速度是雷達與目標之間的「相對徑向速度」：雷達裝在行進中的腳踏車上，量到的是接近速度（車速 − 腳踏車速）。
 */
#pragma once
#include <stdint.h>

constexpr uint8_t kRearMaxTargets = 5;

// LD2451 目標的方向位元組：1 = 靠近、0 = 遠離（協定文件的表格與三套開源驅動一致；
// 文件範例寫法相反，實機驗證結果見 docs/REAR_RADAR.md §2）
constexpr uint8_t kRearApproachByte = 1;

struct RearTarget {
  int8_t  angleDeg   = 0;  // 原始位元組 − 0x80
  uint8_t distanceM  = 0;
  uint8_t direction  = 0;  // 原始方向位元組
  uint8_t speedKmh   = 0;  // 速度大小（不含方向）
  uint8_t snr        = 0;

  bool approaching() const { return direction == kRearApproachByte; }
};

struct RearFrame {
  uint8_t    count = 0;
  uint8_t    alarm = 0;  // LD2451 自己的「有目標靠近」旗標（含模組端的延遲保持；只做參考，不參與判斷）
  RearTarget targets[kRearMaxTargets];
};
