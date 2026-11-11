#include "SettingsStore.h"

namespace {
constexpr const char* kNamespace         = "speedRadar";
constexpr uint8_t     kSchemaVersion     = 1;  // 對地測速欄位有變動時加 1，舊資料就會被忽略
constexpr uint8_t     kRearSchemaVersion = 1;  // 後方來車欄位（3.1 新增）另外記版本：升級時不會清掉校正係數
}  // namespace

bool SettingsStore::begin() {
  ready_ = prefs_.begin(kNamespace, false);
  return ready_;
}

SpeedConfig SettingsStore::load() {
  const SpeedConfig fallback = SpeedConfig::defaults();
  if (!ready_) return fallback;

  SpeedConfig c = fallback;
  if (prefs_.getUChar("ver", 0) == kSchemaVersion) {
    c.angleDeg       = prefs_.getFloat("angle", fallback.angleDeg);
    c.heightM        = prefs_.getFloat("height", fallback.heightM);
    c.direction      = prefs_.getChar("dir", fallback.direction);
    c.model          = static_cast<SpeedModel>(prefs_.getUChar("model", static_cast<uint8_t>(fallback.model)));
    c.calibration    = prefs_.getFloat("cal", fallback.calibration);
    c.radarThreshold = prefs_.getUChar("rthr", fallback.radarThreshold);
    c.wheelMm        = prefs_.getUShort("wheel", fallback.wheelMm);
    c.radialLimitMps = prefs_.getFloat("vmax", fallback.radialLimitMps);
    if (!c.speedFieldsValid()) c = fallback;
  }

  // 兩部分分開檢查：壞掉的後方設定只會讓後方設定回到預設值
  if (prefs_.getUChar("rver", 0) == kRearSchemaVersion) {
    RearConfig r;
    r.rangeM      = prefs_.getUChar("rrange", fallback.rear.rangeM);
    r.minSpeedKmh = prefs_.getUChar("rspd", fallback.rear.minSpeedKmh);
    r.ttcS        = prefs_.getFloat("rttc", fallback.rear.ttcS);
    r.snr         = prefs_.getUChar("rsnr", fallback.rear.snr);
    c.rear        = r.isValid() ? r : fallback.rear;
  }
  return c;
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
  ok &= prefs_.putUChar("rrange", c.rear.rangeM) > 0;
  ok &= prefs_.putUChar("rspd", c.rear.minSpeedKmh) > 0;
  ok &= prefs_.putFloat("rttc", c.rear.ttcS) > 0;
  ok &= prefs_.putUChar("rsnr", c.rear.snr) > 0;
  ok &= prefs_.putUChar("rver", kRearSchemaVersion) > 0;
  return ok;
}
