#include "Telemetry.h"

#include <stdio.h>

namespace {

size_t finish(int written, size_t cap) {
  if (written < 0 || static_cast<size_t>(written) >= cap) return 0;  // 被截斷就當失敗，不送半行
  return static_cast<size_t>(written);
}

// 夾在範圍內，欄位長度才固定在緩衝區放得下的範圍
float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap) {
  const ThreatState& t      = s.threat;
  const bool         online = s.radarOnline;
  const bool         raw    = online && s.hasRaw && s.raw.targets > 0;

  // 距離變化率只在資料足夠時才送（夾在 ±99.99，欄位長度固定在範圍內）
  char rr[16] = "";
  if (online && t.hasRangeRate) snprintf(rr, sizeof(rr), " RR=%.2f", clampf(t.rangeRateMps, -99.99f, 99.99f));

  // 目前追蹤的目標（不論是不是來車）只在有追蹤時才送
  char track[32] = "";
  if (online && t.hasTrack) {
    snprintf(track, sizeof(track), " TD=%.2f TV=%.2f", clampf(t.trackDistanceM, 0.0f, 99.99f),
             clampf(t.trackClosingMps, -99.99f, 99.99f));
  }

  // 自身車速和雷達無關：雷達離線時照樣送
  char own[16] = "";
  if (s.hasOwnSpeed) snprintf(own, sizeof(own), " S=%.1f", clampf(s.ownSpeedKmh, 0.0f, 999.9f));

  const int n = snprintf(out, cap, "R=%d W=%d L=%d D=%.2f V=%.2f TTC=%.1f N=%u RD=%.2f RV=%.2f E=%lu T=%lu VS=%u%s%s%s\n",
                         online ? 1 : 0,
                         t.warning() ? 1 : 0,
                         static_cast<int>(t.level),
                         t.distanceM,
                         t.closingMps,
                         t.ttcS,
                         raw ? static_cast<unsigned>(s.raw.targets) : 0U,
                         raw ? s.raw.rangeM : -1.0f,
                         raw ? s.raw.speedMps : 0.0f,
                         online ? static_cast<unsigned long>(s.energyMedian) : 0UL,
                         static_cast<unsigned long>(s.uptimeS),
                         online ? static_cast<unsigned>(t.velocitySource) : 0U,
                         rr,
                         track,
                         own);
  return finish(n, cap);
}

size_t formatConfig(const DetectionConfig& c, const char* firmwareVersion, char* out, size_t cap) {
  const int n = snprintf(out, cap,
                         "CFG TEST=%d MINSPD=%.2f MINE=%lu RANGE=%.1f SIGN=%d DTTC=%.1f DDIST=%.1f HOLD=%u CONFIRM=%u RTHR=%u WHEEL=%u FW=%s\n",
                         c.testMode ? 1 : 0,
                         c.minSpeedMps,
                         static_cast<unsigned long>(c.minEnergy),
                         c.warnRangeM,
                         static_cast<int>(c.approachSign),
                         c.dangerTtcS,
                         c.dangerDistM,
                         static_cast<unsigned>(c.holdMs),
                         static_cast<unsigned>(c.confirmHits),
                         static_cast<unsigned>(c.radarThreshold),
                         static_cast<unsigned>(c.wheelMm),
                         firmwareVersion);
  return finish(n, cap);
}
