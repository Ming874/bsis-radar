#include "GroundSpeedEstimator.h"

#include <math.h>

using namespace ground_tuning;

namespace {

constexpr float kDegToRad     = 3.14159265f / 180.0f;
constexpr float kMaxVariance  = 25.0f;
constexpr float kMadToSigma   = 1.4826f;     // 常態分布：σ = 1.4826 × 中位數絕對偏差
constexpr float kSqrt6        = 2.4494897f;  // i.i.d. 雜訊的二階差分：Var = 6σ²
constexpr uint32_t kMinPredictMs = 20;       // 主迴圈裡至少隔這麼久才傳播一次狀態（避免 float 累積誤差）

float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 小陣列的中位數（插入排序；n ≤ kNoiseWindow）
float medianOf(const float* values, uint8_t n) {
  if (n == 0) return 0.0f;
  float s[kNoiseWindow];
  for (uint8_t i = 0; i < n; i++) {
    const float key = values[i];
    uint8_t     j   = i;
    while (j > 0 && s[j - 1] > key) {
      s[j] = s[j - 1];
      j--;
    }
    s[j] = key;
  }
  return (n % 2) ? s[n / 2] : 0.5f * (s[n / 2 - 1] + s[n / 2]);
}

// 一組量測是否彼此一致（擷取與重新初始化共用）：全距 ≤ max(0.6 m/s, 中位數的 25%)
bool consistent(const float* values, uint8_t n, float* median) {
  float lo = values[0], hi = values[0];
  for (uint8_t i = 1; i < n; i++) {
    if (values[i] < lo) lo = values[i];
    if (values[i] > hi) hi = values[i];
  }
  *median = medianOf(values, n);
  return hi - lo <= fmaxf(0.6f, 0.25f * *median);
}

bool tracking(SpeedState s) { return s == SpeedState::Tracking || s == SpeedState::Holding; }

// 連續的資料框：間隔在合理範圍內，而且前後兩個間隔差不多（二階差分才有意義）
bool continuousGaps(uint32_t gap1, uint32_t gap2) {
  const auto ok = [](uint32_t g) { return g >= kFrameGapMinMs && g <= kFrameGapMaxMs; };
  if (!ok(gap1) || !ok(gap2)) return false;
  const uint32_t lo = gap1 < gap2 ? gap1 : gap2;
  const uint32_t hi = gap1 < gap2 ? gap2 : gap1;
  return 2 * hi <= 3 * lo;
}

// 一個方向正確、在窗口內的目標
struct Candidate {
  float   g;
  float   depressionDeg;
  int8_t  index;
  uint8_t snr;
};

}  // namespace

// ---------------------------------------------------------------- 幾何
GroundWindow groundWindow(const SpeedConfig& cfg) {
  const float steep   = clampf(cfg.angleDeg + kGateSteepDeg, kGateMinDeg, kGateMaxDeg);
  const float shallow = clampf(cfg.angleDeg - kGateShallowDeg, kGateMinDeg, kGateMaxDeg);
  GroundWindow w;
  w.minRangeM = cfg.heightM / sinf(steep * kDegToRad) - kRangeMarginM;
  w.maxRangeM = cfg.heightM / sinf(shallow * kDegToRad) + kRangeMarginM;
  if (w.minRangeM < 0.0f) w.minRangeM = 0.0f;
  if (w.maxRangeM > kMaxRangeM) w.maxRangeM = kMaxRangeM;
  // LD2451 的距離是整數公尺（四捨五入或無條件捨去都有可能，文件沒寫）：兩端都往外取整
  w.minDistanceM = static_cast<uint8_t>(floorf(w.minRangeM));
  w.maxDistanceM = static_cast<uint8_t>(ceilf(w.maxRangeM));
  return w;
}

