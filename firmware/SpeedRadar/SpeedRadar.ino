/*!
 * @file    SpeedRadar.ino
 * @brief   BSIS 對地測速雷達：DFRobot C4001（24 GHz FMCW）斜照路面，量測自行車對地速度，藍牙 BLE 輸出
 * @version 3.0.0
 *
 * 程式架構（上層呼叫下層，下層不知道上層）：
 *   應用層  SpeedRadar.ino                 只負責接線與啟動
 *           AppConfig.h                    腳位、藍牙 UUID、週期
 *           src/app/SpeedRadarApp          組裝模組、主迴圈排程、指令處理
 *   通訊層  src/comm/BleLink               藍牙 NUS：MTU 分段通知、指令佇列、自動重新廣播
 *           src/comm/Telemetry             傳給網頁的文字格式
 *           src/comm/CommandParser         文字指令解析與驗證（藍牙、序列埠共用）
 *   核心層  src/core/GroundSpeedEstimator  對地速度：有效性判斷 → 換算 → 穩健卡爾曼 → 狀態機 → 里程
 *           src/core/SpeedConfig           執行期參數與範圍檢查
 *           src/core/WheelSpeed            輪速感測器（參考值）
 *   儲存層  src/storage/SettingsStore      參數存 NVS，斷電不消失
 *   驅動層  src/drivers/C4001Radar         雷達非阻塞驅動：初始化狀態機、心跳、斷線自動重試
 *           src/drivers/C4001Protocol      資料框解析；src/drivers/StatusLed 狀態燈
 *           src/drivers/WheelSensor        輪速感測器（霍爾開關）中斷
 * 核心層、協定解析、指令解析是純 C++，可在電腦上跑單元測試（firmware/tests）。
 *
 * 硬體接線（C4001 25 m 版只有 UART）：
 *   C4001 VIN → 擴充板 V    C4001 GND → 擴充板 G
 *   C4001 TX  → GPIO16      C4001 RX  → GPIO17     C4001 OUT → 不接
 * 輪速感測器（選用，參考值）：3144 霍爾開關 VCC → V、GND → G、OUT → GPIO27（磁鐵裝在輻條上）
 * 安裝：雷達斜向下照路面、波束窄的方向對準前進方向，見 docs/GETTING_STARTED.md。
 *
 * 網頁：Android Chrome 或電腦 Chrome／Edge 開啟 https://bsis.mingchen.dev，以 Web Bluetooth 連線「BSIS-Speed」。
 * LED ：慢閃 = 等待手機；快閃 = 手機已連線；恆亮 = 正在量到地面速度；每秒閃兩下 = 雷達離線或初始化中
 *
 * 開發板：ESP32 Dev Module；序列埠 115200（可直接輸入 HELP、GET、ANGLE 45 等指令）
 * 函式庫：只用 ESP32 內建的 BLE 與 Preferences，不需要安裝 DFRobot_C4001
 */
#include "AppConfig.h"
#include "src/app/SpeedRadarApp.h"

static SpeedRadarApp speedRadar({
    Serial2,  // 雷達 UART
    Serial,   // USB 序列埠
    {app::kPinRadarRx, app::kPinRadarTx, app::kRadarBaud},
    {app::kBleName, app::kNusServiceUuid, app::kNusRxUuid, app::kNusTxUuid, app::kBleMtu},
    app::kPinStatusLed,
    app::kPinWheelSensor,
    app::kHeartbeatMs,
    FW_VERSION,
    app::kAllowBleConfig,
});

void setup() {
  setCpuFrequencyMhz(80);  // 藍牙最低需求 80 MHz；降頻省電（實車由發電花鼓或行動電源供電）
  Serial.begin(app::kUsbBaud);
  speedRadar.begin();
  enableLoopWDT();  // 保險：主迴圈若卡住超過 5 秒自動重開（所有模組都不阻塞，正常不會觸發）
}

void loop() {
  speedRadar.loop();
  delay(1);  // 讓出 CPU 給藍牙與系統工作，每秒仍跑約 1000 次
}
