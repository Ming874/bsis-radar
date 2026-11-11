/*!
 * @file   GroundSpeedEstimator.h
 * @brief  【核心層】由斜照路面的 HLK-LD2451 估計自行車對地速度（純邏輯，可在電腦上做單元測試）。
 *
 * 每一個雷達資料框（最多 5 個移動中的目標）依序經過：
 *   1. 挑選：每個目標先檢查距離窗口與水平角，換算成對地速度 g = CAL · |vr| / (cos α · cos φ)
 *      （α 依 MODEL：固定 ANGLE，或由距離與 HEIGHT 算出的俯角；φ 是雷達量到的水平角）。
 *      方向正確的目標取 g 的中位數（一兩個不是路面的目標不會帶偏）；沒有的話依序判為方向相反、靜止、窗口外
 *   2. 穩健卡爾曼濾波：等加速度模型（狀態 = 速度、加速度），以相鄰量測二階差分的中位數自動估計量測雜訊，
 *      3σ 閘門剔除離群值；連續且彼此一致的離群值代表速度真的變了 → 重新初始化
 *   3. 狀態機：靜止 → 擷取（3 筆一致才開始）→ 追蹤 ⇄ 保持（短暫失去地面回波）→ 靜止 / 訊號中斷
 *   4. 里程：對濾波後速度積分；擷取期間的距離在確認後補回，保持期間的距離依結果補回
 * 公式、參數依據與驗證見 docs/ALGORITHM.md。
 */
#pragma once
#include <stdint.h>

#include "RadarFrame.h"
#include "SpeedConfig.h"

namespace ground_tuning {
// 寫進測速雷達（LD2451）的偵測設定：距離是 LD2451 可設定的最小值，方向「靠近遠離都回報」
// （方向由 ESP32 依 DIR 判斷，DIR 設反時網頁才看得出來）
constexpr uint8_t kRadarDetectRangeM = 10;
constexpr uint8_t kRadarMinSpeedKmh  = 1;  // 再低就是停著時車身的晃動

// 地面距離窗口：以視軸俯角為中心，往淺（遠）放寬 kGateShallowDeg、往深（近）放寬 kGateSteepDeg
constexpr float kGateShallowDeg = 25.0f;
constexpr float kGateSteepDeg   = 30.0f;
constexpr float kGateMinDeg     = 5.0f;   // 再淺就是遠處的物體，不是腳下的路面
constexpr float kGateMaxDeg     = 85.0f;  // 正下方附近都卜勒趨近 0，沒有測速價值
constexpr float kRangeMarginM   = 0.10f;  // 距離雜訊的餘裕
constexpr float kMaxRangeM      = 10.0f;  // 雷達偵測距離
// LD2451 的距離是整數公尺：窗口換成整數時往外取整（例如 0.62～2.15 m → 0～3 m）
constexpr float kMaxAzimuthDeg  = 30.0f;  // 雷達波束 ±20°；水平角更大的多半是位元錯誤或旁瓣
constexpr float kStaticRadialMps = 0.12f;  // 低於這個值 = 雷達看到的是靜止物體（LD2451 回報 0 km/h）

// 狀態機（ms）與速度門檻（m/s，對地）
constexpr uint32_t kHoldAfterMs       = 400;   // 追蹤中這麼久沒有可用量測 → 保持
constexpr uint32_t kHoldExtrapolateMs = 500;   // 保持時沿用加速度外推的最長時間，之後速度固定
constexpr uint32_t kStopAfterMs       = 600;   // 保持中、外推速度低於 kStopMps，再過這麼久 → 靜止
constexpr uint32_t kLostAfterMs       = 2000;  // 保持超過這麼久 → 訊號中斷
constexpr uint32_t kAcquireWindowMs   = 1000;  // 擷取：這段時間內要湊到 kAcquireFrames 筆一致的量測
constexpr uint8_t  kAcquireFrames     = 3;
constexpr float    kMoveMps           = 0.30f;  // 低於這個速度不算在動
constexpr float    kStopMps           = 1.20f;  // 失去回波時（外推）速度低於這個值，視為正在停車

// 資料框間隔：LD2451 有目標時的輸出頻率還沒實測（估計約 10 Hz），以下只在這個範圍內的間隔才當作「連續」
constexpr uint32_t kFrameGapMinMs     = 40;
constexpr uint32_t kFrameGapMaxMs     = 250;
constexpr uint32_t kNominalFrameMs    = 100;

// 卡爾曼濾波（docs/ALGORITHM.md §6.3）
// 白雜訊加加速度的譜密度 q（m²/s⁵）：巡航時用小的（平順），偵測到加減速時切換成大的（跟得上）。
// 偵測方式：正規化創新平方 ε = ν² / S 的指數平均超過門檻（Bar-Shalom 的 adjustable level process noise）
constexpr float   kJerkNoise         = 0.15f;
constexpr float   kJerkNoiseManeuver = 6.0f;
constexpr float   kManeuverNis       = 3.0f;   // ε 平均的門檻（純雜訊時期望值 = 1）
constexpr float   kNisSmoothing      = 0.3f;   // ε 指數平均的權重
constexpr float   kInitAccelSigma  = 2.0f;   // 開始追蹤時加速度的不確定度（m/s²）
constexpr float   kAccelMin        = -8.0f;  // 物理上限：急煞約 −6（0.6 g），加速很少超過 +3
constexpr float   kAccelMax        = 4.0f;
constexpr float   kSigmaRadial     = 0.15f;  // LD2451 徑向速度的量化（1 km/h）與解析雜訊（m/s）
constexpr float   kSpreadRatio     = 0.08f;  // 波束內俯角分散造成的相對雜訊（自動估計前的初值）
constexpr float   kGateSigma       = 3.0f;   // 創新閘門（σ）
constexpr float   kGateFloorMps    = 0.30f;  // 閘門下限
constexpr uint8_t kNoiseWindow     = 16;     // 自動估計量測雜訊用的二階差分筆數
constexpr uint8_t kNoiseMinSamples = 6;
constexpr uint8_t kReinitOutliers  = 3;      // 連續幾筆彼此一致的離群值 → 重新初始化
}  // namespace ground_tuning