// 雷達兩組接收天線左右排列（排針朝上），量到的角度 φ 是視線與「垂直於天線基線的平面」的夾角。
// 視線 ℓ = cos φ (cos α · 前進方向 + sin α · 向下) + sin φ · 側向，所以 vr = v · cos φ · cos α
bool groundFactor(const SpeedConfig& cfg, float rangeM, float azimuthDeg, float* factor, float* depressionDeg) {
  if (!(fabsf(azimuthDeg) <= kMaxAzimuthDeg)) return false;
  const float cosAz = cosf(azimuthDeg * kDegToRad);
  if (cfg.model == SpeedModel::FixedAngle) {
    *factor        = 1.0f / (cosf(cfg.angleDeg * kDegToRad) * cosAz);
    *depressionDeg = cfg.angleDeg;
    return true;
  }
  // 距離幾何：平坦路面上距離 r 的散射點，cos φ · sin α = h / r
  if (!(rangeM > 0.0f)) return false;
  const float s = cfg.heightM / (rangeM * cosAz);
  if (!(s > 0.0f) || s >= sinf(kGateMaxDeg * kDegToRad)) return false;  // 地面以下或幾乎正下方
  *factor        = 1.0f / (cosAz * sqrtf(1.0f - s * s));
  *depressionDeg = asinf(s) / kDegToRad;
  return true;
}

float radialMps(const RadarTarget& t) {
  const float speed = static_cast<float>(t.speedKmh) / 3.6f;
  return t.approaching() ? -speed : speed;
}

// ---------------------------------------------------------------- 狀態
GroundSpeedEstimator::GroundSpeedEstimator() { reset(); }

void GroundSpeedEstimator::reset() {
  state_        = SpeedState::NoRadar;
  stateSinceMs_ = 0;
  v_ = a_ = 0.0f;
  p00_ = p01_ = p11_ = 0.0f;
  kfMs_ = lastAcceptMs_ = 0;
  nis_ = 1.0f;
  prevGCount_ = d2Count_ = d2Next_ = 0;
  outlierCount_ = 0;
  acqCount_     = 0;
  beforeAcquire_ = SpeedState::Stopped;
  staticRun_ = 0;
  distanceM_ = pendingM_ = 0.0;
  odoStarted_ = false;
  odoV_       = 0.0f;
  verdictCount_ = verdictNext_ = 0;
  frames_ = 0;
}

bool GroundSpeedEstimator::hasSpeed() const {
  return state_ == SpeedState::Stopped || state_ == SpeedState::Acquiring || tracking(state_);
}

float GroundSpeedEstimator::speedMps() const { return tracking(state_) ? v_ : 0.0f; }
float GroundSpeedEstimator::accelMps2() const { return tracking(state_) ? a_ : 0.0f; }
float GroundSpeedEstimator::sigmaMps() const { return tracking(state_) ? sqrtf(p00_) : 0.0f; }

uint8_t GroundSpeedEstimator::qualityPct() const {
  if (verdictCount_ == 0) return 0;
  return static_cast<uint8_t>(countVerdict(FrameVerdict::Accepted) * 100 / verdictCount_);
}

uint8_t GroundSpeedEstimator::countVerdict(FrameVerdict v) const {
  uint8_t n = 0;
  for (uint8_t i = 0; i < verdictCount_; i++) n += verdicts_[i] == static_cast<uint8_t>(v);
  return n;
}

uint8_t GroundSpeedEstimator::wrongDirectionPct() const {
  if (verdictCount_ == 0) return 0;
  return static_cast<uint8_t>(countVerdict(FrameVerdict::WrongDirection) * 100 / verdictCount_);
}

void GroundSpeedEstimator::rememberVerdict(FrameVerdict v) {
  verdicts_[verdictNext_] = static_cast<uint8_t>(v);
  verdictNext_ = static_cast<uint8_t>((verdictNext_ + 1) % kVerdictWindow);
  if (verdictCount_ < kVerdictWindow) verdictCount_++;
}

void GroundSpeedEstimator::enter(SpeedState s, uint32_t tMs) {
  if (s == state_) return;
  state_        = s;
  stateSinceMs_ = tMs;
  if (!tracking(s)) {
    v_ = a_ = 0.0f;
    p00_ = p01_ = p11_ = 0.0f;
    odoV_         = 0.0f;
    outlierCount_ = 0;
    prevGCount_   = 0;
  }
}

void GroundSpeedEstimator::setRadarOffline(uint32_t tMs) {
  if (state_ == SpeedState::NoRadar) return;
  advance(tMs);
  commitPending(1.0);
  acqCount_ = 0;
  enter(SpeedState::NoRadar, tMs);
}

