/*!
 * @file    RadarA_C4001_BLE.ino
 * @brief   Radar A：自行車後方來車偵測（DFRobot C4001 25m，UART）＋ 藍牙 BLE 輸出
 * @version 2.0.0
 *
 * 程式架構（上層呼叫下層，下層不知道上層）：
 *   應用層  RadarA_C4001_BLE.ino     只負責接線與啟動
 *           AppConfig.h              腳位、雷達設定、藍牙 UUID、週期
 *           src/app/RadarApp         組裝模組、主迴圈排程、指令處理
 *   通訊層  src/comm/BleLink         藍牙 NUS：MTU 分段通知、指令佇列、自動重新廣播
 *           src/comm/Telemetry       傳給手機的文字格式
 *           src/comm/CommandParser   文字指令解析與驗證（藍牙、序列埠共用）
 *   核心層  src/core/ThreatTracker   來車判斷：篩選 → 確認 → 追蹤 → 分級 → 保持
 *           src/core/DetectionConfig 執行期參數與範圍檢查
 *   儲存層  src/storage/SettingsStore 參數存 NVS，斷電不消失
 *   驅動層  src/drivers/C4001Radar   雷達非阻塞驅動：初始化狀態機、心跳、斷線自動重試
 *           src/drivers/C4001Protocol 資料框解析；src/drivers/StatusLed 狀態燈
 * 核心層、協定解析、指令解析是純 C++，可在電腦上跑單元測試（firmware/tests）。
 *
 * 硬體接線（C4001 25m 版只有 UART）：
 *   C4001 VIN → 擴充板 V    C4001 GND → 擴充板 G
 *   C4001 TX  → GPIO16      C4001 RX  → GPIO17     C4001 OUT → 不接
 *
 * 手機：Android Chrome 開啟網頁儀表板（Web Bluetooth）連線「RadarA-ESP32」；
 *       也可用 nRF Connect、Serial Bluetooth Terminal 等 BLE 序列 App 看資料、送指令。
 * LED ：慢閃 = 等待手機；快閃 = 手機已連線；每秒閃兩下 = 雷達離線/初始化中；恆亮 = 後方來車
 *
 * 開發板：ESP32 Dev Module；序列埠監控視窗 115200（可直接輸入 HELP、GET、TEST 0 等指令）
 * 函式庫：只用 ESP32 內建的 BLE 與 Preferences，不需要安裝 DFRobot_C4001
 */
#include "AppConfig.h"
#include "src/app/RadarApp.h"

static_assert(app::kRadarMaxRangeM >= limits::kWarnRangeHi, "雷達最遠偵測距離不可小於警示距離上限");
static_assert(app::kRadarMaxRangeM >= tuning::kMaxTrackRangeM, "雷達最遠偵測距離不可小於追蹤距離上限");

static RadarApp radarApp({
    Serial2,  // 雷達 UART
    Serial,   // USB 序列埠
    {app::kPinRadarRx, app::kPinRadarTx, app::kRadarBaud, app::kRadarMinRangeM, app::kRadarMaxRangeM,
     app::kRadarThrFactor},
    {app::kBleName, app::kNusServiceUuid, app::kNusRxUuid, app::kNusTxUuid, app::kBleMtu},
    app::kPinStatusLed,
    app::kTelemetryPeriodMs,
    app::kDebugPeriodMs,
    FW_VERSION,
    app::kAllowBleConfig,
});

void setup() {
  setCpuFrequencyMhz(80);  // 藍牙最低需求 80 MHz；降頻省電（實車由發電花鼓供電）
  Serial.begin(app::kUsbBaud);
  radarApp.begin();
  enableLoopWDT();  // 保險：主迴圈若卡住超過 5 秒自動重開（所有模組都不阻塞，正常不會觸發）
}

void loop() {
  radarApp.loop();
  delay(1);  // 讓出 CPU 給藍牙與系統工作，每秒仍跑約 1000 次
}
