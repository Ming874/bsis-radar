#include "StatusLed.h"

void StatusLed::begin() {
  pinMode(pin_, OUTPUT);
  digitalWrite(pin_, LOW);
  on_ = false;
}

void StatusLed::update(uint32_t nowMs, LedPattern pattern) {
  bool on = false;
  switch (pattern) {
    case LedPattern::Solid:     on = true; break;
    case LedPattern::FastBlink: on = (nowMs / 150) % 2; break;
    case LedPattern::SlowBlink: on = (nowMs / 500) % 2; break;
    case LedPattern::DoubleBlink: {
      const uint32_t t = nowMs % 1000;  // 亮 100 → 暗 100 → 亮 100 → 暗 700
      on = t < 100 || (t >= 200 && t < 300);
      break;
    }
  }
  if (on != on_) {  // 狀態有變才寫腳位
    on_ = on;
    digitalWrite(pin_, on ? HIGH : LOW);
  }
}
