#include "SettingsStore.h"

namespace {
constexpr const char* kNamespace     = "radarA";
constexpr uint8_t     kSchemaVersion = 1;  // 欄位有變動時加 1，舊資料就會被忽略
}  // namespace

bool SettingsStore::begin() {
  ready_ = prefs_.begin(kNamespace, false);
  return ready_;
}

DetectionConfig SettingsStore::load() {
  const DetectionConfig fallback = DetectionConfig::defaults();
  if (!ready_ || prefs_.getUChar("ver", 0) != kSchemaVersion) return fallback;

  DetectionConfig c;
  c.testMode     = prefs_.getBool("test", fallback.testMode);
  c.minSpeedMps  = prefs_.getFloat("minspd", fallback.minSpeedMps);
  c.minEnergy    = prefs_.getULong("mine", fallback.minEnergy);
  c.warnRangeM   = prefs_.getFloat("range", fallback.warnRangeM);
  c.approachSign = prefs_.getChar("sign", fallback.approachSign);
  c.dangerTtcS   = prefs_.getFloat("dttc", fallback.dangerTtcS);
  c.dangerDistM  = prefs_.getFloat("ddist", fallback.dangerDistM);
  c.holdMs       = prefs_.getUShort("hold", fallback.holdMs);
  c.confirmHits  = prefs_.getUChar("confirm", fallback.confirmHits);
  return c.isValid() ? c : fallback;
}

bool SettingsStore::save(const DetectionConfig& c) {
  if (!ready_ || !c.isValid()) return false;
  bool ok = true;
  ok &= prefs_.putBool("test", c.testMode) > 0;
  ok &= prefs_.putFloat("minspd", c.minSpeedMps) > 0;
  ok &= prefs_.putULong("mine", c.minEnergy) > 0;
  ok &= prefs_.putFloat("range", c.warnRangeM) > 0;
  ok &= prefs_.putChar("sign", c.approachSign) > 0;
  ok &= prefs_.putFloat("dttc", c.dangerTtcS) > 0;
  ok &= prefs_.putFloat("ddist", c.dangerDistM) > 0;
  ok &= prefs_.putUShort("hold", c.holdMs) > 0;
  ok &= prefs_.putUChar("confirm", c.confirmHits) > 0;
  ok &= prefs_.putUChar("ver", kSchemaVersion) > 0;  // 最後寫版本：中途斷電下次會改用預設值
  return ok;
}
