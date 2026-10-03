/*!
 * @file   ThreatTracker.h
 * @brief  【核心層】後方來車判斷演算法（純邏輯，可在電腦上做單元測試）。
 *
 * 每筆雷達量測的處理流程：
 *   1. 篩選：要「正在接近」（接近速度 ≥ 門檻）、反射能量夠大、距離在追蹤範圍內
 *   2. 確認：合格資料累積到 CONFIRM 筆才算來車（漏一筆只扣分、不歸零）
 *   3. 追蹤：用雷達量到的都卜勒速度「預測」下一刻距離，再用量測距離「修正」
 *            → 比單純平滑反應快，沒有延遲；突然跳很遠的單筆會被擋掉
 *   4. 分級：進入警示距離 RANGE → 注意；到達時間 ≤ DTTC 或距離 ≤ DDIST → 危險
 *   5. 保持：目標消失後，警示再保持 HOLD 毫秒（車子剛超過去、正在旁邊）
 */
#pragma once
#include <stdint.h>

#include "DetectionConfig.h"
#include "MedianWindow.h"
#include "RadarMeasurement.h"

enum class AlertLevel : uint8_t {
  Safe    = 0,  // 安全
  Caution = 1,  // 注意：確認有車在警示距離內接近
  Danger  = 2,  // 危險：即將到達
};

// 演算法對外輸出的結果
struct ThreatState {
  AlertLevel level      = AlertLevel::Safe;
  bool       tracking   = false;  // 是否正在追蹤一台已確認的來車
  float      distanceM  = -1.0f;  // 追蹤距離（m），沒目標為 -1
  float      closingMps = 0.0f;   // 接近速度（m/s），正值 = 越來越近
  float      ttcS       = -1.0f;  // 到達時間 Time-To-Contact（s），無法估計為 -1

  bool warning() const { return level != AlertLevel::Safe; }
};

// 演算法調校參數（集中放這裡，改完重新燒錄）
// 演算法內部參數（改完要重新燒錄）。
// 確認筆數、危險 TTC、危險距離、警示保持時間在 DetectionConfig，可用網頁即時調整。
namespace tuning {
constexpr float    kMinRangeM      = 0.3f;   // 追蹤距離下限（m），雷達近距離盲區
constexpr float    kMaxTrackRangeM = 20.0f;  // 追蹤距離上限（m）：比警示距離遠，車子進 15 m 前就先確認
constexpr uint8_t  kEvidenceMax    = 6;      // 累積分數上限（漏資料時能撐幾筆）
constexpr uint32_t kTrackLostMs    = 800;    // 多久沒有合格資料就放棄追蹤（ms）
constexpr float    kGateM          = 2.5f;   // 量測與預測相差超過此值 → 視為跳值（m）
constexpr uint8_t  kGateResetHits  = 3;      // 連續跳值幾筆 → 改相信量測（換了一個目標）
constexpr float    kDistAlpha      = 0.5f;   // 距離修正權重 0~1，越大越相信量測
constexpr float    kSpeedAlpha     = 0.5f;   // 速度平滑係數 0~1，越小越平滑
constexpr float    kMinTtcSpeedMps = 0.3f;   // 接近速度太小時不估算 TTC
constexpr float    kMaxDtS         = 0.5f;   // 預測時最多往前推多久（s），避免長時間沒資料時亂猜
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
  void registerMiss();
  void updateTrack(float rangeM, uint32_t nowMs);
  void dropTrack();
  void evaluate(uint32_t nowMs, const DetectionConfig& cfg, bool freshData);

  ThreatState               state_;
  MedianWindow<uint32_t, 5> energyWindow_;
  uint32_t                  energyMedian_   = 0;
  float                     closingSmooth_  = 0.0f;
  bool                      hasSpeed_       = false;
  uint8_t                   evidence_       = 0;
  bool                      confirmed_      = false;
  bool                      tracking_       = false;
  float                     trackDistM_     = -1.0f;
  uint8_t                   outliers_       = 0;
  uint32_t                  lastTrackMs_    = 0;
  uint32_t                  lastCandidateMs_ = 0;
  uint32_t                  lastWarnMs_     = 0;
  AlertLevel                reportedLevel_  = AlertLevel::Safe;
};
