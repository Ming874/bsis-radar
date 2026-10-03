#include "ThreatTracker.h"

#include <math.h>

namespace {

// 把雷達的徑向速度換成「接近速度」：正值 = 越來越近
float closingSpeed(float speedMps, int8_t approachSign) {
  if (approachSign == 0) return fabsf(speedMps);  // 不判斷方向：只看速度大小
  return speedMps * static_cast<float>(approachSign);
}

}  // namespace

void ThreatTracker::reset() {
  state_ = ThreatState();
  energyWindow_.clear();
  energyMedian_  = 0;
  closingSmooth_ = 0.0f;
  hasSpeed_      = false;
  dropTrack();
  trackDistM_ = -1.0f;
  lastWarnMs_ = 0;
  // reportedLevel_ 不清除：等級若從警示變安全，consumeLevelChange() 會回報一次
}

void ThreatTracker::onMeasurement(const RadarMeasurement& m, uint32_t nowMs,
                                  const DetectionConfig& cfg) {
  if (m.targets == 0) {
    energyWindow_.push(0);
    energyMedian_ = energyWindow_.median();
    // 已確認的來車只是漏一筆（C4001 偶爾回報 0 個目標）：保留速度，TTC 與等級才不會亂跳
    if (!(tracking_ && confirmed_)) {
      hasSpeed_      = false;
      closingSmooth_ = 0.0f;
    }
    registerMiss();
    evaluate(nowMs, cfg, false);
    return;
  }

  // 能量值跳動很大，用最近 5 筆的中位數判斷物體大小
  energyWindow_.push(m.energy);
  energyMedian_ = energyWindow_.median();

  // 速度做指數平滑；新目標出現的第一筆直接採用，避免從 0 慢慢爬升而漏判
  const float closingRaw = closingSpeed(m.speedMps, cfg.approachSign);
  closingSmooth_ = hasSpeed_
                       ? tuning::kSpeedAlpha * closingRaw + (1.0f - tuning::kSpeedAlpha) * closingSmooth_
                       : closingRaw;
  hasSpeed_ = true;

  const bool candidate = m.rangeM >= tuning::kMinRangeM && m.rangeM <= tuning::kMaxTrackRangeM &&
                         closingSmooth_ >= cfg.effectiveMinSpeed() &&
                         energyMedian_ >= cfg.minEnergy;

  if (candidate) {
    lastCandidateMs_ = nowMs;
    if (evidence_ < tuning::kEvidenceMax) evidence_++;
    if (evidence_ >= cfg.confirmHits) confirmed_ = true;
    updateTrack(m.rangeM, nowMs);
  } else {
    registerMiss();
  }
  evaluate(nowMs, cfg, candidate);  // 只有合格的偵測才延長警示保持時間
}

void ThreatTracker::update(uint32_t nowMs, const DetectionConfig& cfg) {
  if (tracking_ && (nowMs - lastCandidateMs_) > tuning::kTrackLostMs) dropTrack();
  evaluate(nowMs, cfg, false);
}

bool ThreatTracker::consumeLevelChange() {
  if (state_.level == reportedLevel_) return false;
  reportedLevel_ = state_.level;
  return true;
}

// 不合格的一筆：扣一分；還沒確認的目標分數歸零就當雜訊丟掉
void ThreatTracker::registerMiss() {
  if (evidence_ > 0) evidence_--;
  if (!confirmed_ && evidence_ == 0) dropTrack();
}

// 預測 + 修正：距離(下一刻) = 距離(現在) − 接近速度 × 經過時間，再往量測值拉近
void ThreatTracker::updateTrack(float rangeM, uint32_t nowMs) {
  if (!tracking_) {
    tracking_   = true;
    trackDistM_ = rangeM;
    outliers_   = 0;
  } else {
    float dt = static_cast<float>(nowMs - lastTrackMs_) / 1000.0f;
    if (dt > tuning::kMaxDtS) dt = tuning::kMaxDtS;
    const float predicted = trackDistM_ - closingSmooth_ * dt;
    const float residual  = rangeM - predicted;

    if (fabsf(residual) > tuning::kGateM) {
      // 跳值：先相信預測；連續好幾筆都跳，代表真的換了一個目標，改用量測值
      if (++outliers_ >= tuning::kGateResetHits) {
        trackDistM_ = rangeM;
        outliers_   = 0;
      } else {
        trackDistM_ = predicted;
      }
    } else {
      outliers_   = 0;
      trackDistM_ = predicted + tuning::kDistAlpha * residual;
    }
    if (trackDistM_ < 0.0f) trackDistM_ = 0.0f;
  }
  lastTrackMs_ = nowMs;
}

void ThreatTracker::dropTrack() {
  tracking_  = false;
  confirmed_ = false;
  evidence_  = 0;
  outliers_  = 0;
}

// freshData：這次是因為收到新量測而評估（保持時間從「最後一次真的偵測到」開始算）
void ThreatTracker::evaluate(uint32_t nowMs, const DetectionConfig& cfg, bool freshData) {
  const bool live  = tracking_ && confirmed_;
  AlertLevel level = AlertLevel::Safe;

  if (live) {
    const float ttc = closingSmooth_ > tuning::kMinTtcSpeedMps ? trackDistM_ / closingSmooth_ : -1.0f;
    if (trackDistM_ <= cfg.warnRangeM) {
      level = AlertLevel::Caution;
      const bool imminent = (ttc >= 0.0f && ttc <= cfg.dangerTtcS) || trackDistM_ <= cfg.dangerDistM;
      if (imminent) level = AlertLevel::Danger;
    }
    state_.tracking   = true;
    state_.distanceM  = trackDistM_;
    state_.closingMps = closingSmooth_;
    state_.ttcS       = ttc;
  }

  if (level != AlertLevel::Safe) {
    if (freshData || state_.level == AlertLevel::Safe) lastWarnMs_ = nowMs;
    state_.level = level;
    return;
  }

  const bool holding = state_.level != AlertLevel::Safe && (nowMs - lastWarnMs_) < cfg.holdMs;
  if (holding) return;  // 目標剛消失：維持原本等級與最後的數值

  state_.level = AlertLevel::Safe;
  if (!live) {
    state_.tracking   = false;
    state_.distanceM  = -1.0f;
    state_.closingMps = 0.0f;
    state_.ttcS       = -1.0f;
  }
}
