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
 * 後方來車（HLK-LD2451，另外一行；有目標或警示中每 0.1 秒、平常每 0.5 秒、等級改變時立刻送）：
 *   REAR ON=1 RO=0 LV=1 D=12.4 V=4.17 TTC=3.0 HOLD=0 N=2 CNT=3 FN=812 X=-3/12/15,6/31/40
 *   ON 雷達在線   RO 只接收（指令沒有回覆，設定沒寫進雷達）   LV 警示等級（RearLevel）
 *   D/V/TTC 主要來車的距離 m / 接近速度 m/s / 到達時間 s（沒有為 -1 / 0 / -1）   HOLD 警示保持中
 *   N 這個資料框的目標數   CNT 開機後的警示次數   FN 後方雷達資料框序號
 *   X 這個資料框的目標：角度°/距離 m/速度 km/h（正 = 靠近、負 = 遠離），以逗號分隔（沒有目標時不送）
 *
 * 設定：CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=3.28 RMIN=0.62 RMAX=2.15
 *           RANGE=15 RSPD=5 TTC=2.5 RSNR=4 RDET=25 FW=3.1.0（實際是一行）
 *   RMIN/RMAX 是由 ANGLE、HEIGHT 算出的地面距離窗口、RDET 是寫進 LD2451 的偵測距離（RANGE + 10），都是唯讀
 *
 * 每行以 '\n' 結尾；藍牙依 MTU 分段送出，網頁端收到 '\n' 才算一行。最長的一行也放得進一個通知（單元測試會檢查）。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../core/GroundSpeedEstimator.h"
#include "../core/RadarMeasurement.h"
#include "../core/RearFrame.h"
#include "../core/RearThreat.h"
#include "../core/SpeedConfig.h"

// 一行文字的緩衝區大小（含結尾 '\n' 與 '\0'）；單元測試會檢查最長的情況放得下
constexpr size_t kTelemetryLineMax = 176;
constexpr size_t kConfigLineMax    = 176;
constexpr size_t kRearLineMax      = 176;

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

struct RearSnapshot {
  bool      online      = false;
  bool      receiveOnly = false;
  RearState state;
  uint32_t  frame    = 0;      // 後方雷達資料框序號
  bool      hasFrame = false;  // 有沒有最新（1 秒內）的資料框
  RearFrame raw;
};

// 回傳寫入的字元數（含結尾 '\n'），空間不足時回傳 0
size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap);
size_t formatRear(const RearSnapshot& s, char* out, size_t cap);
size_t formatConfig(const SpeedConfig& c, const char* firmwareVersion, char* out, size_t cap);
