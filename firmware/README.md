# 韌體：BSIS 對地測速雷達（ESP32 + DFRobot C4001）

讀取斜照路面的 C4001 毫米波雷達，估計自行車對地速度與里程，經藍牙（Nordic UART Service）與 USB 序列埠輸出。演算法見 [docs/ALGORITHM.md](../docs/ALGORITHM.md)，資料格式見 [docs/PROTOCOL.md](../docs/PROTOCOL.md)。

## 燒錄

| 情境 | 做法 |
| --- | --- |
| 只要燒錄 | 雙擊 `flash.bat`（不需要 Arduino IDE）：自動找 COM 埠、必要時協助安裝 CH340 驅動、燒錄 `release\` 的檔案並讀回開機訊息 |
| 改了程式 | `.\arduino.ps1 upload` 編譯並燒錄；確認沒問題後 `.\arduino.ps1 release` 更新 `release\` |

- USB 線要插在 **ESP32 板子本身**的 USB-C 孔；擴充底板的孔只供電。
- `flash.bat` 寫入 bootloader（0x1000）、partitions（0x8000）、boot_app0（0xe000）、韌體（0x10000），**不清除 NVS**，已設定的參數會保留。

## 開發指令（PowerShell，在 `firmware` 資料夾）

```powershell
.\arduino.ps1 setup      # 第一次：安裝 ESP32 開發板套件
.\arduino.ps1 compile    # 編譯（顯示所有警告）
.\arduino.ps1 upload     # 編譯並燒錄（自動找 COM 埠，或 -Port COM7）
.\arduino.ps1 monitor    # 序列埠監看（115200），可直接輸入指令
.\arduino.ps1 ports      # 列出 COM 埠
.\arduino.ps1 test       # 電腦端單元測試與模擬報告（需要 g++）
.\arduino.ps1 release    # 輸出 release\（給 flash.bat）與 SHA-256
```

- arduino-cli 的搜尋順序：環境變數 `ARDUINO_CLI` → Arduino IDE 內建 → `PATH`。
- 沒有安裝 Arduino IDE 時，下載官方免安裝版 arduino-cli 並設定 `ARDUINO_CLI`；開發板套件仍裝在 `%LOCALAPPDATA%\Arduino15`。
- 環境：ESP32 Dev Module（`esp32:esp32:esp32`），ESP32 Arduino 核心 3.3.x。

## 程式架構（分層，相依只往下）

```text
SpeedRadar/
├─ SpeedRadar.ino          進入點：組裝 SpeedRadarApp、CPU 80 MHz、看門狗
├─ AppConfig.h             編譯期設定：腳位、藍牙名稱與 UUID、心跳週期、kAllowBleConfig
└─ src/
   ├─ core/      純邏輯（可在電腦上測試）
   │   ├─ GroundSpeedEstimator   有效性判斷 → 折疊還原 → 卡爾曼濾波 → 狀態機 → 里程
   │   ├─ SpeedConfig            執行期參數（8 項）與範圍檢查
   │   ├─ WheelSpeed             輪速感測器（參考值）：車速與圈數
   │   └─ RadarMeasurement       一筆資料框
   ├─ drivers/   C4001Protocol（$DFDMD 解析）、C4001Radar（非阻塞狀態機）、WheelSensor（中斷）、StatusLed
   ├─ comm/      BleLink（NUS、依 MTU 分段、指令佇列）、Telemetry（輸出格式）、CommandParser
   ├─ storage/   SettingsStore（NVS 命名空間 speedRadar）
   └─ app/       SpeedRadarApp：主迴圈排程、指令處理、自動調高測速上限
```

### 資料流

```text
C4001（10 Hz）→ C4001Radar → GroundSpeedEstimator.onFrame() → Telemetry → BleLink / USB（每筆資料框一行）
                                       ↑ update()：逾時（保持 → 靜止／中斷）、兩筆之間的狀態傳播、里程