// 估計器狀態（遙測 ST 欄位，網頁依此顯示）。6 是 C4001 版的「超出測速上限」，4.0 起不再出現
enum class SpeedState : uint8_t {
  NoRadar   = 0,  // 雷達離線或尚未有資料
  Stopped   = 1,  // 靜止：速度 0
  Acquiring = 2,  // 剛看到地面回波，確認中（速度仍顯示 0）
  Tracking  = 3,  // 正常追蹤
  Holding   = 4,  // 短暫失去地面回波，暫時沿用估計值
  Lost      = 5,  // 訊號中斷：速度未知
};

// 每一個資料框的判斷結果（遙測 FV 欄位）。2、6、9 是 C4001 版的外插、接近上限、折疊還原，4.0 起不再出現
enum class FrameVerdict : uint8_t {
  Accepted       = 0,  // 用來更新速度
  NoTarget       = 1,  // 雷達沒有回報目標
  OutOfGate      = 3,  // 目標都不在地面窗口內（距離或水平角）
  WrongDirection = 4,  // 窗口內的目標都和 DIR 預期的方向相反（後方來車，或 DIR 設反）
  Static         = 5,  // 雷達看到靜止物體（徑向速度約 0），或停著時的微小晃動
  Outlier        = 7,  // 與目前估計差太多（3σ 閘門外）
  Acquiring      = 8,  // 擷取階段的量測（還沒開始追蹤）
};

struct FrameResult {
  FrameVerdict verdict       = FrameVerdict::NoTarget;
  int8_t       target        = -1;     // 代表這個資料框的目標（在 RadarFrame::targets 的位置），沒有為 -1
  uint8_t      candidates    = 0;      // 方向正確、在窗口內的目標數（取中位數的對象）
  bool         hasGround     = false;  // groundMps / depressionDeg 有沒有算
  float        groundMps     = 0.0f;   // 這個資料框換算出的對地速度（濾波前）
  float        depressionDeg = 0.0f;   // 代表目標用的俯角
};

// 地面距離窗口（由 ANGLE、HEIGHT 算出）
struct GroundWindow {
  float minRangeM;  // 連續的窗口（網頁顯示用）
  float maxRangeM;
  uint8_t minDistanceM;  // 套用到 LD2451 整數距離的窗口（含兩端）
  uint8_t maxDistanceM;
};

GroundWindow groundWindow(const SpeedConfig& cfg);

// 單一目標的換算倍率 g / |vr|（不含 CAL）；距離在地面以下、水平角太大等不合理時回傳 false
bool groundFactor(const SpeedConfig& cfg, float rangeM, float azimuthDeg, float* factor, float* depressionDeg);

