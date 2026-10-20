/*!
 * @file   Telemetry.h
 * @brief  【通訊層】傳給網頁的文字格式（純 C++，可單元測試）。完整欄位定義見 docs/PROTOCOL.md。
 *
 * 遙測：每一筆雷達資料框送一行（約 10 Hz）；雷達沒有資料時每 250 ms 送一行心跳（FN 不變）。
 *   R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.5 W=5.51 DW=1240.2 T=812
 *   R  雷達在線        ST 估計器狀態（SpeedState）   V 對地速度 m/s（未知 -1）   SD 1σ 不確定度 m/s
 *   Q  最近 20 筆可用量測比例 %   WD 最近 20 筆方向相反的比例 %   FN 資料框序號
 *   N/RD/RV/E 這一筆的原始資料（目標數 / 距離 m / 徑向速度 m/s / 能量）
 *   G  這一筆換算的對地速度（濾波前，沒算 -1）   FV 這一筆的判斷（FrameVerdict）
 *   DR 雷達里程 m（開機起）   W/DW 輪速感測器的速度 m/s / 里程 m（收過脈衝才送）   T 開機秒數
 *
 * 設定：CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=3.28 RMIN=0.62 RMAX=2.15 FW=3.0.0
 *   RMIN/RMAX 是由 ANGLE、HEIGHT 算出的地面距離窗口（唯讀）
 *
 * 每行以 '\n' 結尾；藍牙依 MTU 分段送出，網頁端收到 '\n' 才算一行。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../core/GroundSpeedEstimator.h"
#include "../core/RadarMeasurement.h"
#include "../core/SpeedConfig.h"

// 一行文字的緩衝區大小（含結尾 '\n' 與 '\0'）；單元測試會檢查最長的情況放得下
constexpr size_t kTelemetryLineMax = 176;
constexpr size_t kConfigLineMax    = 144;

struct TelemetrySnapshot {
  bool             radarOnline = false;
  SpeedState       state       = SpeedState::NoRadar;
  bool             hasSpeed    = false;
  float            speedMps    = 0.0f;
  float            sigmaMps    = 0.0f;
  uint8_t          qualityPct  = 0;
  uint8_t          wrongDirPct = 0;
  uint32_t         frame       = 0;      // 資料框序號（心跳時不變，網頁用來去除重複）
  bool             hasFrame    = false;  // 有沒有最新一筆資料框
  RadarMeasurement raw;
  FrameResult      result;
  double           radarDistanceM = 0.0;
  bool             hasWheel       = false;  // 有接輪速感測器（開機後收過脈衝）
  float            wheelMps       = 0.0f;
  double           wheelDistanceM = 0.0;
  uint32_t         uptimeS        = 0;
};

// 回傳寫入的字元數（含結尾 '\n'），空間不足時回傳 0
size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap);
size_t formatConfig(const SpeedConfig& c, const char* firmwareVersion, char* out, size_t cap);
