/*!
 * @file   SettingsStore.h
 * @brief  【儲存層】把參數存進 ESP32 的 NVS（斷電、重新燒錄都不會消失）。
 *
 * 命名空間 speedRadar（3.0 起；舊版後方來車偵測用的 radarA 不再讀取）。讀回的資料不合法時改用預設值。
 */
#pragma once
#include <Preferences.h>

#include "../core/SpeedConfig.h"

class SettingsStore {
 public:
  bool        begin();
  SpeedConfig load();
  bool        save(const SpeedConfig& config);

 private:
  Preferences prefs_;
  bool        ready_ = false;
};