// ---------------------------------------------------------------- 里程（梯形積分）
void GroundSpeedEstimator::advance(uint32_t tMs) {
  if (!odoStarted_) {
    odoStarted_ = true;
    odoMs_      = tMs;
    return;
  }
  const uint32_t elapsed = tMs - odoMs_;
  odoMs_ = tMs;
  if (elapsed == 0 || elapsed > 1000) return;  // 主迴圈卡住超過 1 秒（不應發生）：不拿來積分
  if (!tracking(state_)) return;
  const double inc = 0.5 * (odoV_ + v_) * (elapsed / 1000.0);
  if (state_ == SpeedState::Tracking) distanceM_ += inc;
  else pendingM_ += inc;  // 保持中：結果確定後才決定要算多少進去
  odoV_ = v_;
}

void GroundSpeedEstimator::commitPending(double fraction) {
  distanceM_ += fraction * pendingM_;
  pendingM_ = 0.0;
}

// ---------------------------------------------------------------- 卡爾曼：等加速度模型
// x = [v, a]ᵀ，F = [1 dt; 0 1]，Q = q [dt³/3 dt²/2; dt²/2 dt]（連續白雜訊加加速度，Bar-Shalom §6.2）。
// 連續時間模型離散化後可以任意切分：主迴圈每 20 ms 傳播一次與每 100 ms 一次結果相同。
void GroundSpeedEstimator::predict(uint32_t tMs) {
  const uint32_t startMs   = kfMs_;
  const uint32_t elapsedMs = tMs - startMs;
  kfMs_ = tMs;
  if (elapsedMs == 0 || elapsedMs > 5000) return;

  // 保持（失去回波）時只在最後一筆量測後 kHoldExtrapolateMs 內沿用加速度，之後速度固定
  uint32_t accelMs = elapsedMs;
  if (state_ == SpeedState::Holding) {
    const uint32_t limit = lastAcceptMs_ + kHoldExtrapolateMs;
    if (static_cast<int32_t>(startMs - limit) >= 0) accelMs = 0;
    else if (static_cast<int32_t>(tMs - limit) > 0) accelMs = limit - startMs;
  }

  const float dt = elapsedMs / 1000.0f;
  v_ += a_ * (accelMs / 1000.0f);
  if (accelMs < elapsedMs) a_ = 0.0f;
  if (v_ < 0.0f) {
    v_ = 0.0f;
    if (a_ < 0.0f) a_ = 0.0f;
  }

  const float q = maneuvering() ? kJerkNoiseManeuver : kJerkNoise;
  p00_ += 2.0f * dt * p01_ + dt * dt * p11_ + q * dt * dt * dt / 3.0f;
  p01_ += dt * p11_ + q * dt * dt / 2.0f;
  p11_ += q * dt;
  if (p00_ > kMaxVariance) p00_ = kMaxVariance;
  if (p11_ > kMaxVariance) p11_ = kMaxVariance;
}

void GroundSpeedEstimator::correct(float z, float r) {
  const float s  = p00_ + r;
  const float k0 = p00_ / s;
  const float k1 = p01_ / s;
  const float nu = z - v_;
  nis_ += kNisSmoothing * (nu * nu / s - nis_);
  v_ += k0 * nu;
  a_ += k1 * nu;
  const float p00 = p00_, p01 = p01_;
  p00_ = (1.0f - k0) * p00;
  p01_ = (1.0f - k0) * p01;
  p11_ -= k1 * p01;
  a_ = clampf(a_, kAccelMin, kAccelMax);
  if (v_ < 0.0f) {
    v_ = 0.0f;
    if (a_ < 0.0f) a_ = 0.0f;
  }
  odoV_ = v_;  // 量測更新是瞬間的修正，不算進里程積分
}

// 量測雜訊的初值：雷達本身的速度解析 + 與速度成正比的波束分散（docs/ALGORITHM.md §6.3）
float GroundSpeedEstimator::nominalVariance(float speed, const SpeedConfig& cfg) const {
  const float scale  = cfg.calibration / cosf(cfg.angleDeg * kDegToRad);
  const float base   = kSigmaRadial * scale;
  const float spread = kSpreadRatio * speed;
  return base * base + spread * spread;
}

