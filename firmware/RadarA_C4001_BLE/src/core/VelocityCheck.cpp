#include "VelocityCheck.h"

#include <math.h>

using namespace velocity_tuning;

namespace {
constexpr float kDopplerVar = kDopplerSigmaMps * kDopplerSigmaMps;
}  // namespace

void VelocityCheck::reset() {
  trusted_  = false;
  distrust_ = false;
  passes_   = 0;
  fails_    = 0;
  edgeRun_  = 0;
  sign_     = SignState::Unknown;
  lastHyp_  = Hypothesis::Default;
  source_   = VelocitySource::Checking;
}

// 判定都卜勒不可信：之後只用距離變化率。resetFilter：濾波器可能已被錯誤的都卜勒帶偏，
// 直接改成最小平方擬合的距離與速度（卡在上限的都卜勒本來就沒有用，就不需要重設）
void VelocityCheck::distrust(const RateFit& coarse, const RateFit& fine, bool resetFilter, VelocityDecision& d) {
  if (!distrust_ && resetFilter) {
    d.resetToFit = true;
    d.fit        = fine.valid ? fine : coarse;
  }
  distrust_ = true;
  trusted_  = false;
  passes_   = 0;
  if (resetFilter) sign_ = SignState::Unknown;  // 因為不一致而不信任：之前的正負號判斷可能就是錯的，重新判斷
  source_ = VelocitySource::RangeRate;
}

VelocityDecision VelocityCheck::evaluate(float dopplerRate, bool signKnown, const RateFit& coarse, const RateFit& fine,
                                         float kfRate, float kfRateVar) {
  VelocityDecision d;

  // ---- 0. 卡在量測上限 / 折疊邊界的都卜勒：不採用；持續卡住代表飽和，改用距離變化率
  if (fabsf(dopplerRate) >= kEdgeMps) {
    if (edgeRun_ < 255) edgeRun_++;
    const bool stuck = edgeRun_ >= (trusted_ ? kEdgeToDistrust : kFailToDistrust);
    // 還沒確認過的追蹤：濾波器速度只來自少數幾筆距離，改用擬合結果比較準
    if (stuck && coarse.valid) distrust(coarse, fine, !trusted_, d);
    return d;
  }
  edgeRun_ = 0;

  // ---- 1. 參考速度：都卜勒已可信 → 卡爾曼預測（精確）；否則 → 距離斜率（獨立，含落後誤差）
  float ref = 0.0f, varRef = 0.0f;
  if (trusted_) {
    ref    = kfRate;
    varRef = kfRateVar;
  } else if (coarse.valid) {
    const float lag = kAccelSigma * coarse.centerAgeS;  // 斜率代表窗中點的速度，最新一刻可能已經變了
    ref             = coarse.rate;
    varRef          = coarse.sigma * coarse.sigma + lag * lag;
  } else {
    // 追蹤剛開始、距離資料還不夠：都卜勒還不能確認，先不放進濾波器（由呼叫端暫時直接用都卜勒判斷）
    if (!distrust_) source_ = VelocitySource::Checking;
    return d;
  }

  // ---- 2. 逐筆假設檢定：預設解釋（依 SIGN、不折疊）落在閘門內就用它；
  //         否則看其他解釋（折疊、正負號相反…）。正負號鎖定後只看同一組。
  struct Candidate {
    Hypothesis hyp;
    float      rate;
    bool       flipped;
  };
  const Candidate all[] = {
      {Hypothesis::Default, dopplerRate, false},
      {Hypothesis::FoldUp, dopplerRate + kWrapMps, false},
      {Hypothesis::FoldDown, dopplerRate - kWrapMps, false},
      {Hypothesis::Flip, -dopplerRate, true},
      {Hypothesis::FlipFoldUp, -dopplerRate + kWrapMps, true},
      {Hypothesis::FlipFoldDown, -dopplerRate - kWrapMps, true},
  };
  const float gate      = kGateSigma * sqrtf(varRef + kDopplerVar) + kGateTolMps;
  int         matches   = 0;   // 落在閘門內的解釋數
  int         best      = -1;  // 其他解釋中誤差最小的
  float       bestErr   = 0.0f;
  bool        defaultOk = false;
  for (int i = 0; i < 6; i++) {
    if ((all[i].flipped && sign_ == SignState::Normal) || (!all[i].flipped && sign_ == SignState::Flipped)) continue;
    // 「正負號相反又折疊」是兩個異常同時發生：只有正負號相反已經確定後才考慮
    if ((all[i].hyp == Hypothesis::FlipFoldUp || all[i].hyp == Hypothesis::FlipFoldDown) && sign_ != SignState::Flipped) {
      continue;
    }
    const float err = fabsf(all[i].rate - ref);
    if (err > gate) continue;
    matches++;
    if (i == 0) {
      defaultOk = true;
    } else if (best < 0 || err < bestErr) {
      best    = i;
      bestErr = err;
    }
  }
  // 還沒確認過、參考速度又比較粗時，若有兩個以上「其他解釋」都說得通 → 不猜，等距離資料多一點再判斷
  if (!defaultOk && matches >= 2 && !trusted_) return d;
  const int  pick    = defaultOk ? 0 : best;
  const bool matched = pick >= 0;

  // ---- 3. 長期核對：同一時間窗內，距離斜率 vs 採用的都卜勒平均（都代表窗中點速度，與加減速無關）
  bool windowOk = true;
  if (fine.valid && fine.dopplerCount >= 3) {
    const float diff = fabsf(fine.rate - fine.dopplerMean);
    const float sd   = sqrtf(fine.sigma * fine.sigma + kDopplerVar / fine.dopplerCount);
    windowOk         = diff <= kGateSigma * sd + kGateTolMps;
  }

  const bool pass = matched && windowOk;
  if (pass) {
    fails_ = 0;
    if (passes_ < 255) passes_++;
  } else {
    passes_ = 0;
    if (fails_ < 255) fails_++;
  }

  // ---- 4. 狀態：可信 / 不可信（遲滯，避免來回切換）
  if (!pass) {
    if (distrust_ || fails_ >= kFailToDistrust) distrust(coarse, fine, true, d);
    return d;  // 單筆不一致（可能是雜訊）：這一筆不用都卜勒，狀態不變
  }
  if (distrust_ && passes_ < kPassToTrust) return d;  // 還在觀察：繼續只用距離變化率

  const Candidate& c = all[pick];
  if (matches == 1 && sign_ == SignState::Unknown) sign_ = c.flipped ? SignState::Flipped : SignState::Normal;

  // 剛確認可信、或換了解釋（例如速度越過 10 m/s 開始折疊）：濾波器速度與這個解釋差太多就直接改寫
  const bool fresh = !trusted_ || c.hyp != lastHyp_;
  if (fresh && fabsf(c.rate - kfRate) > kGateSigma * sqrtf(kfRateVar + kDopplerVar) + kGateTolMps) {
    d.resetRate  = true;
    d.resetValue = c.rate;
    d.resetVar   = kDopplerVar;
  }
  trusted_  = true;
  distrust_ = false;
  lastHyp_  = c.hyp;

  d.useDoppler = true;
  d.rate       = c.rate;
  const bool folded = c.hyp != Hypothesis::Default && c.hyp != Hypothesis::Flip;
  if (c.flipped && signKnown) {
    source_ = VelocitySource::SignFlip;  // SIGN 有設定卻相反：提醒使用者改設定
  } else {
    source_ = folded ? VelocitySource::Unfolded : VelocitySource::Doppler;  // SIGN = 0 時「相反」只是判斷出方向
  }
  return d;
}
