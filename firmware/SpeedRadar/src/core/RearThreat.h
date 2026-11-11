/*!
 * @file   RearThreat.h
 * @brief  【核心層】後方來車警示：由 LD2451 的目標判斷「有沒有車從後方接近、多危險」（純邏輯，可單元測試）。
 *
 * 雷達裝在行進中的腳踏車上、朝後：
 *   - 路面、路樹、停著的車相對雷達「遠離」（速度 = 腳踏車速）→ LD2451 設成「只回報靠近的目標」就濾掉了
 *   - 比腳踏車慢的車、對向車道的車（交會後）也是遠離 → 不算來車
 *   - 比腳踏車快、從後面追上來的車才是「靠近」：量到的速度就是接近速度（車速 − 腳踏車速）
 *
 * 每個資料框的處理：
 *   1. 候選：方向是靠近、速度 ≥ RSPD、距離 ≤ 偵測距離（RANGE + 10 m）
 *   2. 主要威脅：候選中到達時間（距離 ÷ 接近速度）最短的一個
 *   3. 確認：連續有候選的資料框累積到 2 筆才算來車（單一筆雜訊不警示）；沒有候選就扣分
 *   4. 追蹤：距離用 α 濾波（LD2451 的距離是整數公尺），接近速度用都卜勒（每筆都有、比距離差分準）；
 *      量測與預測差太多（閘門外）先當跳值（位元錯誤、反射點跳動）；連續 2 筆彼此一致的跳值才算換了一台車
 *   5. 核對：最近 1.5 秒的距離趨勢明確在「變遠」，就不是來車（防止方向判斷錯誤造成誤報）
 *   6. 分級：確認的來車 距離 ≤ 5 m 或到達時間 ≤ TTC → 危險；距離 ≤ RANGE → 注意
 *   7. 保持：來車從視野消失（通常是正在旁邊超車）後，警示再保持 1.5 秒
 * 完整說明與參數依據：docs/REAR_RADAR.md
 */
#pragma once
#include <stdint.h>

#include "RadarFrame.h"
#include "SpeedConfig.h"

enum class RearLevel : uint8_t {
  Safe    = 0,  // 安全：沒有確認的來車在警示範圍內
  Caution = 1,  // 注意：確認的來車在警示距離（RANGE）內接近
  Danger  = 2,  // 危險：即將到達（到達時間 ≤ TTC 或距離 ≤ 5 m）
};

struct RearState {
  RearLevel level      = RearLevel::Safe;
  bool      hasLead    = false;  // 正在追蹤一台確認的來車
  float     distanceM  = -1.0f;  // 來車距離（濾波後），沒有為 -1
  float     closingMps = 0.0f;   // 接近速度（m/s），沒有為 0
  float     ttcS       = -1.0f;  // 到達時間（s），無法估計為 -1
  bool      holding    = false;  // 警示保持中：來車已不在視野（正在旁邊超車，或停下來了）
  uint32_t  alerts     = 0;      // 開機後的警示次數（安全 → 注意／危險 算一次）
};

namespace rear_tuning {
constexpr uint8_t  kConfirmHits      = 2;       // 幾筆有候選的資料框才算確認
constexpr uint8_t  kEvidenceMax      = 4;       // 累積分數上限：漏資料時能撐幾筆
constexpr uint32_t kLeadLostMs       = 700;     // 多久沒有候選就放棄追蹤（LD2451 沒目標時可能完全不送資料框）
constexpr uint32_t kHoldMs           = 1500;    // 警示保持時間：車子超過去時會在旁邊一段時間
constexpr float    kDangerDistM      = 5.0f;    // 這麼近就一定算危險
constexpr float    kMinTtcSpeedMps   = 0.5f;    // 接近速度太小時不估算到達時間
constexpr float    kGateBaseM        = 3.0f;    // 關聯閘門：車身長，反射點會前後跳；再加上接近速度 × 經過時間
constexpr uint8_t  kSwitchHits       = 2;       // 連續幾筆彼此一致的跳值才換追蹤對象（單筆位元錯誤不會讓警示亂跳）
constexpr float    kAlphaRange       = 0.5f;    // 距離濾波
constexpr float    kAlphaSpeed       = 0.5f;    // 接近速度濾波（LD2451 的速度是整數 km/h）
constexpr float    kMaxDtS           = 0.5f;    // 預測最多往前推多久
// 距離趨勢核對
constexpr uint32_t kTrendWindowMs    = 1500;
constexpr uint8_t  kTrendMinCount    = 5;
constexpr float    kTrendMinSpanS    = 0.8f;
constexpr float    kTrendDecisiveMps = 1.5f;    // 斜率超過這個值才算「明確」靠近或遠離
}  // namespace rear_tuning

class RearThreat {
 public:
  // 每收到一個 LD2451 資料框呼叫一次
  void onFrame(const RadarFrame& frame, uint32_t nowMs, const RearConfig& cfg);

  // 每次 loop 都呼叫：處理「資料框停了」的逾時與警示保持
  void update(uint32_t nowMs, const RearConfig& cfg);

  // 雷達離線時清除（警示次數保留；等級若從警示變安全，consumeLevelChange() 會回報一次）
  void reset();

  const RearState& state() const { return state_; }

  // 等級從上次呼叫後有變化就回傳 true（用來立刻通知手機，不等下一次週期）
  bool consumeLevelChange();

  // 方向核對（診斷）：距離趨勢明確的追蹤，與方向位元組一致／相反的次數（每台車最多算一次）
  uint32_t trendAgree() const { return trendAgree_; }
  uint32_t trendDisagree() const { return trendDisagree_; }

 private:
  void startTrack(float rangeM, float closingMps, uint32_t nowMs);
  void dropTrack();
  void pushTrend(uint32_t nowMs, float rangeM);
  void evaluate(uint32_t nowMs, const RearConfig& cfg);

  RearState state_;
  RearLevel reported_ = RearLevel::Safe;

  uint8_t evidence_  = 0;
  bool    confirmed_ = false;

  bool     active_     = false;
  float    rangeM_     = 0.0f;
  float    closingMps_ = 0.0f;
  uint32_t trackMs_    = 0;  // 濾波器狀態對應的時間
  uint32_t lastLeadMs_ = 0;  // 最後一次關聯上量測
  uint8_t  outliers_      = 0;  // 連續、彼此一致的跳值筆數
  float    outlierRangeM_ = 0.0f;
  uint32_t outlierMs_     = 0;

  static constexpr uint8_t kTrendCap = 16;
  uint32_t trendMs_[kTrendCap] = {};
  float    trendRange_[kTrendCap] = {};
  uint8_t  trendCount_ = 0;
  bool     receding_   = false;  // 距離趨勢明確在變遠：不是來車
  bool     voted_      = false;

  bool     cautionSeen_   = false;
  bool     dangerSeen_    = false;
  uint32_t lastCautionMs_ = 0;
  uint32_t lastDangerMs_  = 0;

  uint32_t trendAgree_    = 0;
  uint32_t trendDisagree_ = 0;
};
