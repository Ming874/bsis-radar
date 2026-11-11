#include "Telemetry.h"

#include <stdio.h>

namespace {

size_t finish(int written, size_t cap) {
  if (written < 0 || static_cast<size_t>(written) >= cap) return 0;  // 被截斷就當失敗，不送半行
  return static_cast<size_t>(written);
}

// 夾在範圍內，欄位長度才固定在緩衝區放得下的範圍
float  clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
double clampd(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }

}  // namespace

size_t formatTelemetry(const TelemetrySnapshot& s, char* out, size_t cap) {
  const bool online = s.radarOnline;
  const bool frame  = online && s.hasFrame;
  const bool target = frame && s.raw.targets > 0;
  const bool ground = frame && s.result.hasGround;

  // 輪速和雷達無關：雷達離線時照樣送
  char wheel[40] = "";
  if (s.hasWheel) {
    snprintf(wheel, sizeof(wheel), " W=%.2f DW=%.1f", clampf(s.wheelMps, 0.0f, 99.99f),
             clampd(s.wheelDistanceM, 0.0, 9999999.9));
  }

  const int n = snprintf(
      out, cap,
      "R=%d ST=%u V=%.2f SD=%.2f Q=%u WD=%u FN=%lu N=%u RD=%.2f RV=%.2f E=%lu G=%.2f FV=%u DR=%.1f%s T=%lu\n",
      online ? 1 : 0,
      static_cast<unsigned>(online ? s.state : SpeedState::NoRadar),
      online && s.hasSpeed ? clampf(s.speedMps, 0.0f, 99.99f) : -1.0f,
      online && s.hasSpeed ? clampf(s.sigmaMps, 0.0f, 99.99f) : 0.0f,
      static_cast<unsigned>(online ? s.qualityPct : 0),
      static_cast<unsigned>(online ? s.wrongDirPct : 0),
      static_cast<unsigned long>(s.frame),
      target ? static_cast<unsigned>(s.raw.targets) : 0U,
      target ? clampf(s.raw.rangeM, 0.0f, 99.99f) : -1.0f,
      target ? clampf(s.raw.speedMps, -99.99f, 99.99f) : 0.0f,
      target ? static_cast<unsigned long>(s.raw.energy) : 0UL,
      ground ? clampf(s.result.groundMps, 0.0f, 99.99f) : -1.0f,
      static_cast<unsigned>(frame ? s.result.verdict : FrameVerdict::NoTarget),
      clampd(s.radarDistanceM, 0.0, 9999999.9),
      wheel,
      static_cast<unsigned long>(s.uptimeS));
  return finish(n, cap);
}

size_t formatRear(const RearSnapshot& s, char* out, size_t cap) {
  if (!s.online) return finish(snprintf(out, cap, "REAR ON=0\n"), cap);

  // 目標列表：角度/距離/速度（正 = 靠近）
  char targets[80] = "";
  if (s.hasFrame && s.raw.count > 0) {
    size_t used = 0;
    const uint8_t n = s.raw.count < kRearMaxTargets ? s.raw.count : kRearMaxTargets;
    for (uint8_t i = 0; i < n; i++) {
      const RearTarget& t = s.raw.targets[i];
      const int speed = t.approaching() ? t.speedKmh : -static_cast<int>(t.speedKmh);
      const int w = snprintf(targets + used, sizeof(targets) - used, "%s%d/%u/%d", i == 0 ? " X=" : ",",
                             static_cast<int>(t.angleDeg), static_cast<unsigned>(t.distanceM), speed);
      if (w < 0 || static_cast<size_t>(w) >= sizeof(targets) - used) break;
      used += static_cast<size_t>(w);
    }
  }

  const RearState& r    = s.state;
  const bool       lead = r.hasLead;
  const int n = snprintf(out, cap, "REAR ON=1 RO=%d LV=%u D=%.1f V=%.2f TTC=%.1f HOLD=%d N=%u CNT=%lu FN=%lu%s\n",
                         s.receiveOnly ? 1 : 0,
                         static_cast<unsigned>(r.level),
                         lead ? clampf(r.distanceM, 0.0f, 999.9f) : -1.0f,
                         lead ? clampf(r.closingMps, 0.0f, 99.99f) : 0.0f,
                         lead && r.ttcS >= 0.0f ? clampf(r.ttcS, 0.0f, 99.9f) : -1.0f,
                         r.holding ? 1 : 0,
                         static_cast<unsigned>(s.hasFrame ? s.raw.count : 0),
                         static_cast<unsigned long>(r.alerts),
                         static_cast<unsigned long>(s.frame),
                         targets);
  return finish(n, cap);
}

size_t formatConfig(const SpeedConfig& c, const char* firmwareVersion, char* out, size_t cap) {
  const GroundWindow w = groundWindow(c);
  const int n = snprintf(out, cap,
                         "CFG ANGLE=%.1f HEIGHT=%.2f DIR=%d MODEL=%u CAL=%.4f RTHR=%u WHEEL=%u VMAX=%.2f RMIN=%.2f RMAX=%.2f "
                         "RANGE=%u RSPD=%u TTC=%.1f RSNR=%u RDET=%u FW=%s\n",
                         c.angleDeg,
                         c.heightM,
                         static_cast<int>(c.direction),
                         static_cast<unsigned>(c.model),
                         c.calibration,
                         static_cast<unsigned>(c.radarThreshold),
                         static_cast<unsigned>(c.wheelMm),
                         c.radialLimitMps,
                         w.minRangeM,
                         w.maxRangeM,
                         static_cast<unsigned>(c.rear.rangeM),
                         static_cast<unsigned>(c.rear.minSpeedKmh),
                         c.rear.ttcS,
                         static_cast<unsigned>(c.rear.snr),
                         static_cast<unsigned>(c.rear.detectRangeM()),
                         firmwareVersion);
  return finish(n, cap);
}
