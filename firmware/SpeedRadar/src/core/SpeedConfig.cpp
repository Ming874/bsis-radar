#include "SpeedConfig.h"

SpeedConfig SpeedConfig::defaults() {
  SpeedConfig c;
  // LD2451 的距離解析度是 1 m：俯角太大時路面離雷達不到 1 m，可能在雷達的近距離盲區內，
  // 所以預設比 C4001 時期（45°）淺；30° 時誤差 1° ≈ 速度誤差 1%（docs/ALGORITHM.md §4）
  c.angleDeg    = 30.0f;
  c.heightM     = 0.70f;  // 後貨架尾端的典型高度；請實際量測
  c.direction   = 1;      // 雷達朝後、斜向下照地面
  c.model       = SpeedModel::FixedAngle;
  c.calibration = 1.0f;   // 未校正（docs/GETTING_STARTED.md §9）
  c.radarSnr    = 4;      // LD2451 原廠預設
  c.wheelMm     = 2105;   // 700×25C
  c.rear        = RearConfig::defaults();
  return c;
}

RearConfig RearConfig::defaults() {
  RearConfig r;
  r.rangeM      = 15;    // 需求：後方 15 m 內有來車接近就警示
  r.minSpeedKmh = 5;     // 低於步行速度的接近不算來車（跟車、等紅燈時車子慢慢靠近）
  r.ttcS        = 2.5f;  // 騎士反應約 1～1.5 s 再加餘裕；汽車前方碰撞警示多在 2～2.4 s（docs/REAR_RADAR.md §5）
  r.snr         = 4;     // LD2451 原廠預設
  return r;
}

uint8_t RearConfig::detectRangeM() const {
  const unsigned d = static_cast<unsigned>(rangeM) + limits::kRearDetectMarginM;
  if (d < limits::kRearDetectLoM) return limits::kRearDetectLoM;
  if (d > limits::kRearDetectHiM) return limits::kRearDetectHiM;
  return static_cast<uint8_t>(d);
}

bool RearConfig::isValid() const {
  if (rangeM < limits::kRangeLoM || rangeM > limits::kRangeHiM) return false;
  if (minSpeedKmh < limits::kRearSpdLo || minSpeedKmh > limits::kRearSpdHi) return false;
  if (!(ttcS >= limits::kTtcLoS && ttcS <= limits::kTtcHiS)) return false;
  if (snr < limits::kRearSnrLo || snr > limits::kRearSnrHi) return false;
  return true;
}

bool SpeedConfig::isValid() const { return speedFieldsValid() && rear.isValid(); }

bool SpeedConfig::speedFieldsValid() const {
  // 用「不在範圍內就失敗」的寫法，NaN 也會被擋下
  if (!(angleDeg >= limits::kAngleLoDeg && angleDeg <= limits::kAngleHiDeg)) return false;
  if (!(heightM >= limits::kHeightLoM && heightM <= limits::kHeightHiM)) return false;
  if (direction != 1 && direction != -1) return false;
  if (model != SpeedModel::FixedAngle && model != SpeedModel::RangeGeometry) return false;
  if (!(calibration >= limits::kCalLo && calibration <= limits::kCalHi)) return false;
  if (radarSnr < limits::kSnrLo || radarSnr > limits::kSnrHi) return false;
  if (wheelMm < limits::kWheelMmLo || wheelMm > limits::kWheelMmHi) return false;
  return true;
}
