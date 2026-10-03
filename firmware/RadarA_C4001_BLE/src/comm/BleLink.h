/*!
 * @file   BleLink.h
 * @brief  【通訊層】藍牙 BLE 連線（Nordic UART Service）。
 *
 * - TX（Notify）：ESP32 → 手機，送遙測文字；超過 MTU 時自動分段（網頁端收到 '\n' 才算一行）
 * - RX（Write）  ：手機 → ESP32，收指令；藍牙回呼在另一個執行緒，用 FreeRTOS 佇列安全地交給 loop()
 * - 手機斷線後自動重新廣播
 */
#pragma once
#include <Arduino.h>

class BLEServer;
class BLECharacteristic;

class BleLink {
 public:
  static constexpr size_t kMaxCommandLen = 63;

  struct Config {
    const char* deviceName;
    const char* serviceUuid;
    const char* rxUuid;
    const char* txUuid;
    uint16_t    mtu;
  };

  void begin(const Config& config);

  bool connected() const;

  // 剛連上時回傳 true 一次（用來立刻送出目前設定）
  bool consumeConnectEvent();
  // 剛斷線時回傳 true 一次
  bool consumeDisconnectEvent();

  // 送出一行文字（結尾要有 '\n'）；沒連線時不做事
  void sendLine(const char* line);

  // 取出手機送來的一行指令；沒有就回傳 false
  bool popCommand(char* out, size_t cap);

 private:
  BLEServer*         server_ = nullptr;
  BLECharacteristic* tx_     = nullptr;
};
