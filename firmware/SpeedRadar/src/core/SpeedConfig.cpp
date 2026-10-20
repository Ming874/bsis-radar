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
  return c;
}

bool SpeedConfig::isValid() const {
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
