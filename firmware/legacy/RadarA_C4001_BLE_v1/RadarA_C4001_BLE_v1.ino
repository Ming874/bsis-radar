/*!
 * @file   RadarA_C4001_BLE.ino
 * @brief  Radar A：後方來車偵測（DFRobot C4001 25m，UART）＋ 藍牙 BLE 輸出
 *
 * 功能：
 *   1. 初始化 C4001，切到「測速測距模式」，偵測 0.3 ~ 15 m
 *   2. 每 100 ms 讀取：目標數量 / 距離 / 速度 / 能量
 *   3. 距離濾波：中位數濾波（去掉突然跳很遠的值）＋ 平滑
 *   4. 只對「大型物體、正在快速接近」警示：接近速度 ≥ 1.5 m/s ＋ 反射能量夠大，
 *      靜止障礙物、遠離的東西、走路的人、小東西都不會觸發
 *   5. 雷達沒接或斷線不會卡住，會每 3 秒自動重試
 *   6. 藍牙 BLE：每 200 ms 把狀態送到手機（使用 Nordic UART 格式，一般藍牙序列 App 都能看）
 *   7. 板子上的藍色 LED（GPIO2）：慢閃 = 程式在跑；快閃 = 手機已連上；恆亮 = 後方來車
 *
 * 手機測試方式（不用自己寫 App）：
 *   Android：安裝「Serial Bluetooth Terminal」或「nRF Connect」
 *   iPhone ：安裝「Bluefruit Connect」或「nRF Connect」
 *   搜尋並連線「RadarA-ESP32」，就會每 0.2 秒收到一行資料：
 *     R=1 W=0 D=1.23 V=-0.12 T=35
 *     R = 雷達在線(1)/離線(0)    W = 後方來車警示(1)/安全(0)
 *     D = 距離 m（沒目標為 -1）   V = 相對速度 m/s   T = 已運作秒數（有在增加 = 有在跑）
 *
 * 硬體接線（C4001 25m 版只有 UART）：
 *   C4001 VIN -> 擴充板 V     C4001 GND -> 擴充板 G
 *   C4001 TX  -> GPIO16       C4001 RX  -> GPIO17      C4001 OUT -> 不接
 *
 * 函式庫：DFRobot_C4001（程式庫管理員安裝）；BLE 為 ESP32 內建，不用另外裝
 * 開發板：ESP32 Dev Module；序列埠監控視窗鮑率：115200
 */

#include "DFRobot_C4001.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ================== 硬體設定 ==================
#define RADAR_A_RX_PIN   16      // ESP32 接收腳（接雷達 TX）
#define RADAR_A_TX_PIN   17      // ESP32 傳送腳（接雷達 RX）
#define RADAR_BAUD       9600    // C4001 固定 9600
#define LED_PIN          2       // 板子上的 LED

// 注意：此函式庫在 ESP32 上第 3 個參數是 ESP32 的 RX 腳、第 4 個是 TX 腳
DFRobot_C4001_UART radarA(&Serial2, RADAR_BAUD, RADAR_A_RX_PIN, RADAR_A_TX_PIN);

// ================== 藍牙設定 ==================
#define BLE_NAME          "RadarA-ESP32"
// Nordic UART Service（NUS）：手機上的藍牙序列 App 都認得這組 UUID
#define NUS_SERVICE_UUID  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID       "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"   // 手機 -> ESP32（保留）
#define NUS_TX_UUID       "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"   // ESP32 -> 手機（Notify）
const uint32_t BLE_SEND_MS = 200;   // 多久送一次資料給手機（ms）

BLEServer*         bleServer   = nullptr;
BLECharacteristic* bleTxChar   = nullptr;
volatile bool      bleConnected = false;
bool               bleWasConnected = false;
uint32_t           lastBleSendMs = 0;