// 量測雜訊：累積足夠的二階差分後，用它的中位數估計（穩健、隨路面與速度自動調整、不受等加速度影響），
// 夾在初值的 1/4 ～ 9 倍之間
float GroundSpeedEstimator::measurementVariance(float speed, const SpeedConfig& cfg) const {
  const float nominal = nominalVariance(speed, cfg);
  if (d2Count_ < kNoiseMinSamples) return nominal;
  const float sigma = kMadToSigma * medianOf(d2_, d2Count_) / kSqrt6;
  return clampf(sigma * sigma, 0.25f * nominal, 9.0f * nominal);
}

// 追蹤中每一筆地面量測（不論有沒有通過閘門）都拿來估計雜訊：只用通過閘門的會低估雜訊，閘門越縮越窄
void GroundSpeedEstimator::rememberGround(float g, uint32_t tMs) {
  if (prevGCount_ == 2) {
    if (continuousGaps(prevGMs_[1] - prevGMs_[0], tMs - prevGMs_[1])) {
      d2_[d2Next_] = fabsf(g - 2.0f * prevG_[1] + prevG_[0]);
      d2Next_ = static_cast<uint8_t>((d2Next_ + 1) % kNoiseWindow);
      if (d2Count_ < kNoiseWindow) d2Count_++;
    }
    prevG_[0]   = prevG_[1];
    prevGMs_[0] = prevGMs_[1];
    prevGCount_ = 1;
  }
  prevG_[prevGCount_]   = g;
  prevGMs_[prevGCount_] = tMs;
  prevGCount_++;
}

// ---------------------------------------------------------------- 每一個資料框
FrameResult GroundSpeedEstimator::onFrame(const RadarFrame& f, uint32_t tMs, const SpeedConfig& cfg) {
  frames_++;
  if (tracking(state_)) predict(tMs);
  advance(tMs);
  if (state_ == SpeedState::NoRadar) enter(SpeedState::Stopped, tMs);  // 剛上線：最可能是停著

  FrameResult r;
  r.verdict = classify(f, cfg, r);
  if (r.verdict == FrameVerdict::Accepted) handleMeasurement(r.groundMps, tMs, cfg, r);  // 可能改判為離群值、擷取中，或停著時的靜止
  if (r.verdict == FrameVerdict::Static) handleStatic(tMs);
  else staticRun_ = 0;

  rememberVerdict(r.verdict);
  update(tMs);
  return r;
}

// 從一個資料框挑出代表路面的量測。LD2451 一次回報最多 5 個移動中的目標（C4001 只有最強的一個）：
// 路面是連續的散射面，常常同時出現好幾個距離、角度不同的點，各自換算後應該差不多；
// 其中混了一台車或路邊晃動的東西時，取中位數就不會被帶偏
FrameVerdict GroundSpeedEstimator::classify(const RadarFrame& f, const SpeedConfig& cfg, FrameResult& out) const {
  const uint8_t n = f.count < kRadarMaxTargets ? f.count : kRadarMaxTargets;
  if (n == 0) return FrameVerdict::NoTarget;

  const GroundWindow w = groundWindow(cfg);
  Candidate ground[kRadarMaxTargets];
  uint8_t   nGround   = 0;
  int8_t    wrong     = -1;  // 方向相反的目標中訊噪比最高的
  float     wrongG    = 0.0f;
  float     wrongDep  = 0.0f;
  int8_t    still     = -1;  // 靜止的目標
  int8_t    strongest = -1;  // 全部目標中訊噪比最高的（窗口外時顯示用）

  for (uint8_t i = 0; i < n; i++) {
    const RadarTarget& t   = f.targets[i];
    const int8_t       idx = static_cast<int8_t>(i);
    if (strongest < 0 || t.snr > f.targets[strongest].snr) strongest = idx;
    if (t.distanceM < w.minDistanceM || t.distanceM > w.maxDistanceM) continue;
    float factor = 1.0f, depression = cfg.angleDeg;
    if (!groundFactor(cfg, static_cast<float>(t.distanceM), static_cast<float>(t.angleDeg), &factor, &depression)) continue;

    // 沿預期方向的徑向速度：往前騎時，朝後的雷達看到地面遠離（DIR = +1）
    const float along = static_cast<float>(cfg.direction) * radialMps(t);
    if (fabsf(along) < kStaticRadialMps) {
      if (still < 0 || t.snr > f.targets[still].snr) still = idx;
      continue;
    }
    const float g = cfg.calibration * fabsf(along) * factor;
    if (along > 0.0f) {
      ground[nGround++] = {g, depression, idx, t.snr};
    } else if (wrong < 0 || t.snr > f.targets[wrong].snr) {
      wrong    = idx;
      wrongG   = g;
      wrongDep = depression;
    }
  }

  if (nGround > 0) {
    // 依 g 排序（插入排序，最多 5 個）取中位數；偶數個時取中間兩個的平均，代表目標取訊噪比較高的那個
    for (uint8_t i = 1; i < nGround; i++) {
      const Candidate key = ground[i];
      uint8_t         j   = i;
      while (j > 0 && ground[j - 1].g > key.g) {
        ground[j] = ground[j - 1];
        j--;
      }
      ground[j] = key;
    }
    const Candidate* pick  = &ground[nGround / 2];
    float            value = pick->g;
    if (nGround % 2 == 0) {
      const Candidate& lower = ground[nGround / 2 - 1];
      value = 0.5f * (lower.g + pick->g);
      if (lower.snr > pick->snr) pick = &lower;
    }
    out.target        = pick->index;
    out.candidates    = nGround;
    out.hasGround     = true;
    out.groundMps     = value;
    out.depressionDeg = pick->depressionDeg;
    return FrameVerdict::Accepted;
  }
  if (wrong >= 0) {
    out.target        = wrong;
    out.hasGround     = true;
    out.groundMps     = wrongG;
    out.depressionDeg = wrongDep;
    return FrameVerdict::WrongDirection;
  }
  if (still >= 0) {
    out.target = still;
    return FrameVerdict::Static;
  }
  out.target = strongest;
  return FrameVerdict::OutOfGate;
}

