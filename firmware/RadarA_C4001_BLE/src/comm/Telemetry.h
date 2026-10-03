/*!
 * @file   Telemetry.h
 * @brief  【通訊層】傳給手機網頁的文字格式（純 C++，可單元測試）。
 *
 * 遙測（每 200 ms，警示等級改變時立即送）：
 *   R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35
 *   R 雷達連線   W 警示(0/1)   L 等級 0 安全 / 1 注意 / 2 危險
 *   D 追蹤距離 m（沒目標 -1）   V 接近速度 m/s（正 = 接近）   TTC 到達時間 s（無 -1）
 *   N/RD/RV 最新一筆雷達原始資料（目標數 / 距離 / 速度）   E 能量中位數   T 開機秒數
 *
 * 設定回覆：CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 FW=2.0.0
 *
 * 每行以 '\n' 結尾；藍牙會依 MTU 分段送出，網頁端收到 '\n' 才算一行。
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../core/DetectionConfig.h"
#include "../core/RadarMeasurement.h"
#include "../core/ThreatTracker.h"

// 一行文字的緩衝區大小（含結尾 '\n' 與 '\0'）；呼叫端一律用這兩個常數，單元測試會檢查最長的情況放得下
constexpr size_t kTelemetryLineMax = 128;
constexpr size_t kConfigLineMax    = 160;

struct TelemetrySnapshot {
  bool             radarOnline = false;
  ThreatState      threat;
  bool             hasRaw = false;  // 是否有最新一筆原始資料
  RadarMeasurement raw;
  uint32_t         energyMedian = 0;
  uint32_t         uptimeS      = 0;
};

// 回傳寫入的字元數（含結尾 '\n'），空間不足時回傳 0
size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap);
size_t formatConfig(const DetectionConfig& c, const char* firmwareVersion, char* out, size_t cap);
