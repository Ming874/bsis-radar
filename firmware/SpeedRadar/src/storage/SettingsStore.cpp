#include "SettingsStore.h"

namespace {
constexpr const char* kNamespace         = "speedRadar";
constexpr uint8_t     kSchemaVersion     = 2;  // 對地測速欄位有變動時加 1（2 = 4.0 起，測速雷達是 LD2451）
constexpr uint8_t     kC4001Version      = 1;  // 3.x（測速雷達是 C4001）
constexpr uint8_t     kRearSchemaVersion = 1;  // 後方來車欄位（3.1 新增）另外記版本
}  // namespace

bool SettingsStore::begin() {
  ready_ = prefs_.begin(kNamespace, false);
  return ready_;
}

SpeedConfig SettingsStore::load() {
  const SpeedConfig fallback = SpeedConfig::defaults();
  migrated_ = false;
  if (!ready_) return fallback;

  SpeedConfig c = fallback;
  const uint8_t version = prefs_.getUChar("ver", 0);
  if (version == kSchemaVersion) {
    c.angleDeg    = prefs_.getFloat("angle", fallback.angleDeg);
    c.heightM     = prefs_.getFloat("height", fallback.heightM);
    c.direction   = prefs_.getChar("dir", fallback.direction);
    c.model       = static_cast<SpeedModel>(prefs_.getUChar("model", static_cast<uint8_t>(fallback.model)));
    c.calibration = prefs_.getFloat("cal", fallback.calibration);
    c.radarSnr    = prefs_.getUChar("gsnr", fallback.radarSnr);
    c.wheelMm     = prefs_.getUShort("wheel", fallback.wheelMm);
    if (!c.speedFieldsValid()) c = fallback;
  } else if (version == kC4001Version) {
    // 從 C4001 換成 LD2451：安裝位置多半沒變，幾何與輪周長沿用；校正係數、速度模型、雷達門檻回到預設
    c.angleDeg  = prefs_.getFloat("angle", fallback.angleDeg);
    c.heightM   = prefs_.getFloat("height", fallback.heightM);
    c.direction = prefs_.getChar("dir", fallback.direction);
    c.wheelMm   = prefs_.getUShort("wheel", fallback.wheelMm);
    if (!c.speedFieldsValid()) c = fallback;
    migrated_ = true;
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
  ok &= prefs_.putUChar("gsnr", c.radarSnr) > 0;
  ok &= prefs_.putUShort("wheel", c.wheelMm) > 0;
  ok &= prefs_.putUChar("ver", kSchemaVersion) > 0;  // 最後寫版本：中途斷電下次會改用預設值
  ok &= prefs_.putUChar("rrange", c.rear.rangeM) > 0;
  ok &= prefs_.putUChar("rspd", c.rear.minSpeedKmh) > 0;
  ok &= prefs_.putFloat("rttc", c.rear.ttcS) > 0;
  ok &= prefs_.putUChar("rsnr", c.rear.snr) > 0;
  ok &= prefs_.putUChar("rver", kRearSchemaVersion) > 0;
  if (ok) {
    // C4001 時期的欄位（4.0 起不再使用）。先確認有這個鍵：刪除不存在的鍵會在序列埠印出錯誤
    if (prefs_.isKey("rthr")) prefs_.remove("rthr");
    if (prefs_.isKey("vmax")) prefs_.remove("vmax");
  }
  return ok;
}
