#include "BleLink.h"

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

namespace {

struct CommandMessage {
  char text[BleLink::kMaxCommandLen + 1];
};

QueueHandle_t gCommandQueue   = nullptr;
volatile bool gConnected      = false;
volatile bool gConnectEvent   = false;
volatile bool gDisconnectEvent = false;

// 以下回呼都在藍牙執行緒執行：只設旗標 / 丟進佇列，不做耗時工作
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    gConnected    = true;
    gConnectEvent = true;
  }
  void onDisconnect(BLEServer*) override {
    gConnected       = false;
    gDisconnectEvent = true;
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const String value = characteristic->getValue();
    // 一次寫入可能含多行指令，用換行切開
    CommandMessage msg;
    size_t len = 0;
    for (size_t i = 0; i <= value.length(); i++) {
      const char c = i < value.length() ? value[i] : '\n';
      if (c == '\n' || c == '\r') {
        if (len > 0) {
          msg.text[len] = '\0';
          xQueueSend(gCommandQueue, &msg, 0);  // 佇列滿了就丟掉，不阻塞藍牙執行緒
          len = 0;
        }
      } else if (len < BleLink::kMaxCommandLen) {
        msg.text[len++] = c;
      }
    }
  }
};

ServerCallbacks gServerCallbacks;
RxCallbacks     gRxCallbacks;

}  // namespace

void BleLink::begin(const Config& config) {
  gCommandQueue = xQueueCreate(6, sizeof(CommandMessage));

  BLEDevice::init(config.deviceName);
  BLEDevice::setMTU(config.mtu);  // 讓手機可協商較大的 MTU，一行資料一次送完
  // 這個核心版本每次手機訂閱都會把狀態寫進 NVS（每個手機位址一筆、從不刪除），
  // 手機藍牙位址會定期變換，久了會塞滿 NVS 導致設定存不進去；本裝置不配對，開機時清掉即可
  BLE2902::deleteAllPersistedValues();

  server_ = BLEDevice::createServer();
  server_->setCallbacks(&gServerCallbacks);
  server_->advertiseOnDisconnect(true);  // 手機斷線後自動重新廣播

  BLEService* service = server_->createService(config.serviceUuid);

  // NUS 規格中 TX 只有 Notify（不開放讀取，也避免讀取與更新同時發生的競爭）
  tx_ = service->createCharacteristic(config.txUuid, BLECharacteristic::PROPERTY_NOTIFY);
  tx_->addDescriptor(new BLE2902());  // 手機訂閱通知要用的描述元

  BLECharacteristic* rx = service->createCharacteristic(
      config.rxUuid, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(&gRxCallbacks);

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(config.serviceUuid);
  adv->setScanResponse(true);  // 裝置名稱放在掃描回應，廣播封包放 UUID
  BLEDevice::startAdvertising();
}

bool BleLink::connected() const { return gConnected; }

bool BleLink::consumeConnectEvent() {
  if (!gConnectEvent) return false;
  gConnectEvent = false;
  return true;
}

bool BleLink::consumeDisconnectEvent() {
  if (!gDisconnectEvent) return false;
  gDisconnectEvent = false;
  return true;
}

void BleLink::sendLine(const char* line) {
  if (tx_ == nullptr || line == nullptr || !gConnected) return;
  const size_t len = strlen(line);
  if (len == 0) return;

  // 一個通知最多 MTU − 3 個位元組；預設 MTU 23 → 20 bytes，所以長的一行要分段送
  const uint16_t mtu   = server_->getPeerMTU(server_->getConnId());
  size_t         chunk = (mtu > 23 ? mtu : 23) - 3;
  if (chunk > 180) chunk = 180;

  for (size_t offset = 0; offset < len; offset += chunk) {
    const size_t n = (len - offset < chunk) ? len - offset : chunk;
    tx_->setValue(reinterpret_cast<const uint8_t*>(line + offset), n);
    tx_->notify();
  }
}

bool BleLink::popCommand(char* out, size_t cap) {
  if (gCommandQueue == nullptr || out == nullptr || cap == 0) return false;
  CommandMessage msg;
  if (xQueueReceive(gCommandQueue, &msg, 0) != pdTRUE) return false;
  strncpy(out, msg.text, cap - 1);
  out[cap - 1] = '\0';
  return true;
}
