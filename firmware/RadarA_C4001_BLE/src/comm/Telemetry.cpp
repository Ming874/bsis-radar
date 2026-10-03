#include "Telemetry.h"

#include <stdio.h>

namespace {

size_t finish(int written, size_t cap) {
  if (written < 0 || static_cast<size_t>(written) >= cap) return 0;  // 被截斷就當失敗，不送半行
  return static_cast<size_t>(written);
}

}  // namespace

size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap) {
  const ThreatState& t      = s.threat;
  const bool         online = s.radarOnline;
  const bool         raw    = online && s.hasRaw && s.raw.targets > 0;

  // 距離變化率只在資料足夠時才送（夾在 ±99.99，欄位長度固定在範圍內）
  char rr[16] = "";
  if (online && t.hasRangeRate) {
    float v = t.rangeRateMps;
    if (v > 99.99f) v = 99.99f;
    if (v < -99.99f) v = -99.99f;
    snprintf(rr, sizeof(rr), " RR=%.2f", v);
  }

  const int n = snprintf(out, cap, "R=%d W=%d L=%d D=%.2f V=%.2f TTC=%.1f N=%u RD=%.2f RV=%.2f E=%lu T=%lu VS=%u%s\n",
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
                         rr);
  return finish(n, cap);
}

size_t formatConfig(const DetectionConfig& c, const char* firmwareVersion, char* out, size_t cap) {
  const int n = snprintf(out, cap,
                         "CFG TEST=%d MINSPD=%.2f MINE=%lu RANGE=%.1f SIGN=%d DTTC=%.1f DDIST=%.1f HOLD=%u CONFIRM=%u FW=%s\n",
                         c.testMode ? 1 : 0,
                         c.minSpeedMps,
                         static_cast<unsigned long>(c.minEnergy),
                         c.warnRangeM,
                         static_cast<int>(c.approachSign),
                         c.dangerTtcS,
                         c.dangerDistM,
                         static_cast<unsigned>(c.holdMs),
                         static_cast<unsigned>(c.confirmHits),
                         firmwareVersion);
  return finish(n, cap);
}
