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

### 來車判斷（ThreatTracker，v2.1.0）

完整說明、公式、參數與參考文獻見 [docs/ALGORITHM.md](../docs/ALGORITHM.md)。

1. **關聯**：量測距離落在卡爾曼預測的驗證閘門（3σ，1.2～3 m）內才採用；連續 3 筆「彼此一致」的跳值才視為換了目標。
2. **追蹤**：卡爾曼濾波器（`RangeKalman`，狀態 = 距離、距離變化率）融合距離與都卜勒速度。
3. **交叉核對**（`VelocityCheck`）：都卜勒速度必須和最近 1 秒的距離變化率（`RangeRateWindow` 最小平方斜率）一致才採用；超過 10 m/s 的折疊會自動還原，`SIGN` 設反會自動反過來並提示，不一致或卡在量測上限就改用距離變化率。
4. **確認**：正在接近（接近速度 ≥ `MINSPD`，測試模式 0.1 m/s）、能量 ≥ `MINE` 的資料加分、不合格扣分，分數達到 `CONFIRM` 才算來車。
5. **分級**：距離 ≤ `RANGE` 為注意；到達時間 ≤ `DTTC` 或距離 ≤ `DDIST` 為危險。
6. **保持**：最後一次真正偵測到後，警示再維持 `HOLD` 毫秒。

序列埠監看（`.\arduino.ps1 monitor`）每 0.2 秒印一行，`RR` 是距離變化率、方括號是速度來源（核對中／都卜勒／折疊還原／距離變化率／正負號相反）。

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

`tests/host_tests.cpp` 在電腦上編譯 `src/core`、`src/comm`、`src/drivers/C4001Protocol` 的純邏輯（173 項），涵蓋資料框解析、指令解析與範圍、輸出格式（含最長一行不超過緩衝區）、來車確認／分級／保持、換目標、雜訊與掉資料，以及速度交叉核對的各種情境（都卜勒折疊、飽和、報 0、`SIGN` 設反、加減速、反射點跳動）。

```powershell
.\arduino.ps1 test
```

## 舊版

`legacy/RadarA_C4001_BLE_v1/` 是最初的 v1 程式，只供對照，不要燒錄。
