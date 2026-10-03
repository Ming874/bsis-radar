#include "ThreatTracker.h"

#include <math.h>

namespace {

// 雷達速度 → 距離變化率 ṙ（負值 = 越來越近）。SIGN = 0 時方向未知：先當作接近，由交叉核對判斷真正方向
float dopplerRangeRate(float speedMps, int8_t approachSign) {
  if (approachSign == 0) return -fabsf(speedMps);
  return -speedMps * static_cast<float>(approachSign);
}

constexpr float kRangeVar   = tuning::kRangeSigmaM * tuning::kRangeSigmaM;
constexpr float kAccelVar   = tuning::kAccelSigma * tuning::kAccelSigma;
constexpr float kDopplerVar = velocity_tuning::kDopplerSigmaMps * velocity_tuning::kDopplerSigmaMps;

}  // namespace

void ThreatTracker::reset() {
  state_ = ThreatState();
  energyWindow_.clear();
  energyMedian_ = 0;
  dropTrack();
  lastWarnMs_ = 0;
  // reportedLevel_ 不清除：等級若從警示變安全，consumeLevelChange() 會回報一次
}

void ThreatTracker::onMeasurement(const RadarMeasurement& m, uint32_t nowMs, const DetectionConfig& cfg) {
  if (m.targets == 0) {
    // C4001 偶爾回報 0 個目標：只扣分，追蹤與速度都保留，TTC 與等級才不會亂跳
    energyWindow_.push(0);
    energyMedian_ = energyWindow_.median();
    registerMiss();
    evaluate(nowMs, cfg, false);
    return;
  }

  // 能量值跳動很大，用最近 5 筆的中位數判斷物體大小
  energyWindow_.push(m.energy);
  energyMedian_ = energyWindow_.median();

  bool associated = false;
  if (m.rangeM >= tuning::kMinRangeM && m.rangeM <= tuning::kMaxTrackRangeM) {
    const float       doppler = dopplerRangeRate(m.speedMps, cfg.approachSign);
    const Association a       = associate(m.rangeM, doppler, nowMs);
    associated                = a != Association::Rejected;
    if (associated) {
      window_.push(nowMs, m.rangeM);
      if (a == Association::Updated) kf_.updateRange(m.rangeM, kRangeVar);  // 新追蹤已用這筆初始化，不重複計入

      const RateFit coarse = window_.fit(tuning::kRangeSigmaM, tuning::kCoarseWindowMs, tuning::kCoarseMinCount,
                                         tuning::kCoarseMinSpanS);
      const RateFit fine =
          window_.fit(tuning::kRangeSigmaM, tuning::kFineWindowMs, tuning::kFineMinCount, tuning::kFineMinSpanS);
      const VelocityDecision v =
          velocity_.evaluate(doppler, cfg.approachSign != 0, coarse, fine, kf_.rate(), kf_.varRate());
      if (v.resetToFit) {
        kf_.resetState(v.fit.rangeNow, v.fit.rate, v.fit.varRangeNow, v.fit.covRangeRate, v.fit.sigma * v.fit.sigma);
      }
      if (v.resetRate) kf_.resetRate(v.resetValue, v.resetVar);
      if (v.useDoppler) {
        kf_.updateRate(v.rate, kDopplerVar);
        window_.setLatestDoppler(v.rate);
      }

      // 追蹤剛開始、還沒核對：暫時直接用都卜勒（反應最快）；核對後改用融合結果
      closing_ = velocity_.source() == VelocitySource::Checking ? -doppler : -kf_.rate();

      const RateFit& rr = fine.valid ? fine : coarse;
      hasRangeRate_     = rr.valid;
      rangeRate_        = -rr.rate;
    }
  }

  const bool candidate = associated && closing_ >= cfg.effectiveMinSpeed() && energyMedian_ >= cfg.minEnergy;
  if (candidate) {
    lastCandidateMs_ = nowMs;
    if (evidence_ < tuning::kEvidenceMax) evidence_++;
    if (evidence_ >= cfg.confirmHits) confirmed_ = true;
  } else {
    registerMiss();
  }
  evaluate(nowMs, cfg, candidate);  // 只有合格的偵測才延長警示保持時間
}

void ThreatTracker::update(uint32_t nowMs, const DetectionConfig& cfg) {
  if (kf_.active() && (nowMs - lastAssociatedMs_) > tuning::kTrackLostMs) {
    dropTrack();  // 目標不見了
  } else if (confirmed_ && (nowMs - lastCandidateMs_) > tuning::kTrackLostMs) {
    confirmed_ = false;  // 還看得到，但已經不是「正在接近的來車」
    evidence_  = 0;
  }
  evaluate(nowMs, cfg, false);
}

