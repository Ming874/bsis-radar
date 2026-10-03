/*!
 * @file   SettingsStore.h
 * @brief  【儲存層】把偵測參數存進 ESP32 的 NVS（斷電、重新燒錄都不會消失）。
 *
 * 讀回的資料若不合法（例如舊版格式），自動改用預設值。
 */
#pragma once
#include <Preferences.h>

#include "../core/DetectionConfig.h"

class SettingsStore {
 public:
  bool            begin();
  DetectionConfig load();
  bool            save(const DetectionConfig& config);

 private:
  Preferences prefs_;
  bool        ready_ = false;
};
