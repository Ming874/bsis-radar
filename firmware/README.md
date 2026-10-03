# Radar A 韌體（ESP32 + DFRobot C4001）

讀取朝後的 C4001 毫米波雷達、判斷後方來車，透過藍牙（Nordic UART Service）把結果送到網頁。

## 燒錄

| 情境 | 做法 |
| --- | --- |
| 只想把韌體燒進去 | 雙擊 `flash.bat`（不需 Arduino IDE）：自動找 COM 埠、必要時協助安裝 CH340 驅動、燒錄後讀回版本確認 |
| 改了程式 | `.\arduino.ps1 upload`（編譯並燒錄），確認沒問題再 `.\arduino.ps1 release` 更新 `release\` |

- USB 線要插在 **ESP32 板子本身**的 USB 孔；擴充底板的 USB 孔只供電、不能燒錄。
- `flash.bat` 分別寫入 bootloader（0x1000）、partitions（0x8000）、boot_app0（0xe000）、韌體（0x10000），**不會清掉已存的設定**。

## 開發指令（PowerShell，在 `firmware` 資料夾）

```powershell
.\arduino.ps1 setup      # 第一次：安裝 ESP32 開發板套件（使用 Arduino IDE 內建的 arduino-cli）
.\arduino.ps1 compile    # 編譯
.\arduino.ps1 upload     # 編譯並燒錄（自動找 COM 埠，也可 -Port COM7）
.\arduino.ps1 monitor    # 序列埠監看（115200）
.\arduino.ps1 ports      # 列出 COM 埠
.\arduino.ps1 test       # 電腦端單元測試（tests/host_tests.cpp，需要 g++）
.\arduino.ps1 release    # 把編譯結果與 SHA-256 輸出到 release\
```

## 程式架構（分層，相依只往下）

```text
RadarA_C4001_BLE/
├─ RadarA_C4001_BLE.ino   進入點：組裝 RadarApp，設定 CPU 80 MHz、看門狗
├─ AppConfig.h            編譯期設定：腳位、雷達設定、藍牙名稱與 UUID、輸出週期、kAllowBleConfig
└─ src/
   ├─ core/      純邏輯（可在電腦上測試）：DetectionConfig（9 項參數與範圍）、ThreatTracker（來車判斷）、MedianWindow
   ├─ drivers/   C4001Protocol（解析 $DFDMD 資料框）、C4001Radar（非阻塞狀態機）、StatusLed
   ├─ comm/      BleLink（NUS、依 MTU 分段、指令佇列）、Telemetry（輸出格式）、CommandParser
   ├─ storage/   SettingsStore（NVS 命名空間 radarA）
   └─ app/       RadarApp：把以上串起來，處理 USB／藍牙指令
```

### C4001 驅動

不使用 DFRobot 官方函式庫（會阻塞等待回應，雷達沒回應時可能卡住）。`C4001Radar` 是非阻塞狀態機：

```text
Offline → Configuring → Verifying → Online ⇄ Probing
```

- 開機時完整設定一次（`sensorStop` → `setRunApp 1` → `setRange 0.3 20.0` → `setThrFactor 30` → `setMicroMotion 0` → `saveConfig` → `sensorStart`），之後斷線只送 `sensorStart`。
- 連續失敗會把重試間隔從 3 秒拉長到 60 秒，避免一直寫快閃記憶體。
- 超過約 2.5 秒沒有資料就判定離線並自動重連。

### 來車判斷（ThreatTracker）

1. **篩選**：速度方向是「接近」（依 `SIGN`）、接近速度 ≥ `MINSPD`（測試模式 0.1 m/s）、能量 ≥ `MINE`、距離在 0.3～20 m。
2. **確認**：合格的資料加分、不合格扣分（不直接歸零），分數達到 `CONFIRM` 才算確認的來車。
3. **追蹤**：用雷達的都卜勒速度預測下一刻的距離，再用量測值修正；距離跳動超過 2.5 m 視為換了目標，連續 3 筆才重新追蹤。
4. **分級**：距離 ≤ `RANGE` 為注意；到達時間（距離 ÷ 接近速度）≤ `DTTC` 或距離 ≤ `DDIST` 為危險。
5. **保持**：最後一次真正偵測到後，警示再維持 `HOLD` 毫秒。

### LED（板載藍燈，GPIO2）

| 燈號 | 意思 |
| --- | --- |
| 慢閃（0.5 秒） | 正常，等待手機連線 |
| 快閃（0.15 秒） | 手機已連線 |
| 每秒閃兩下 | 雷達離線或初始化中 |
| 恆亮 | 後方來車警示中 |

## 設定

- **執行中可調**（存在 NVS，網頁「裝置」頁或指令修改）：`TEST`、`MINSPD`、`MINE`、`RANGE`、`SIGN`、`DTTC`、`DDIST`、`HOLD`、`CONFIRM`，範圍與預設見 [docs/PROTOCOL.md](../docs/PROTOCOL.md)。
- **編譯期**（`AppConfig.h`）：腳位 16／17、雷達距離 0.3～20 m、雷達門檻 30、藍牙名稱、MTU 247、遙測週期 200 ms。
- **安全**：`kAllowBleConfig = false` 時，藍牙只能讀資料，改設定與重開機只能從 USB。

## 測試

`tests/host_tests.cpp` 在電腦上編譯 `src/core`、`src/comm`、`src/drivers/C4001Protocol` 的純邏輯，涵蓋資料框解析、指令解析與範圍、輸出格式（含最長一行不超過緩衝區）、來車確認／分級／保持、換目標、雜訊與掉資料。

```powershell
.\arduino.ps1 test
```

## 舊版

`legacy/RadarA_C4001_BLE_v1/` 是最初的 v1 程式，只供對照，不要燒錄。
