/*!
 * @file   StatusLed.h
 * @brief  【驅動層】板載 LED 狀態燈：不用接手機也看得出系統狀態。
 */
#pragma once
#include <Arduino.h>

enum class LedPattern : uint8_t {
  SlowBlink,    // 慢閃（0.5 s）：程式正常，等待手機連線
  FastBlink,    // 快閃（0.15 s）：手機已連線
  DoubleBlink,  // 每秒閃兩下：雷達離線或初始化中
  Solid,        // 恆亮：後方來車警示
};

class StatusLed {
 public:
  explicit StatusLed(int8_t pin) : pin_(pin) {}
  void begin();
  void update(uint32_t nowMs, LedPattern pattern);

 private:
  int8_t pin_;
  bool   on_ = false;
};
