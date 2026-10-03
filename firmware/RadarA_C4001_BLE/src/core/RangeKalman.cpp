#include "RangeKalman.h"

#include <math.h>

void RangeKalman::init(float rangeM, float rateMps, float varRange, float varRate) {
  r_      = rangeM;
  v_      = rateMps;
  p00_    = varRange;
  p01_    = 0.0f;
  p11_    = varRate;
  active_ = true;
}

// x ← F x，P ← F P Fᵀ + Q
// F = [1 dt; 0 1]，Q = σa² [dt⁴/4 dt³/2; dt³/2 dt²]（DWNA）
void RangeKalman::predict(float dtS, float accelVar) {
  if (!active_ || dtS <= 0.0f) return;
  const float dt2 = dtS * dtS;
  r_ += v_ * dtS;
  p00_ += 2.0f * dtS * p01_ + dt2 * p11_ + accelVar * dt2 * dt2 * 0.25f;
  p01_ += dtS * p11_ + accelVar * dt2 * dtS * 0.5f;
  p11_ += accelVar * dt2;
}

float RangeKalman::rangeNis(float rangeM, float varRange) const {
  const float nu = rangeM - r_;
  return nu * nu / (p00_ + varRange);
}

float RangeKalman::rateNis(float rateMps, float varRate) const {
  const float nu = rateMps - v_;
  return nu * nu / (p11_ + varRate);
}

float RangeKalman::rangeInnovationSigma(float varRange) const { return sqrtf(p00_ + varRange); }

// 量測 r（H = [1 0]）：K = P Hᵀ / S，S = P₀₀ + R
void RangeKalman::updateRange(float rangeM, float varRange) {
  const float s  = p00_ + varRange;
  const float k0 = p00_ / s;
  const float k1 = p01_ / s;
  const float nu = rangeM - r_;
  r_ += k0 * nu;
  v_ += k1 * nu;
  const float p00 = p00_, p01 = p01_;
  p00_ = p00 - k0 * p00;
  p01_ = p01 - k0 * p01;
  p11_ = p11_ - k1 * p01;
  keepValid();
}

// 量測 ṙ（H = [0 1]）：S = P₁₁ + R
void RangeKalman::updateRate(float rateMps, float varRate) {
  const float s  = p11_ + varRate;
  const float k0 = p01_ / s;
  const float k1 = p11_ / s;
  const float nu = rateMps - v_;
  r_ += k0 * nu;
  v_ += k1 * nu;
  const float p01 = p01_, p11 = p11_;
  p00_ = p00_ - k0 * p01;
  p01_ = p01 - k0 * p11;
  p11_ = p11 - k1 * p11;
  keepValid();
}

void RangeKalman::resetRate(float rateMps, float varRate) {
  v_   = rateMps;
  p01_ = 0.0f;
  p11_ = varRate;
}

void RangeKalman::resetState(float rangeM, float rateMps, float varRange, float covRangeRate, float varRate) {
  r_   = rangeM;
  v_   = rateMps;
  p00_ = varRange;
  p01_ = covRangeRate;
  p11_ = varRate;
  keepValid();
}

// 浮點誤差保護：變異數不可為負、相關係數不可超過 1
void RangeKalman::keepValid() {
  const float kMinVar = 1e-6f;
  if (p00_ < kMinVar) p00_ = kMinVar;
  if (p11_ < kMinVar) p11_ = kMinVar;
  const float limit = sqrtf(p00_ * p11_);
  if (fabsf(p01_) > limit) p01_ = (p01_ > 0.0f ? 0.999f : -0.999f) * limit;  // 夾回 |ρ| < 1
}