bool ThreatTracker::consumeLevelChange() {
  if (state_.level == reportedLevel_) return false;
  reportedLevel_ = state_.level;
  return true;
}

// 預測到現在，再看量測是否落在驗證閘門內；連續跳值代表換了目標，重新開始追蹤
ThreatTracker::Association ThreatTracker::associate(float rangeM, float dopplerRate, uint32_t nowMs) {
  if (!kf_.active()) {
    startTrack(rangeM, dopplerRate, nowMs);
    return Association::NewTrack;
  }

  float dt = static_cast<float>(nowMs - lastTrackMs_) / 1000.0f;
  if (dt > tuning::kMaxDtS) dt = tuning::kMaxDtS;
  kf_.predict(dt, kAccelVar);
  lastTrackMs_ = nowMs;

  float gate;
  if (velocity_.source() == VelocitySource::Checking) {
    // 速度還沒核對（都卜勒可能折疊）：用物理上可能的最大接近速度估算閘門
    gate = tuning::kMaxClosingMps * dt + tuning::kGateMinM;
  } else {
    gate = tuning::kGateSigma * kf_.rangeInnovationSigma(kRangeVar);
    if (gate < tuning::kGateMinM) gate = tuning::kGateMinM;
    if (gate > tuning::kGateMaxM) gate = tuning::kGateMaxM;
  }

  if (fabsf(rangeM - kf_.range()) > gate) {
    // 跳值之間彼此一致（像是同一個新物體）才累計；車身反射點亂跳的跳值彼此不一致，不會讓追蹤換到雜訊上
    const float sinceS     = static_cast<float>(nowMs - outlierMs_) / 1000.0f;
    const bool  consistent = outliers_ > 0 && sinceS <= tuning::kMaxDtS &&
                            fabsf(rangeM - outlierRangeM_) <= tuning::kMaxClosingMps * sinceS + tuning::kGateMinM;
    outliers_      = consistent ? static_cast<uint8_t>(outliers_ + 1) : 1;
    outlierRangeM_ = rangeM;
    outlierMs_     = nowMs;
    if (outliers_ < tuning::kGateResetHits) return Association::Rejected;  // 跳值：相信預測
    startTrack(rangeM, dopplerRate, nowMs);                                // 連續一致的跳值：換了一個目標
    return Association::NewTrack;
  }
  outliers_         = 0;
  lastAssociatedMs_ = nowMs;
  return Association::Updated;
}

void ThreatTracker::startTrack(float rangeM, float dopplerRate, uint32_t nowMs) {
  kf_.init(rangeM, dopplerRate, kRangeVar, tuning::kInitRateSigma * tuning::kInitRateSigma);
  window_.clear();
  velocity_.reset();
  hasRangeRate_     = false;
  outliers_         = 0;
  lastTrackMs_      = nowMs;
  lastAssociatedMs_ = nowMs;
  // evidence_ / confirmed_ 不清除：換目標（例如另一台車）時警示不中斷；不合格的資料會自然扣分
}

// 不合格的一筆：扣一分（不直接歸零，雷達偶爾漏一筆也能持續追蹤）
void ThreatTracker::registerMiss() {
  if (evidence_ > 0) evidence_--;
}

void ThreatTracker::dropTrack() {
  kf_.clear();
  window_.clear();
  velocity_.reset();
  closing_      = 0.0f;
  hasRangeRate_ = false;
  rangeRate_    = 0.0f;
  evidence_     = 0;
  confirmed_    = false;
  outliers_     = 0;
}

// freshData：這次是因為收到新量測而評估（保持時間從「最後一次真的偵測到」開始算）
void ThreatTracker::evaluate(uint32_t nowMs, const DetectionConfig& cfg, bool freshData) {
  // 速度核對資訊：只要有追蹤就回報（還沒確認是來車也一樣），網頁可以看到核對狀態
  state_.velocitySource = kf_.active() ? velocity_.source() : VelocitySource::None;
  state_.hasRangeRate   = kf_.active() && hasRangeRate_;
  state_.rangeRateMps   = state_.hasRangeRate ? rangeRate_ : 0.0f;

  const bool live  = kf_.active() && confirmed_;
  AlertLevel level = AlertLevel::Safe;

  if (live) {
    const float dist = kf_.range() > 0.0f ? kf_.range() : 0.0f;
    const float ttc  = closing_ > tuning::kMinTtcSpeedMps ? dist / closing_ : -1.0f;
    if (dist <= cfg.warnRangeM) {
      level               = AlertLevel::Caution;
      const bool imminent = (ttc >= 0.0f && ttc <= cfg.dangerTtcS) || dist <= cfg.dangerDistM;
      if (imminent) level = AlertLevel::Danger;
    }
    state_.tracking   = true;
    state_.distanceM  = dist;
    state_.closingMps = closing_;
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
