#include "SettingsStore.h"

namespace {
constexpr const char* kNamespace     = "speedRadar";
constexpr uint8_t     kSchemaVersion = 1;  // 欄位有變動時加 1，舊資料就會被忽略
}  // namespace

bool SettingsStore::begin() {
  ready_ = prefs_.begin(kNamespace, false);
  return ready_;
}

SpeedConfig SettingsStore::load() {
  const SpeedConfig fallback = SpeedConfig::defaults();
  if (!ready_ || prefs_.getUChar("ver", 0) != kSchemaVersion) return fallback;

  SpeedConfig c;
  c.angleDeg       = prefs_.getFloat("angle", fallback.angleDeg);
  c.heightM        = prefs_.getFloat("height", fallback.heightM);
  c.direction      = prefs_.getChar("dir", fallback.direction);
  c.model          = static_cast<SpeedModel>(prefs_.getUChar("model", static_cast<uint8_t>(fallback.model)));
  c.calibration    = prefs_.getFloat("cal", fallback.calibration);
  c.radarThreshold = prefs_.getUChar("rthr", fallback.radarThreshold);
  c.wheelMm        = prefs_.getUShort("wheel", fallback.wheelMm);
  c.radialLimitMps = prefs_.getFloat("vmax", fallback.radialLimitMps);
  return c.isValid() ? c : fallback;
}

bool SettingsStore::save(const SpeedConfig& c) {
  if (!ready_ || !c.isValid()) return false;
  bool ok = true;
  ok &= prefs_.putFloat("angle", c.angleDeg) > 0;
  ok &= prefs_.putFloat("height", c.heightM) > 0;
  ok &= prefs_.putChar("dir", c.direction) > 0;
  ok &= prefs_.putUChar("model", static_cast<uint8_t>(c.model)) > 0;
  ok &= prefs_.putFloat("cal", c.calibration) > 0;
  ok &= prefs_.putUChar("rthr", c.radarThreshold) > 0;
  ok &= prefs_.putUShort("wheel", c.wheelMm) > 0;
  ok &= prefs_.putFloat("vmax", c.radialLimitMps) > 0;
  ok &= prefs_.putUChar("ver", kSchemaVersion) > 0;  // 最後寫版本：中途斷電下次會改用預設值
  return ok;
}
