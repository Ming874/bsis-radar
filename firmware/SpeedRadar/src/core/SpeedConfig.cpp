#include "SpeedConfig.h"

SpeedConfig SpeedConfig::defaults() {
  SpeedConfig c;
  c.angleDeg       = 45.0f;  // 文獻常用 35～45°；45° 時角度誤差 1° ≈ 速度誤差 1.75%（docs/ALGORITHM.md §3.3、§4）
  c.heightM        = 0.70f;  // 後貨架尾端的典型高度；請實際量測
  c.direction      = 1;      // 雷達朝後、斜向下照地面
  c.model          = SpeedModel::FixedAngle;
  c.calibration    = 1.0f;   // 未校正；校正後通常約 1.1～1.4（寬波束的路面回波偏向正下方，讀值偏低，docs/ALGORITHM.md §3.2）
  c.radarThreshold = 5;      // C4001 原廠預設
  c.wheelMm        = 2105;   // 700×25C
  // 規格表寫 0.1～3 m/s、資料框說明寫 0～10 m/s；兩筆獨立觀察都停在約 3.2～3.28 m/s，
  // 而且與 64 chirp × 0.95 ms 的 FFT 上限一致（docs/ALGORITHM.md §2）。先假設 3.28 並還原折疊；
  // 一旦量到明顯更大的值，韌體會自動調高（SpeedRadarApp::raiseRadialLimit）
  c.radialLimitMps = 3.28f;
  c.rear           = RearConfig::defaults();
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
  if (radarThreshold < limits::kRadarThrLo || radarThreshold > limits::kRadarThrHi) return false;
  if (wheelMm < limits::kWheelMmLo || wheelMm > limits::kWheelMmHi) return false;
  if (!(radialLimitMps >= limits::kVmaxLo && radialLimitMps <= limits::kVmaxHi)) return false;
  return true;
}