void GroundSpeedEstimator::handleMeasurement(float g, uint32_t tMs, const SpeedConfig& cfg, FrameResult& out) {
  if (!tracking(state_)) {
    if (state_ != SpeedState::Acquiring) {
      if (g < kMoveMps) {  // 停著時的微小晃動：仍算靜止
        out.verdict = FrameVerdict::Static;
        return;
      }
      beforeAcquire_ = state_;
      acqCount_      = 0;
      enter(SpeedState::Acquiring, tMs);
    }
    acquire(g, tMs);
    if (state_ == SpeedState::Acquiring) out.verdict = FrameVerdict::Acquiring;
    return;
  }

  predict(tMs);
  rememberGround(g, tMs);
  const float r    = measurementVariance(v_, cfg);
  const float nu   = g - v_;
  const float gate = kGateSigma * sqrtf(p00_ + r) + kGateFloorMps;

  if (fabsf(nu) <= gate) {
    // 里程用量測本身積分：濾波後速度在急煞時會落後，直接積分會多算距離（docs/ALGORITHM.md §6.5）。
    // 兩筆量測之間已經用預測速度積分過，把這一筆的創新 × 資料框間隔加回去，這段就等於用量測值積分
    const uint32_t gapMs = tMs - lastAcceptMs_;
    const double   dt    = (gapMs > kFrameGapMaxMs ? kNominalFrameMs : gapMs) / 1000.0;
    if (state_ == SpeedState::Tracking) distanceM_ += nu * dt;
    else pendingM_ += nu * dt;
    correct(g, r);
    outlierCount_ = 0;
    lastAcceptMs_ = tMs;
    if (state_ == SpeedState::Holding) {  // 回波回來了：保持期間的距離是真的
      commitPending(1.0);
      enter(SpeedState::Tracking, tMs);
    }
    out.verdict = FrameVerdict::Accepted;
    return;
  }

  // 離群值：可能是雜訊，也可能是速度真的變了（保持太久、急煞）。連續幾筆彼此一致就相信它們
  out.verdict = FrameVerdict::Outlier;
  if (outlierCount_ == kReinitOutliers) {  // 滿了：丟掉最舊的
    for (uint8_t i = 1; i < kReinitOutliers; i++) outliers_[i - 1] = outliers_[i];
    outlierCount_--;
  }
  outliers_[outlierCount_++] = g;
  float median = 0.0f;
  if (outlierCount_ == kReinitOutliers && consistent(outliers_, outlierCount_, &median)) {
    commitPending(1.0);
    startTracking(median, nominalVariance(median, cfg), tMs);
    out.verdict = FrameVerdict::Accepted;
  }
}

