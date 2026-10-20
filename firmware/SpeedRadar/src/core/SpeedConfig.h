/*!
 * @file   SpeedConfig.h
 * @brief  【核心層】執行期可調整的參數：雷達安裝幾何、速度模型、校正係數、雷達門檻、輪周長。
 *
 * 由網頁或序列埠指令修改，儲存層存進 NVS（斷電不消失）。純邏輯，可在電腦上做單元測試。
 * 各參數的物理意義與建議值見 docs/ALGORITHM.md §4（安裝）、§6（估計器）。
 */
#pragma once
#include <stdint.h>

namespace limits {
constexpr float    kAngleLoDeg  = 15.0f;  // ANGLE：俯角（雷達視軸與水平面的夾角）
constexpr float    kAngleHiDeg  = 75.0f;
constexpr float    kHeightLoM   = 0.15f;  // HEIGHT：雷達離地高度
constexpr float    kHeightHiM   = 1.50f;
constexpr float    kCalLo       = 0.50f;  // CAL：校正係數（速度 × CAL）
constexpr float    kCalHi       = 2.00f;
constexpr uint8_t  kRadarThrLo  = 1;      // RTHR：C4001 偵測門檻（setThrFactor，原廠預設 5）
constexpr uint8_t  kRadarThrHi  = 50;
constexpr uint16_t kWheelMmLo   = 1000;   // WHEEL：輪周長（mm），只給參考用的輪速感測器
constexpr uint16_t kWheelMmHi   = 3000;
constexpr float    kVmaxLo      = 2.0f;   // VMAX：C4001 的徑向測速上限（m/s）
constexpr float    kVmaxHi      = 20.0f;
}  // namespace limits

// 由單筆量測換算對地速度的方式
enum class SpeedModel : uint8_t {
  FixedAngle    = 0,  // v = |vr| / cos(ANGLE)：傳統單波束都卜勒測速儀的作法
  RangeGeometry = 1,  // v = |vr| / cos(α)，sin α = HEIGHT / 量到的距離：每一筆用自己的俯角（FMCW 才做得到）
};

struct SpeedConfig {
  float      angleDeg;        // ANGLE ：視軸俯角（度），手機水平儀量
  float      heightM;         // HEIGHT：雷達天線離地高度（m）
  int8_t     direction;       // DIR   ：+1 = 雷達朝後（往前騎時地面遠離，C4001 回報正值）；-1 = 朝前
  SpeedModel model;           // MODEL ：0 固定角度、1 距離幾何
  float      calibration;     // CAL   ：校正係數，校正流程算出來（docs/ALGORITHM.md §7）
  uint8_t    radarThreshold;  // RTHR  ：寫進 C4001 的偵測門檻，越大越不靈敏
  uint16_t   wheelMm;         // WHEEL ：輪周長（mm），輪速感測器（參考值）用
  float      radialLimitMps;  // VMAX  ：C4001 徑向速度的上限（m/s），超過時雷達可能截斷或折疊（docs/ALGORITHM.md §2）

  // 所有欄位都在允許範圍內才回傳 true（從 NVS 讀回時用來擋掉壞資料）
  bool isValid() const;

  static SpeedConfig defaults();
};