// ================== 偵測參數（可依實測調整） ==================
const float    DETECT_MIN_M     = 0.3;    // 最近偵測距離（m）
const float    DETECT_MAX_M     = 15.0;   // 最遠偵測距離（m），計畫書 15 m
const float    WARNING_DIST_M   = 15.0;   // 進入此距離內才警示（m）
const uint16_t DETECT_THRES     = 30;     // 雷達內部偵測門檻（越大越不靈敏，小東西越不會被抓到），單位 0.1

const uint8_t  WARN_ON_COUNT    = 3;      // 連續偵測到幾次才警示（100ms x 3 = 0.3 秒）
const uint32_t WARN_HOLD_MS     = 1000;   // 目標消失後，警示再保持多久（ms）
const uint32_t RADAR_TIMEOUT_MS = 2000;   // 多久沒資料視為離線（ms）
const uint32_t RADAR_REINIT_MS  = 30000;  // 離線多久重新初始化（ms）；設長一點，避免後方沒車時誤判斷線
const uint32_t RADAR_RETRY_MS   = 3000;   // 初始化失敗後隔多久重試（ms）
const uint32_t RADAR_PROBE_MS   = 1500;   // 等雷達回應的最長時間（ms）
const uint32_t READ_PERIOD_MS   = 100;    // 讀取週期（ms）
const uint32_t PRINT_PERIOD_MS  = 200;    // 序列埠輸出週期（ms）

// 只對「正在接近」的目標警示，靜止的障礙物、遠離中的東西都不會觸發
// 速度正負號：-1 = 速度為負代表接近（依實測資料判斷：遠離時速度為正）
//             若實測發現相反（走近反而不會警示），改成 +1；改成 0 = 不判斷方向
const int8_t   APPROACH_SIGN    = -1;
// 測試模式：1 = 室內測試用（門檻很低，人走近就會觸發，用來確認功能正常）
//           0 = 上路用（接近速度要 ≥ 1.5 m/s，約 5.4 km/h，走路的人不會觸發）
#define TEST_MODE 1
#if TEST_MODE
const float    APPROACH_MIN_MPS = 0.10;   // 室內實測：人走近時雷達量到約 0.1 ~ 0.2 m/s
#else
const float    APPROACH_MIN_MPS = 1.5;    // 車子超車的相對速度通常 > 2 m/s
#endif

// 「大型物體」判斷：反射能量（energy）越大代表物體越大（汽機車 >> 人 >> 小東西）
// 取最近 5 筆能量的中位數，低於 MIN_ENERGY 就不算來車
// 校正方法：看序列埠「能量」欄，分別記下人走過、機車經過時的數值，取兩者中間設定
const uint32_t MIN_ENERGY       = 0;      // 0 = 先不過濾；校正後填入，例如 50000
const float    SPEED_EMA_ALPHA  = 0.5;    // 速度平滑係數，避免單筆速度跳動造成誤判

// 距離濾波
#define        MEDIAN_SIZE        5       // 中位數濾波視窗（取最近 5 筆的中間值）
const float    DIST_EMA_ALPHA   = 0.3;    // 平滑係數 0~1，越小越平滑、反應越慢

// ================== 資料結構 ==================
struct RadarAPacket {
  bool    online;        // 雷達是否有資料
  bool    warning;       // 後方來車警示
  uint8_t targetCount;   // 目標數量（C4001 一次只回報 1 個最強目標）
  float   distance_m;    // 濾波後距離（m），沒目標時為 -1
  float   speed_mps;     // 目標相對速度（m/s）
};
RadarAPacket radarAPacket = { false, false, 0, -1.0, 0.0 };

// ================== 內部狀態 ==================
bool     radarReady     = false;
uint32_t initAttempts   = 0;
uint32_t lastInitTryMs  = 0;
uint8_t  hitCount       = 0;
uint32_t lastHitMs      = 0;
uint32_t lastDataMs     = 0;
uint32_t lastReadMs     = 0;
uint32_t lastPrintMs    = 0;
float    smoothDist     = -1.0;
float    smoothSpeed    = 0.0;      // 平滑後的速度
uint32_t energyBuf[5]   = {0};
uint8_t  energyIdx      = 0;
uint32_t medianEnergy   = 0;      // 能量中位數（大型物體判斷用）