// 目標的有號徑向速度（m/s）：正 = 遠離雷達（雷達朝後、往前騎時的路面）
float radialMps(const RadarTarget& t);

class GroundSpeedEstimator {
 public:
  GroundSpeedEstimator();

  void reset();

  // 每一個雷達資料框（含「沒目標」的空資料框）
  FrameResult onFrame(const RadarFrame& f, uint32_t tMs, const SpeedConfig& cfg);

  // 每次 loop 呼叫：處理逾時（保持 → 靜止 / 中斷）並累積里程
  void update(uint32_t tMs);

  // 雷達離線
  void setRadarOffline(uint32_t tMs);

  SpeedState state() const { return state_; }
  bool       hasSpeed() const;          // 速度已知（靜止、擷取、追蹤、保持）
  bool       maneuvering() const { return nis_ > ground_tuning::kManeuverNis; }  // 偵測到明顯加減速
  float      speedMps() const;          // 已知時的速度（m/s）；未知時回傳 0
  float      accelMps2() const;         // 加速度估計（追蹤、保持時）
  float      sigmaMps() const;          // 速度的 1σ 不確定度
  double     distanceM() const { return distanceM_; }
  uint8_t    qualityPct() const;        // 最近 20 筆資料框中可用量測的比例
  uint8_t    wrongDirectionPct() const; // 最近 20 筆中「方向相反」的比例（網頁用來提示 DIR 設反）
  uint32_t   frames() const { return frames_; }

 private:
  struct Sample {
    float    g;
    uint32_t tMs;
  };

  void         advance(uint32_t tMs);
  void         enter(SpeedState s, uint32_t tMs);
  FrameVerdict classify(const RadarFrame& f, const SpeedConfig& cfg, FrameResult& out) const;
  void         handleMeasurement(float g, uint32_t tMs, const SpeedConfig& cfg, FrameResult& out);
  void         handleStatic(uint32_t tMs);
  void         acquire(float g, uint32_t tMs);
  void         startTracking(float speed, float variance, uint32_t tMs);
  void         predict(uint32_t tMs);
  void         correct(float z, float r);
  float        nominalVariance(float speed, const SpeedConfig& cfg) const;
  float        measurementVariance(float speed, const SpeedConfig& cfg) const;
  void         rememberGround(float g, uint32_t tMs);
  void         rememberVerdict(FrameVerdict v);
  uint8_t      countVerdict(FrameVerdict v) const;
  void         commitPending(double fraction);

  SpeedState state_        = SpeedState::NoRadar;
  uint32_t   stateSinceMs_ = 0;

  // 卡爾曼：x = [速度, 加速度]，P 對稱（只存三個元素）
  float    v_ = 0.0f, a_ = 0.0f;
  float    p00_ = 0.0f, p01_ = 0.0f, p11_ = 0.0f;
  uint32_t kfMs_         = 0;  // 狀態目前對應的時間
  uint32_t lastAcceptMs_ = 0;
  float    nis_ = 1.0f;        // 正規化創新平方的指數平均（加減速偵測）

  // 量測雜訊估計：最近兩筆地面量測與二階差分 |g[k] − 2g[k−1] + g[k−2]|
  float    prevG_[2]   = {};
  uint32_t prevGMs_[2] = {};
  uint8_t  prevGCount_ = 0;
  float    d2_[ground_tuning::kNoiseWindow] = {};
  uint8_t  d2Count_ = 0;
  uint8_t  d2Next_  = 0;

  float   outliers_[ground_tuning::kReinitOutliers] = {};
  uint8_t outlierCount_ = 0;

  // 擷取
  Sample     acq_[8]  = {};
  uint8_t    acqCount_ = 0;
  SpeedState beforeAcquire_ = SpeedState::Stopped;

  uint8_t staticRun_ = 0;  // 連續幾筆靜止回波

  // 里程
  double   distanceM_  = 0.0;
  double   pendingM_   = 0.0;  // 保持期間累積、尚未確定的距離
  uint32_t odoMs_      = 0;
  float    odoV_       = 0.0f;  // 上次積分時的速度（梯形積分）
  bool     odoStarted_ = false;

  // 最近 20 筆的判斷（品質指標）
  static constexpr uint8_t kVerdictWindow = 20;
  uint8_t  verdicts_[kVerdictWindow] = {};
  uint8_t  verdictCount_ = 0;
  uint8_t  verdictNext_  = 0;
  uint32_t frames_ = 0;
};
