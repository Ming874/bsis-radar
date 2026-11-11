#include "RearThreat.h"

#include <math.h>

using namespace rear_tuning;

void RearThreat::reset() {
  const uint32_t alerts = state_.alerts;
  state_        = RearState();
  state_.alerts = alerts;
  evidence_     = 0;
  confirmed_    = false;
  cautionSeen_  = false;
  dangerSeen_   = false;
  dropTrack();
}

bool RearThreat::consumeLevelChange() {
  if (state_.level == reported_) return false;
  reported_ = state_.level;
  return true;
}

void RearThreat::onFrame(const RearFrame& frame, uint32_t nowMs, const RearConfig& cfg) {
  // 1～2. 候選中到達時間最短的（接近速度太小的用距離比）
  const RearTarget* lead = nullptr;
  float bestTtc = INFINITY, bestRange = INFINITY;
  const uint8_t n = frame.count < kRearMaxTargets ? frame.count : kRearMaxTargets;
  for (uint8_t i = 0; i < n; i++) {
    const RearTarget& t = frame.targets[i];
    if (!t.approaching() || t.speedKmh < cfg.minSpeedKmh || t.distanceM > cfg.detectRangeM()) continue;
    const float range = t.distanceM > 0 ? static_cast<float>(t.distanceM) : 0.5f;  // 0 = 不到 1 m
    const float v     = t.speedKmh / 3.6f;
    const float ttc   = v >= kMinTtcSpeedMps ? range / v : INFINITY;
    if (ttc < bestTtc || (ttc == bestTtc && range < bestRange)) {
      lead      = &t;
      bestTtc   = ttc;
      bestRange = range;
    }
  }

  if (lead == nullptr) {
    // 3. 沒有候選：扣分；扣到 0 就放棄追蹤
    if (evidence_ > 0) evidence_--;
    if (evidence_ == 0) {
      confirmed_ = false;
      dropTrack();
    }
    evaluate(nowMs, cfg);
    return;
  }

  if (evidence_ < kEvidenceMax) evidence_++;
  if (evidence_ >= kConfirmHits) confirmed_ = true;

  // 4. 關聯與濾波
  const float range = bestRange;
  const float v     = lead->speedKmh / 3.6f;
  if (!active_) {
    startTrack(range, v, nowMs);
  } else {
    float dt = static_cast<float>(nowMs - trackMs_) / 1000.0f;
    if (dt > kMaxDtS) dt = kMaxDtS;
    const float predicted = rangeM_ - closingMps_ * dt;
    const float gate      = kGateBaseM + fabsf(closingMps_) * dt;
    if (fabsf(range - predicted) > gate) {
      // 跳值：彼此一致（像同一台新的車）才累計，連續 kSwitchHits 筆就換追蹤對象；否則相信原本的追蹤
      const float sinceS     = static_cast<float>(nowMs - outlierMs_) / 1000.0f;
      const bool  consistent = outliers_ > 0 && sinceS <= kMaxDtS &&
                              fabsf(range - (outlierRangeM_ - v * sinceS)) <= kGateBaseM;
      outliers_      = consistent ? static_cast<uint8_t>(outliers_ + 1) : 1;
      outlierRangeM_ = range;
      outlierMs_     = nowMs;
      if (outliers_ < kSwitchHits) {
        evaluate(nowMs, cfg);
        return;
      }
      startTrack(range, v, nowMs);  // 換了一台車
    } else {
      outliers_   = 0;
      rangeM_     = predicted + kAlphaRange * (range - predicted);
      closingMps_ = closingMps_ + kAlphaSpeed * (v - closingMps_);
      if (rangeM_ < 0.0f) rangeM_ = 0.0f;
      trackMs_ = nowMs;
    }
  }
  lastLeadMs_ = nowMs;  // 只有關聯上（或換成新的車）才延長追蹤；被擋下的跳值不算
  pushTrend(nowMs, range);
  evaluate(nowMs, cfg);
}

void RearThreat::update(uint32_t nowMs, const RearConfig& cfg) {
  if (active_ && nowMs - lastLeadMs_ > kLeadLostMs) {
    evidence_  = 0;
    confirmed_ = false;
    dropTrack();
  }
  evaluate(nowMs, cfg);
}

