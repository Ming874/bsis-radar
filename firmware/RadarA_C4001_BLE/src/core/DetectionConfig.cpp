#include "DetectionConfig.h"

DetectionConfig DetectionConfig::defaults() {
  DetectionConfig c;
  c.testMode     = true;    // 先用室內測試模式；上路前用網頁或指令 TEST 0 關閉
  c.minSpeedMps  = 1.5f;    // 約 5.4 km/h，走路的人不會觸發；超車相對速度通常 > 2 m/s
  c.minEnergy    = 0;
  c.warnRangeM   = 15.0f;   // 計畫書：相對速差 7 m/s × 反應時間 2 s ≈ 14 m → 取 15 m
  c.approachSign = -1;      // 實測：遠離時速度為正，接近時為負
  c.dangerTtcS   = 1.5f;    // 留給騎士約 1.5 秒反應
  c.dangerDistM  = 4.0f;
  c.holdMs       = 1000;    // 車子剛超過去、還在旁邊時繼續警示
  c.confirmHits  = 3;       // 約 0.3 秒（10 Hz）就能確認，又能擋掉單筆雜訊
  return c;
}

bool DetectionConfig::isValid() const {
  // 用「不在範圍內就失敗」的寫法，NaN 也會被擋下
  if (!(minSpeedMps >= limits::kMinSpeedLo && minSpeedMps <= limits::kMinSpeedHi)) return false;
  if (minEnergy > limits::kMinEnergyHi) return false;
  if (!(warnRangeM >= limits::kWarnRangeLo && warnRangeM <= limits::kWarnRangeHi)) return false;
  if (approachSign < -1 || approachSign > 1) return false;
  if (!(dangerTtcS >= limits::kDangerTtcLo && dangerTtcS <= limits::kDangerTtcHi)) return false;
  if (!(dangerDistM >= limits::kDangerDistLo && dangerDistM <= limits::kDangerDistHi)) return false;
  if (holdMs < limits::kHoldLo || holdMs > limits::kHoldHi) return false;
  if (confirmHits < limits::kConfirmLo || confirmHits > limits::kConfirmHi) return false;
  return true;
}
