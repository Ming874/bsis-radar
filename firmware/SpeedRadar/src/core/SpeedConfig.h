/*!
 * @file   SpeedConfig.h
 * @brief  【核心層】執行期可調整的參數：雷達安裝幾何、速度模型、校正係數、雷達門檻、輪周長，
 *         以及後方來車雷達（HLK-LD2451）的警示參數（RearConfig）。
 *
 * 由網頁或序列埠指令修改，儲存層存進 NVS（斷電不消失）。純邏輯，可在電腦上做單元測試。
 * 各參數的物理意義與建議值見 docs/ALGORITHM.md §4（安裝）、§6（估計器）；後方來車見 docs/REAR_RADAR.md。
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
// 後方來車（HLK-LD2451）
constexpr uint8_t  kRangeLoM    = 5;      // RANGE：警示距離（m，整數；LD2451 的距離解析度是 1 m）
constexpr uint8_t  kRangeHiM    = 50;
constexpr uint8_t  kRearSpdLo   = 1;      // RSPD：最低接近速度（km/h，整數；寫進 LD2451）
constexpr uint8_t  kRearSpdHi   = 30;
constexpr float    kTtcLoS      = 1.0f;   // TTC：到達時間低於這個值算危險（s）
constexpr float    kTtcHiS      = 6.0f;
constexpr uint8_t  kRearSnrLo   = 3;      // RSNR：LD2451 的訊噪比門檻（越大越不靈敏，原廠預設 4）
constexpr uint8_t  kRearSnrHi   = 8;
constexpr uint8_t  kRearDetectMarginM = 10;  // LD2451 的偵測距離 = RANGE + 10 m：車子進入警示距離前就先確認
constexpr uint8_t  kRearDetectLoM     = 10;  // LD2451 可設定的偵測距離 10～100 m
constexpr uint8_t  kRearDetectHiM     = 100;
}  // namespace limits

// 後方來車雷達（HLK-LD2451）的警示參數，原理與依據見 docs/REAR_RADAR.md
struct RearConfig {
  uint8_t rangeM;       // RANGE：確認的來車在這個距離內 → 注意
  uint8_t minSpeedKmh;  // RSPD ：接近速度低於這個值的目標，LD2451 不回報
  float   ttcS;         // TTC  ：到達時間 ≤ TTC（或距離 ≤ 5 m）→ 危險
  uint8_t snr;          // RSNR ：LD2451 的訊噪比門檻

  // 寫進 LD2451 的最大偵測距離（m）
  uint8_t detectRangeM() const;

  bool isValid() const;

  static RearConfig defaults();
};

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
  RearConfig rear;            // 後方來車雷達（RANGE、RSPD、TTC、RSNR）

  // 所有欄位都在允許範圍內才回傳 true（從 NVS 讀回時用來擋掉壞資料）
  bool isValid() const;
  // 只檢查對地測速的欄位（不含 rear）：讀回 NVS 時兩部分分開檢查，壞掉的後方設定不會連帶清掉校正係數
  bool speedFieldsValid() const;

  static SpeedConfig defaults();
};
