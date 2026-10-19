#include "WheelSensor.h"

namespace {

// 中斷（寫入）與主迴圈（讀出）之間的環狀佇列：各自只改自己的索引，不需要上鎖
constexpr uint8_t  kRing = 8;
volatile uint32_t  gTimes[kRing];
volatile uint8_t   gHead = 0;  // 中斷寫入的位置
volatile uint8_t   gTail = 0;  // 主迴圈讀取的位置

void IRAM_ATTR onWheelEdge() {
  const uint8_t next = static_cast<uint8_t>((gHead + 1) % kRing);
  if (next == gTail) return;  // 滿了（主迴圈每毫秒都會讀，正常不會發生）就丟掉
  gTimes[gHead] = millis();
  gHead         = next;
}

}  // namespace

void WheelSensor::begin() {
  if (pin_ < 0) return;
  pinMode(pin_, INPUT_PULLUP);  // 沒接感測器時維持高電位，不會產生假脈衝
  attachInterrupt(digitalPinToInterrupt(pin_), onWheelEdge, FALLING);
}

bool WheelSensor::popPulse(uint32_t& tMs) {
  if (gTail == gHead) return false;
  tMs   = gTimes[gTail];
  gTail = static_cast<uint8_t>((gTail + 1) % kRing);
  return true;
}
