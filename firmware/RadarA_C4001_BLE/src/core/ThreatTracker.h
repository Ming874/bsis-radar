/*!
 * @file   ThreatTracker.h
 * @brief  【核心層】後方來車判斷演算法（純邏輯，可在電腦上做單元測試）。
 *
 * 每筆雷達量測的處理流程：
 *   1. 關聯：量測距離與卡爾曼預測相差太多（驗證閘門外）視為跳值；連續跳值代表換了目標，重新追蹤
 *   2. 追蹤：卡爾曼濾波器（狀態 = 距離、距離變化率）融合「距離」與「都卜勒速度」
 *   3. 交叉核對：都卜勒速度必須與「距離變化率（距離的斜率）」一致才採用；
 *      折疊、正負號相反會自動還原，不一致就改用距離變化率（見 VelocityCheck.h）
 *   4. 確認：正在接近（接近速度 ≥ 門檻）、能量夠大的資料累積到 CONFIRM 筆才算來車（漏一筆只扣分）
 *   5. 分級：進入警示距離 RANGE → 注意；到達時間 ≤ DTTC 或距離 ≤ DDIST → 危險
 *   6. 保持：目標消失後，警示再保持 HOLD 毫秒（車子剛超過去、正在旁邊）
 * 完整說明與參考文獻：docs/ALGORITHM.md
 */
#pragma once
#include <stdint.h>

#include "DetectionConfig.h"
#include "MedianWindow.h"
#include "RadarMeasurement.h"
#include "RangeKalman.h"
#include "RangeRateWindow.h"
#include "VelocityCheck.h"

enum class AlertLevel : uint8_t {
  Safe    = 0,  // 安全
  Caution = 1,  // 注意：確認有車在警示距離內接近
  Danger  = 2,  // 危險：即將到達
};

// 演算法對外輸出的結果
struct ThreatState {
  AlertLevel     level          = AlertLevel::Safe;
  bool           tracking       = false;  // 是否正在追蹤一台已確認的來車
  float          distanceM      = -1.0f;  // 追蹤距離（m），沒目標為 -1
  float          closingMps     = 0.0f;   // 接近速度（m/s），正值 = 越來越近
  float          ttcS           = -1.0f;  // 到達時間 Time-To-Contact（s），無法估計為 -1
  VelocitySource velocitySource = VelocitySource::None;  // 速度來源 / 交叉核對結果
  bool           hasRangeRate   = false;  // 下一個欄位是否有效
  float          rangeRateMps   = 0.0f;   // 由距離斜率算出的接近速度（m/s，正值 = 接近），對照用

  bool warning() const { return level != AlertLevel::Safe; }
};

// 演算法內部參數（改完要重新燒錄）。
// 確認筆數、危險 TTC、危險距離、警示保持時間在 DetectionConfig，可用網頁即時調整。
namespace tuning {
constexpr float    kMinRangeM       = 0.3f;    // 追蹤距離下限（m），雷達近距離盲區
constexpr float    kMaxTrackRangeM  = 20.0f;   // 追蹤距離上限（m）：比警示距離遠，車子進 15 m 前就先確認
constexpr uint8_t  kEvidenceMax     = 6;       // 累積分數上限（漏資料時能撐幾筆）
constexpr uint32_t kTrackLostMs     = 800;     // 多久沒有關聯到量測就放棄追蹤（ms）
constexpr float    kMinTtcSpeedMps  = 0.3f;    // 接近速度太小時不估算 TTC
constexpr float    kMaxDtS          = 0.5f;    // 預測時最多往前推多久（s），避免長時間沒資料時亂猜
// 卡爾曼濾波器
constexpr float    kRangeSigmaM     = 0.2f;    // 距離量測標準差（m）：含車身反射點飄移
constexpr float    kAccelSigma      = 3.0f;    // 相對加速度標準差（m/s²）：煞車、加速
constexpr float    kInitRateSigma   = 6.0f;    // 新追蹤的速度不確定度（m/s）：都卜勒還沒核對前不完全相信
// 關聯閘門
constexpr float    kGateSigma       = 3.0f;    // 距離驗證閘門 3σ
constexpr float    kGateMinM        = 1.2f;    // 閘門下限（m）：車身長，最強反射點會前後跳
constexpr float    kGateMaxM        = 3.0f;    // 閘門上限（m）
constexpr float    kMaxClosingMps   = 25.0f;   // 速度還沒核對時，用物理上限估閘門（約 90 km/h 相對速度）
constexpr uint8_t  kGateResetHits   = 3;       // 連續幾筆「彼此一致」的跳值 → 換了一個目標，重新追蹤
// 距離變化率（最小平方斜率）
constexpr uint32_t kCoarseWindowMs  = 600;     // 短窗：快速判斷折疊 / 正負號
constexpr uint8_t  kCoarseMinCount  = 3;
constexpr float    kCoarseMinSpanS  = 0.15f;
constexpr uint32_t kFineWindowMs    = 1000;    // 長窗：長期一致性核對
constexpr uint8_t  kFineMinCount    = 6;
constexpr float    kFineMinSpanS    = 0.45f;
}  // namespace tuning

class ThreatTracker {
 public:
  // 每收到一筆雷達量測就呼叫一次
  void onMeasurement(const RadarMeasurement& m, uint32_t nowMs, const DetectionConfig& cfg);

  // 每次 loop 都呼叫：處理「資料停了」的逾時（目標消失、警示保持結束）
  void update(uint32_t nowMs, const DetectionConfig& cfg);

  // 雷達離線或設定改變時清除所有狀態
  void reset();

  const ThreatState& state() const { return state_; }
  uint32_t energyMedian() const { return energyMedian_; }

  // 警示等級從上次呼叫後有變化就回傳 true（用來「立刻」通知手機，不等下一個週期）
  bool consumeLevelChange();

 private:
  enum class Association : uint8_t { Rejected, Updated, NewTrack };
  Association associate(float rangeM, float dopplerRate, uint32_t nowMs);
  void startTrack(float rangeM, float dopplerRate, uint32_t nowMs);
  void coast(uint32_t nowMs);
  void registerMiss();
  void dropTrack();
  void evaluate(uint32_t nowMs, const DetectionConfig& cfg, bool freshData);

  ThreatState               state_;
  MedianWindow<uint32_t, 5> energyWindow_;
  uint32_t                  energyMedian_ = 0;

  RangeKalman     kf_;
  RangeRateWindow window_;
  VelocityCheck   velocity_;
  float           closing_       = 0.0f;  // 目前採用的接近速度（m/s，正 = 接近）
  bool            hasRangeRate_  = false;
  float           rangeRate_     = 0.0f;  // 距離斜率換算的接近速度

  uint8_t  evidence_         = 0;
  bool     confirmed_        = false;
  uint8_t  outliers_         = 0;  // 連續、彼此一致的跳值筆數
  float    outlierRangeM_    = 0.0f;  // 上一筆跳值的距離與時間（判斷跳值之間是否一致）
  uint32_t outlierMs_        = 0;
  uint32_t lastTrackMs_      = 0;  // 濾波器狀態對應的時間
  uint32_t lastAssociatedMs_ = 0;  // 最後一次關聯到量測
  uint32_t lastCandidateMs_  = 0;  // 最後一次「合格（正在接近）」的量測
  uint32_t lastWarnMs_       = 0;
  AlertLevel reportedLevel_  = AlertLevel::Safe;
};
