/*!
 * @file   VelocityCheck.h
 * @brief  【核心層】都卜勒速度 × 距離變化率 交叉核對：決定這一筆要不要用都卜勒、用哪個解釋。
 *
 * 為什麼要核對：
 *   - 都卜勒速度很精確（±0.1 m/s 等級），但 C4001 只能量 ±10 m/s；更快的車速度會「折疊」
 *     （例如真實 −13 m/s 被報成 +7 m/s，看起來像在遠離），只看都卜勒就會漏掉這台車。
 *   - 速度卡在量測上限（飽和）、SIGN 設反、偶發雜訊、雷達報 0 速度，也會讓判斷出錯。
 *   - 距離變化率（距離的最小平方斜率）雜訊較大，但不會折疊、也沒有正負號問題，適合當「裁判」。
 *
 * 作法（追蹤器的標準流程，完整說明與參考文獻見 docs/ALGORITHM.md）：
 *   1. 假設：預設解釋（依 SIGN、不折疊）、折疊 ±V、正負號相反（以及相反後再折疊）。
 *      同一個目標的正負號不會中途改變：一旦明確判斷出來就鎖定，之後只在該正負號下考慮折疊。
 *   2. 參考速度：都卜勒已確認可信 → 卡爾曼預測（精確）；否則 → 距離斜率（獨立、較粗、含落後誤差）。
 *   3. 驗證閘門：|假設 − 參考| ≤ g·√(σ參考² + σ都卜勒²) + 容許量；預設解釋優先，多個假設都符合時
 *      依「預設 > 折疊 > 正負號相反」選擇，只有唯一符合時才鎖定正負號。
 *   4. 長期核對：同一時間窗內「距離斜率」與「採用的都卜勒平均」必須一致（兩者都代表窗中點速度，
 *      不受加減速影響）。連續不一致 → 改用距離變化率（濾波器直接改成最小平方擬合結果）；
 *      連續一致 → 恢復使用都卜勒（遲滯，避免來回切換）。
 *   5. 量測上限附近（|v| ≥ 9.8 m/s）的都卜勒可能飽和或剛好在折疊邊界，不採用；持續卡在上限就改用距離變化率。
 */
#pragma once
#include <stdint.h>

#include "RangeRateWindow.h"

// 目前的速度從哪裡來（也會送到網頁：VS 欄位）
enum class VelocitySource : uint8_t {
  None      = 0,  // 沒有追蹤目標
  Checking  = 1,  // 追蹤剛開始，距離資料還不夠核對，暫時直接用都卜勒
  Doppler   = 2,  // 都卜勒與距離變化率一致（最精確）
  Unfolded  = 3,  // 都卜勒超出量測範圍而折疊，已依距離變化率還原
  RangeRate = 4,  // 都卜勒與距離變化率不一致（或卡在量測上限），改用距離變化率
  SignFlip  = 5,  // 都卜勒正負號與距離變化率相反：已自動反過來用，請檢查 SIGN 設定
};

namespace velocity_tuning {
constexpr float   kDopplerSigmaMps = 0.2f;   // 都卜勒量測標準差（m/s）
constexpr float   kMaxDopplerMps   = 10.0f;  // C4001 規格的最大可量測速度（m/s）
constexpr float   kWrapMps         = 2.0f * kMaxDopplerMps;  // 折疊週期
constexpr float   kEdgeMps         = 9.8f;   // 這個值以上視為「卡在上限 / 折疊邊界」，不採用
constexpr float   kGateSigma       = 3.0f;   // 驗證閘門：3σ（常態分布約 99.7%）
constexpr float   kGateTolMps      = 0.3f;   // 模型誤差容許量（m/s）
constexpr float   kAccelSigma      = 3.0f;   // 相對加速度標準差（m/s²）：斜率落後最新一刻造成的誤差
constexpr uint8_t kFailToDistrust  = 2;      // 連續幾次不一致 → 改用距離變化率
constexpr uint8_t kPassToTrust     = 3;      // 連續幾次一致 → 恢復使用都卜勒
constexpr uint8_t kEdgeToDistrust  = 3;      // 連續幾筆卡在上限 → 改用距離變化率
}  // namespace velocity_tuning

struct VelocityDecision {
  bool    useDoppler = false;  // 這一筆要不要把都卜勒當量測更新卡爾曼濾波器
  float   rate       = 0.0f;   // 採用的 ṙ（已還原折疊 / 正負號）
  bool    resetRate  = false;  // 卡爾曼的速度直接改成 resetValue（剛換解釋）
  float   resetValue = 0.0f;
  float   resetVar   = 0.0f;
  bool    resetToFit = false;  // 卡爾曼的距離與速度都改成 fit（剛判定都卜勒不可信）
  RateFit fit;
};

class VelocityCheck {
 public:
  void reset();

  // dopplerRate：依 SIGN 換算的 ṙ（負 = 接近）；signKnown = (SIGN ≠ 0)。SIGN = 0 時傳 −|v|，方向由核對決定。
  // coarse / fine：短窗 / 長窗的距離斜率；kfRate / kfRateVar：卡爾曼目前的 ṙ 與變異數
  VelocityDecision evaluate(float dopplerRate, bool signKnown, const RateFit& coarse, const RateFit& fine, float kfRate,
                            float kfRateVar);

  VelocitySource source() const { return source_; }

 private:
  enum class Hypothesis : uint8_t { Default, FoldUp, FoldDown, Flip, FlipFoldUp, FlipFoldDown };
  enum class SignState : uint8_t { Unknown, Normal, Flipped };

  void distrust(const RateFit& coarse, const RateFit& fine, bool resetFilter, VelocityDecision& d);

  bool           trusted_   = false;  // 都卜勒已確認可信（參考速度改用卡爾曼預測）
  bool           distrust_  = false;  // 都卜勒確認不可信（只用距離變化率）
  uint8_t        passes_    = 0;
  uint8_t        fails_     = 0;
  uint8_t        edgeRun_   = 0;      // 連續幾筆卡在量測上限
  SignState      sign_      = SignState::Unknown;
  Hypothesis     lastHyp_   = Hypothesis::Default;
  VelocitySource source_    = VelocitySource::None;
};