// 靜止回波只有在「本來就快停了」或「不知道速度」時才代表自己停下來；
// 高速追蹤中看到的靜止物體是跟著車子走的東西（擋泥板、車架），忽略
void GroundSpeedEstimator::handleStatic(uint32_t tMs) {
  if (staticRun_ < 255) staticRun_++;
  const bool slow  = tracking(state_) && v_ < kStopMps && staticRun_ >= 2;
  const bool acq   = state_ == SpeedState::Acquiring && staticRun_ >= 2;
  const bool blind = state_ == SpeedState::Lost && staticRun_ >= 5;
  if (slow || acq || blind) {
    commitPending(0.5);
    acqCount_ = 0;
    enter(SpeedState::Stopped, tMs);
  }
}

void GroundSpeedEstimator::acquire(float g, uint32_t tMs) {
  // 只保留擷取窗口內的量測
  uint8_t keep = 0;
  for (uint8_t i = 0; i < acqCount_; i++) {
    if (tMs - acq_[i].tMs <= kAcquireWindowMs) acq_[keep++] = acq_[i];
  }
  acqCount_ = keep;
  if (acqCount_ == sizeof(acq_) / sizeof(acq_[0])) {
    for (uint8_t i = 1; i < acqCount_; i++) acq_[i - 1] = acq_[i];
    acqCount_--;
  }
  acq_[acqCount_++] = {g, tMs};
  if (acqCount_ < kAcquireFrames) return;

  float last[kAcquireFrames];
  for (uint8_t i = 0; i < kAcquireFrames; i++) last[i] = acq_[acqCount_ - kAcquireFrames + i].g;
  float median = 0.0f;
  if (!consistent(last, kAcquireFrames, &median) || median < kMoveMps) return;

  // 確認在動：擷取期間（第一筆之前約一個資料框起）走過的距離補回里程
  const uint32_t firstMs = acq_[acqCount_ - kAcquireFrames].tMs;
  distanceM_ += median * ((tMs - firstMs + kNominalFrameMs) / 1000.0);
  const float spread = fmaxf(0.3f, 0.1f * median);
  startTracking(median, spread * spread, tMs);
}

void GroundSpeedEstimator::startTracking(float speed, float variance, uint32_t tMs) {
  v_   = speed;
  a_   = 0.0f;
  p00_ = variance;
  p01_ = 0.0f;
  p11_ = kInitAccelSigma * kInitAccelSigma;
  kfMs_         = tMs;
  lastAcceptMs_ = tMs;
  nis_          = 1.0f;
  outlierCount_ = 0;
  acqCount_     = 0;
  prevGCount_   = 0;
  enter(SpeedState::Tracking, tMs);
  odoMs_ = tMs;
  odoV_  = v_;
}

// ---------------------------------------------------------------- 逾時
void GroundSpeedEstimator::update(uint32_t tMs) {
  if (tracking(state_) && tMs - kfMs_ >= kMinPredictMs) predict(tMs);  // 兩筆資料框之間也讓速度隨加速度變化
  advance(tMs);

  switch (state_) {
    case SpeedState::Tracking:
      if (tMs - lastAcceptMs_ >= kHoldAfterMs) {
        pendingM_ = 0.0;
        enter(SpeedState::Holding, tMs);
      }
      break;

    case SpeedState::Holding: {
      const uint32_t since = tMs - lastAcceptMs_;
      if (v_ < kStopMps && since >= kStopAfterMs) {
        // 慢速（或外推後已經很慢）時失去回波 = 正在停下來：保持期間的距離算一半
        commitPending(0.5);
        enter(SpeedState::Stopped, tMs);
      } else if (since >= kLostAfterMs) {
        commitPending(1.0);
        enter(SpeedState::Lost, tMs);
      }
      break;
    }

    case SpeedState::Acquiring:
      if (acqCount_ == 0 || tMs - acq_[acqCount_ - 1].tMs > kAcquireWindowMs) {
        acqCount_ = 0;
        enter(beforeAcquire_, tMs);
      }
      break;

    default:
      break;
  }
}