WheelSensor（中斷）→ WheelSpeed → Telemetry 的 W / DW
BleLink / USB（指令）→ CommandParser → SettingsStore（NVS）→ 必要時重新設定雷達
```

### C4001 驅動

不使用 DFRobot 函式庫：它會阻塞等待回應，雷達沒回應時可能卡住。`C4001Radar` 是非阻塞狀態機：

```text
Offline → Configuring → Verifying → Online ⇄ Probing
```

- **開機時完整設定一次**：`sensorStop` → `setRunApp 1` → `sensorStop` → `setRange <窗口>` → `setThrFactor <RTHR>` → `setMicroMotion 0` → `saveConfig` → `getRange`、`getThrFactor` 讀回 → `sensorStart`。
  - 距離窗口由 `ANGLE`、`HEIGHT` 算出，預設是 `setRange 0.62 2.40`。
  - 之後斷線只送 `sensorStart`。
  - 網頁改了 `ANGLE`、`HEIGHT`、`RTHR` 才重新完整設定（約 4 秒）。
- 雷達的回覆會印在序列埠，例如 `[雷達] 讀回 getRange：0.620 2.400`；被拒絕的指令印成 `[雷達] 指令被拒絕（第 N 步）`。
- 連續失敗時，重試間隔從 3 秒加倍到 60 秒，避免一直寫雷達的 flash。
- 約 2.5 秒沒有資料就判定離線並自動重連。

### 對地速度估計（GroundSpeedEstimator）

完整說明、公式、參數依據與文獻見 [ALGORITHM.md](../docs/ALGORITHM.md) §6：

1. **逐筆判斷**：
   - 沒目標、外插資料框、距離不在地面窗口、靜止回波、方向與 `DIR` 相反、原始值在測速上限附近。
   - 每一筆都有判斷碼 `FV`，網頁的「數據」頁會統計。
2. **折疊還原**：追蹤中依預測速度，還原超過 `VMAX` 而被雷達折疊的讀值。
   - 剛失去訊號時，改用中斷前的速度（10 秒內有效）。
   - 量到明顯超過 `VMAX` 的值時，`SpeedRadarApp` 會自動把 `VMAX` 調為 10 m/s 並存檔。
3. **換算**：`g = CAL·|vr|/cos θ`（`MODEL 0`），或逐筆用 `sin α = h / r`（`MODEL 1`）。
4. **卡爾曼濾波**：
   - 狀態為速度、加速度（等加速度模型）。
   - 量測雜訊由二階差分的中位數自動估計。
   - 過程雜訊依正規化創新平方自動切換（巡航平順、加減速跟得上）。
   - 3σ 閘門；連續 3 筆一致的離群值會重新初始化。
5. **狀態機**：靜止 → 擷取（3 筆一致）→ 追蹤 ⇄ 保持 → 靜止／訊號中斷／超出上限。
6. **里程**：用量測值積分（急煞時濾波落後不會多算距離）；保持期間的距離依結果補回。

### LED（板載藍燈，GPIO2）

| 燈號 | 意思 |
| --- | --- |
| 慢閃（0.5 秒） | 正常，等待手機連線 |
| 快閃（0.15 秒） | 手機已連線 |
| 恆亮 | 正在量到地面速度（追蹤中） |
| 每秒閃兩下 | 雷達離線或初始化中 |

## 參數

**執行中可調**：存在 NVS，可從網頁或指令修改。

| 指令 | 意義 | 預設 |
| --- | --- | --- |
| `ANGLE` | 俯角（度） | 45 |
| `HEIGHT` | 離地高度（m） | 0.70 |
| `DIR` | 朝向：1 朝後、-1 朝前 | 1 |
| `MODEL` | 0 固定角度、1 距離幾何 | 0 |
| `CAL` | 校正係數 | 1.0000 |
| `RTHR` | C4001 偵測門檻 | 5 |
| `WHEEL` | 輪周長（mm） | 2105 |
| `VMAX` | C4001 徑向測速上限（m/s） | 3.28 |

範圍見 [PROTOCOL.md](../docs/PROTOCOL.md) §3。

**編譯期**（`AppConfig.h`）：
- 腳位：雷達 16／17、輪速感測器 27、LED 2。
- 藍牙名稱 `BSIS-Speed`、MTU 247、心跳 250 ms。
- `kAllowBleConfig`：設為 `false` 時，藍牙只能讀資料，修改參數必須用 USB。

## 測試

`tests/host_tests.cpp` 在電腦上編譯 `src/core`、`src/comm`、`src/drivers/C4001Protocol` 的純邏輯，共 318 項檢查：

- 資料框解析：含 C4001 實測的空白欄位。
- 幾何：距離窗口、兩種換算模型。
- 估計器：
  - 擷取、追蹤、停車、保持、中斷、重新擷取、急煞時重新初始化。
  - 剔除：外插框、窗口外、方向相反、離群值、停車時的雜散目標、DIR 設反。
  - 測速上限：截斷、折疊還原、自動調高的觸發、中斷後以先前速度還原。
  - 雜訊、加減速、雜散目標、回波斷續下的精度（模擬）。
- 指令範圍、輸出格式（最長一行放得進緩衝區）、輪速感測器。

最後會印出兩張模擬報表（情境表現、路面 × 模型），就是 ALGORITHM.md §9 的數據。

```powershell
.\arduino.ps1 test       # 或 sh tests/run_tests.sh
```

- 需要電腦端的 g++（例如 MinGW-w64）。
- 新增 `.cpp` 時，要同時加進 `arduino.ps1` 的 `$TestSources` 與 `tests/run_tests.sh`。
- 測試執行檔產生在 `tests/`：Windows 會擋暫存資料夾裡新編出來的 exe，而 `tests/*.exe` 已排除在 git 外。

## 診斷工具

`diagnostics/` 有三個工具：
- USB ⇄ C4001 直通程式：直接對雷達下指令。
- `analyze.awk`：分析直通紀錄。
- `analyze_ride.py`：分析網頁下載的騎乘 CSV，判斷測速上限、比較兩種模型、比對輪速。

說明見 [diagnostics/README.md](diagnostics/README.md)。

## 版本

- 3.x：對地測速（本版）。
- 2.x：後方來車偵測，最後一版是 2.4.0，commit `8a5c3b6`。可用 `git checkout 8a5c3b6 -- firmware` 取回。