float    medianBuf[MEDIAN_SIZE];
uint8_t  medianCount    = 0;
uint8_t  medianIdx      = 0;

uint8_t  rawNumber      = 0;
float    rawRange       = 0;
float    rawSpeed       = 0;
uint32_t rawEnergy      = 0;

// ================== 函式宣告 ==================
bool  radarResponds(uint32_t timeoutMs);
bool  initRadarA();
void  readRadarA();
bool  isValidTarget(float range, float speed);
void  updateWarning(bool hit);
float filterDistance(float d);
void  resetFilter();
void  printRadarA();
void  updateLed();
void  setupBLE();
void  sendBLE();

// ================== 藍牙連線事件 ==================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override    { bleConnected = true; }
  void onDisconnect(BLEServer* s) override { bleConnected = false; }
};

// ================== setup ==================
void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(LED_PIN, OUTPUT);
  Serial.println();
  Serial.println("=== Radar A（C4001）後方來車偵測 - 藍牙版 ===");

  setupBLE();   // 先開藍牙，雷達還沒接也能連上確認 ESP32 有在跑

  lastInitTryMs = millis();
  radarReady = initRadarA();
  Serial.println("欄位：狀態 | 目標數 | 原始距離(m) | 濾波距離(m) | 速度(m/s) | 能量中位數 | 警示");
}

// ================== loop ==================
void loop() {
  uint32_t now = millis();

  updateLed();

  // 手機斷線後重新開始廣播，讓手機可以再連
  if (!bleConnected && bleWasConnected) {
    delay(300);
    bleServer->startAdvertising();
    Serial.println("[藍牙] 手機已斷線，重新廣播中");
  }
  if (bleConnected && !bleWasConnected) {
    Serial.println("[藍牙] 手機已連線");
  }
  bleWasConnected = bleConnected;

  if (!radarReady && now - lastInitTryMs >= RADAR_RETRY_MS) {
    lastInitTryMs = now;
    radarReady = initRadarA();
  }

  if (radarReady && now - lastReadMs >= READ_PERIOD_MS) {
    lastReadMs = now;
    readRadarA();
  }

  if (now - lastBleSendMs >= BLE_SEND_MS) {
    lastBleSendMs = now;
    sendBLE();
  }

  if (now - lastPrintMs >= PRINT_PERIOD_MS) {
    lastPrintMs = now;
    printRadarA();
  }
}

// ================== 藍牙 ==================
void setupBLE() {
  BLEDevice::init(BLE_NAME);
  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService* service = bleServer->createService(NUS_SERVICE_UUID);

  bleTxChar = service->createCharacteristic(
      NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
  bleTxChar->addDescriptor(new BLE2902());

  service->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.print("[藍牙] 已開始廣播，裝置名稱：");
  Serial.println(BLE_NAME);
}

// 送出一行文字：R=1 W=0 D=1.23 V=-0.12 T=35
void sendBLE() {
  char msg[64];
  snprintf(msg, sizeof(msg), "R=%d W=%d D=%.2f V=%.2f T=%lu\n",
           (radarReady && radarAPacket.online) ? 1 : 0,
           radarAPacket.warning ? 1 : 0,
           radarAPacket.distance_m,
           radarAPacket.speed_mps,
           (unsigned long)(millis() / 1000));
  bleTxChar->setValue((uint8_t*)msg, strlen(msg));   // 沒連線時也更新，手機讀取時拿得到最新值
  if (bleConnected) {
    bleTxChar->notify();
  }
}

// ================== 初始化雷達 ==================
// 送出 sensorStop，在 timeoutMs 內有收到任何資料就代表雷達有接上
bool radarResponds(uint32_t timeoutMs) {
  while (Serial2.available()) Serial2.read();
  Serial2.print("sensorStop");
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    if (Serial2.available()) return true;
    delay(10);
  }
  return false;
}

