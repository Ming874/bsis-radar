/*!
 * @file   WheelSensor.h
 * @brief  【驅動層】輪速感測器（霍爾開關或磁簧開關）：用中斷記下磁鐵經過的時間。
 *
 * 接線（3144 數位霍爾開關，正面＝有字的那面朝磁鐵）：
 *   第 1 腳 VCC → 擴充板 V（5 V）   第 2 腳 GND → G   第 3 腳 OUT → AppConfig 的 kPinWheelSensor
 * 3144 的輸出是開集極（只會往下拉、不會輸出 5 V），配合 ESP32 內建的上拉電阻（3.3 V），不用另外接電阻，
 * 也不會把 5 V 送進 ESP32。磁簧開關則一端接 GPIO、一端接 G 即可。
 * 磁鐵靠近時輸出變成低電位 → 下降緣觸發中斷。中斷裡只記時間，車速在主迴圈算（core/WheelSpeed）。
 */
#pragma once
#include <Arduino.h>

class WheelSensor {
 public:
  explicit WheelSensor(int8_t pin) : pin_(pin) {}

  void begin();  // pin < 0 時不啟用

  // 取出中斷記下的一個脈衝時間（millis），沒有就回傳 false
  bool popPulse(uint32_t& tMs);

 private:
  int8_t pin_;
};