void RearThreat::startTrack(float rangeM, float closingMps, uint32_t nowMs) {
  active_     = true;
  rangeM_     = rangeM;
  closingMps_ = closingMps;
  trackMs_    = nowMs;
  trendCount_ = 0;
  receding_   = false;
  voted_      = false;
  outliers_   = 0;
}

void RearThreat::dropTrack() {
  active_     = false;
  outliers_   = 0;
  trendCount_ = 0;
  receding_   = false;
  voted_      = false;
}

// 5. 最近 1.5 秒的距離做最小平方斜率：明確變遠 → 不是來車（方向位元組判斷錯了，或雷達設定沒寫進去）
void RearThreat::pushTrend(uint32_t nowMs, float rangeM) {
  // 丟掉太舊的樣本（陣列依時間排序）
  uint8_t keep = 0;
  for (uint8_t i = 0; i < trendCount_; i++) {
    if (nowMs - trendMs_[i] <= kTrendWindowMs) {
      trendMs_[keep]    = trendMs_[i];
      trendRange_[keep] = trendRange_[i];
      keep++;
    }
  }
  trendCount_ = keep;
  if (trendCount_ == kTrendCap) {  // 滿了就丟最舊的
    for (uint8_t i = 1; i < kTrendCap; i++) {
      trendMs_[i - 1]    = trendMs_[i];
      trendRange_[i - 1] = trendRange_[i];
    }
    trendCount_--;
  }
  trendMs_[trendCount_]    = nowMs;
  trendRange_[trendCount_] = rangeM;
  trendCount_++;

  if (trendCount_ < kTrendMinCount) return;
  const float span = static_cast<float>(nowMs - trendMs_[0]) / 1000.0f;
  if (span < kTrendMinSpanS) return;

  double st = 0, sr = 0;
  for (uint8_t i = 0; i < trendCount_; i++) {
    st += static_cast<double>(trendMs_[i] - trendMs_[0]) / 1000.0;
    sr += trendRange_[i];
  }
  const double mt = st / trendCount_, mr = sr / trendCount_;
  double num = 0, den = 0;
  for (uint8_t i = 0; i < trendCount_; i++) {
    const double dt = static_cast<double>(trendMs_[i] - trendMs_[0]) / 1000.0 - mt;
    num += dt * (trendRange_[i] - mr);
    den += dt * dt;
  }
  if (den <= 0) return;
  const float slope = static_cast<float>(num / den);  // m/s，負 = 越來越近

  if (slope >= kTrendDecisiveMps) {
    receding_ = true;
    if (!voted_) trendDisagree_++, voted_ = true;
  } else if (slope <= -kTrendDecisiveMps) {
    receding_ = false;
    if (!voted_) trendAgree_++, voted_ = true;
  }
}

void RearThreat::evaluate(uint32_t nowMs, const RearConfig& cfg) {
  const RearLevel before = state_.level;

  // 6. 分級
  RearLevel raw   = RearLevel::Safe;
  state_.hasLead  = active_ && confirmed_ && !receding_;
  if (state_.hasLead) {
    const float ttc     = closingMps_ >= kMinTtcSpeedMps ? rangeM_ / closingMps_ : -1.0f;
    state_.distanceM    = rangeM_;
    state_.closingMps   = closingMps_;
    state_.ttcS         = ttc;
    if (rangeM_ <= kDangerDistM || (ttc >= 0.0f && ttc <= cfg.ttcS)) raw = RearLevel::Danger;
    else if (rangeM_ <= cfg.rangeM) raw = RearLevel::Caution;
  } else {
    state_.distanceM  = -1.0f;
    state_.closingMps = 0.0f;
    state_.ttcS       = -1.0f;
  }

  // 7. 保持
  if (raw != RearLevel::Safe) {
    cautionSeen_   = true;
    lastCautionMs_ = nowMs;
  }
  if (raw == RearLevel::Danger) {
    dangerSeen_   = true;
    lastDangerMs_ = nowMs;
  }
  RearLevel level = RearLevel::Safe;
  if (dangerSeen_ && nowMs - lastDangerMs_ <= kHoldMs) level = RearLevel::Danger;
  else if (cautionSeen_ && nowMs - lastCautionMs_ <= kHoldMs) level = RearLevel::Caution;

  state_.level   = level;
  state_.holding = level != RearLevel::Safe && raw == RearLevel::Safe;
  if (before == RearLevel::Safe && level != RearLevel::Safe) state_.alerts++;
}