bool initRadarA() {
  initAttempts++;
  Serial.print("[Radar A] 初始化中（第 ");
  Serial.print(initAttempts);
  Serial.println(" 次）...");

  radarA.begin();

  // 函式庫的 setSensorMode() / getStatus() 在雷達沒回應時會無限等待，所以先自己確認
  if (!radarResponds(RADAR_PROBE_MS)) {
    Serial.println("[Radar A] 雷達沒有回應（檢查接線與電源），稍後重試");
    return false;
  }

  radarA.setSensorMode(eSpeedMode);

  uint16_t minCm = (uint16_t)(DETECT_MIN_M * 100);
  uint16_t maxCm = (uint16_t)(DETECT_MAX_M * 100);
  if (!radarA.setDetectThres(minCm, maxCm, DETECT_THRES)) {
    Serial.println("[Radar A] 設定偵測範圍失敗");
    return false;
  }

  radarA.setFrettingDetection(eOFF);   // 關閉微動偵測，減少靜物與震動誤報

  sSensorStatus_t st = radarA.getStatus();
  Serial.print("[Radar A] 工作狀態=");  Serial.print(st.workStatus);
  Serial.print("  模式(1=測速)=");     Serial.print(st.workMode);
  Serial.print("  初始化=");           Serial.println(st.initStatus);

  // 注意：不要呼叫 getTMinRange() / getTMaxRange() / getThresRange()，
  // 實測在 C4001 25m 上會讓 ESP32 當機重開
  Serial.print("[Radar A] 範圍設定 ");
  Serial.print(DETECT_MIN_M, 2);
  Serial.print(" ~ ");
  Serial.print(DETECT_MAX_M, 2);
  Serial.print(" m，門檻 ");
  Serial.println(DETECT_THRES);

  if (st.workMode != eSpeedMode) {
    Serial.println("[Radar A] 模式不是測速模式");
    return false;
  }

  Serial.println("=== Radar A 初始化完成，開始讀取資料 ===");
  lastDataMs = millis();
  resetFilter();
  return true;
}

// ================== 讀取與判斷 ==================
void readRadarA() {
  uint32_t now = millis();

  bool gotBytes = Serial2.available() > 0;

  // 一定要先呼叫 getTargetNumber()，它會讀新資料並更新距離/速度/能量
  rawNumber = radarA.getTargetNumber();
  rawRange  = radarA.getTargetRange();
  rawSpeed  = radarA.getTargetSpeed();
  rawEnergy = radarA.getTargetEnergy();

  if (gotBytes || rawNumber > 0) {
    lastDataMs = now;
  }

  bool hit = false;
  if (rawNumber > 0) {
    smoothSpeed = SPEED_EMA_ALPHA * rawSpeed + (1 - SPEED_EMA_ALPHA) * smoothSpeed;
    // 能量中位數：能量值很會跳，用中位數比較可靠
    energyBuf[energyIdx] = rawEnergy;
    energyIdx = (energyIdx + 1) % 5;
    uint32_t e[5];
    for (uint8_t i = 0; i < 5; i++) e[i] = energyBuf[i];
    for (uint8_t i = 1; i < 5; i++) {
      uint32_t k = e[i]; int8_t j = i - 1;
      while (j >= 0 && e[j] > k) { e[j + 1] = e[j]; j--; }
      e[j + 1] = k;
    }
    medianEnergy = e[2];
    hit = isValidTarget(rawRange, smoothSpeed) && medianEnergy >= MIN_ENERGY;
  } else {
    smoothSpeed = 0.0;
    energyBuf[energyIdx] = 0;
    energyIdx = (energyIdx + 1) % 5;
    medianEnergy = 0;
  }

  radarAPacket.online = (now - lastDataMs) < RADAR_TIMEOUT_MS;
  if (!radarAPacket.online) {
    hit = false;
    if (now - lastDataMs >= RADAR_REINIT_MS) {
      Serial.println("[Radar A] 太久沒有資料，重新初始化");
      radarReady = false;
      lastInitTryMs = now;
    }
  }

  if (hit) {
    smoothDist = filterDistance(rawRange);
  }

  updateWarning(hit);

  radarAPacket.targetCount = hit ? rawNumber : 0;
  if (radarAPacket.warning) {
    radarAPacket.distance_m = smoothDist;
    radarAPacket.speed_mps  = smoothSpeed;
  } else {
    radarAPacket.distance_m = -1.0;
    radarAPacket.speed_mps  = 0.0;
    resetFilter();
  }
}

