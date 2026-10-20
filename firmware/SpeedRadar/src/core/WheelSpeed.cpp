#include "WheelSpeed.h"

using namespace wheel_tuning;

void WheelSpeed::reset() {
  pulses_   = 0;
  lastMs_   = 0;
  nPeriods_ = 0;
}

bool WheelSpeed::onPulse(uint32_t tMs) {
  if (pulses_ > 0) {
    const uint32_t period = tMs - lastMs_;
    if (period < kMinPeriodMs) return false;
    if (period > kStopMs) {
      nPeriods_ = 0;  // 停過車：這個間隔包含停車時間，不能拿來算速度
    } else {
      periods_[1] = periods_[0];
      periods_[0] = period;
      if (nPeriods_ < 2) nPeriods_++;
    }
  }
  lastMs_ = tMs;
  pulses_++;
  return true;
}

float WheelSpeed::speedMps(uint32_t nowMs, uint16_t circumferenceMm) const {
  if (nPeriods_ == 0) return 0.0f;
  const uint32_t sinceLast = nowMs - lastMs_;
  if (sinceLast > kStopMs) return 0.0f;

  float periodMs = nPeriods_ == 2 ? (periods_[0] + periods_[1]) / 2.0f : static_cast<float>(periods_[0]);
  if (sinceLast > periodMs) periodMs = static_cast<float>(sinceLast);  // 減速中：下一圈還沒到
  return static_cast<float>(circumferenceMm) / periodMs;  // mm/ms = m/s
}
