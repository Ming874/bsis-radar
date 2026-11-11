/*!
 * @file   SettingsStore.h
 * @brief  【儲存層】把參數存進 ESP32 的 NVS（斷電、重新燒錄都不會消失）。
 *
 * 命名空間 speedRadar（3.0 起；舊版後方來車偵測用的 radarA 不再讀取）。讀回的資料不合法時改用預設值；
 * 後方來車雷達的欄位（3.1 新增）另外記版本、分開檢查，升級時對地測速的設定不受影響。
 * 4.0 測速雷達從 C4001 換成 LD2451：沿用 3.x 存的安裝角度、高度、朝向、輪周長，
 * 校正係數回到 1（換了雷達要重新校正），C4001 的 RTHR、VMAX 不再使用。
 */
#pragma once
#include <Preferences.h>

#include "../core/SpeedConfig.h"

class SettingsStore {
 public:
  bool        begin();
  SpeedConfig load();
  bool        save(const SpeedConfig& config);

  // 這次 load() 是從 3.x（C4001）的設定轉過來的：校正係數已重設，開機時提醒要重新校正
  bool migratedFromC4001() const { return migrated_; }

 private:
  Preferences prefs_;
  bool        ready_    = false;
  bool        migrated_ = false;
};