bool isValidTarget(float range, float speed) {
  if (range < DETECT_MIN_M || range > WARNING_DIST_M) return false;
  if (APPROACH_SIGN != 0 && speed * APPROACH_SIGN < APPROACH_MIN_MPS) return false;
  return true;
}

void updateWarning(bool hit) {
  uint32_t now = millis();
  if (hit) {
    lastHitMs = now;
    if (hitCount < 255) hitCount++;
    if (hitCount >= WARN_ON_COUNT) radarAPacket.warning = true;
  } else {
    hitCount = 0;
    if (radarAPacket.warning && (now - lastHitMs) >= WARN_HOLD_MS) {
      radarAPacket.warning = false;
    }
  }
}

// ================== 距離濾波 ==================
// 步驟 1：中位數濾波 —— 取最近 5 筆的中間值，單一筆突然跳很遠會被直接忽略
// 步驟 2：指數平滑 —— 讓數字變化更平順
float filterDistance(float d) {
  medianBuf[medianIdx] = d;
  medianIdx = (medianIdx + 1) % MEDIAN_SIZE;
  if (medianCount < MEDIAN_SIZE) medianCount++;

  float sorted[MEDIAN_SIZE];
  for (uint8_t i = 0; i < medianCount; i++) sorted[i] = medianBuf[i];
  for (uint8_t i = 1; i < medianCount; i++) {          // 插入排序
    float key = sorted[i];
    int8_t j = i - 1;
    while (j >= 0 && sorted[j] > key) { sorted[j + 1] = sorted[j]; j--; }
    sorted[j + 1] = key;
  }
  float median = sorted[medianCount / 2];

  if (smoothDist < 0) return median;
  return DIST_EMA_ALPHA * median + (1 - DIST_EMA_ALPHA) * smoothDist;
}

void resetFilter() {
  medianCount = 0;
  medianIdx   = 0;
  smoothDist  = -1.0;
}

// ================== LED 與序列埠 ==================
// 慢閃 = 程式在跑；快閃 = 手機已連上；恆亮 = 後方來車
void updateLed() {
  if (radarAPacket.warning) {
    digitalWrite(LED_PIN, HIGH);
  } else if (bleConnected) {
    digitalWrite(LED_PIN, (millis() / 150) % 2);
  } else {
    digitalWrite(LED_PIN, (millis() / 500) % 2);
  }
}

void printRadarA() {
  if (!radarReady) return;
  Serial.print(radarAPacket.online ? "ONLINE " : "OFFLINE");
  Serial.print(" | ");  Serial.print(rawNumber);
  Serial.print(" | ");  Serial.print(rawRange, 2);
  Serial.print(" | ");  Serial.print(radarAPacket.distance_m, 2);
  Serial.print(" | ");  Serial.print(rawSpeed, 2);
  Serial.print(" | ");  Serial.print(medianEnergy);
  Serial.print(" | ");  Serial.print(radarAPacket.warning ? "!! 後方來車 !!" : "安全");
  Serial.println(bleConnected ? "  [手機已連]" : "");
}
