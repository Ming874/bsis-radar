# 韌體：BSIS 對地測速雷達（ESP32 + 兩顆 HLK-LD2451）

讀取斜照路面的 HLK-LD2451（測速雷達），估計自行車對地速度與里程；讀取朝後的另一顆 HLK-LD2451（後方雷達），判斷後方來車的警示等級。經藍牙（Nordic UART Service）與 USB 序列埠輸出。演算法見 [docs/ALGORITHM.md](../docs/ALGORITHM.md)（4.0 的設計在 §0）、[docs/REAR_RADAR.md](../docs/REAR_RADAR.md)，資料格式見 [docs/PROTOCOL.md](../docs/PROTOCOL.md)。

3.x 的測速雷達是 DFRobot C4001（驅動、文字協定、測速上限與折疊還原），4.0 拿掉了，程式在 git 歷史裡。

## 燒錄

| 情境 | 做法 |
| --- | --- |
| 只要燒錄 | 雙擊 `flash.bat`（不需要 Arduino IDE）：自動找 COM 埠、必要時協助安裝 CH340 驅動、燒錄 `release\` 的檔案並讀回開機訊息 |
| 改了程式 | `.\arduino.ps1 upload` 編譯並燒錄；確認沒問題後 `.\arduino.ps1 release` 更新 `release\` |

- USB 線要插在 **ESP32 板子本身**的 USB-C 孔；擴充底板的孔只供電。
- `flash.bat` 寫入 bootloader（0x1000）、partitions（0x8000）、boot_app0（0xe000）、韌體（0x10000），**不清除 NVS**，已設定的參數會保留。

## 開發指令（PowerShell，在 `firmware` 資料夾）

```powershell
.\arduino.ps1 setup       # 第一次：安裝 ESP32 開發板套件
.\arduino.ps1 compile     # 編譯（顯示所有警告）
.\arduino.ps1 upload      # 編譯並燒錄（自動找 COM 埠，或 -Port COM3）
.\arduino.ps1 monitor     # 序列埠監看（115200），可直接輸入指令
.\arduino.ps1 ports       # 列出 COM 埠
.\arduino.ps1 test        # 電腦端單元測試與模擬報告（需要 g++）
.\arduino.ps1 devicetest  # 在 ESP32 上跑同一份測試，跑完自動燒回正式韌體
.\arduino.ps1 release     # 輸出 release\（給 flash.bat）與 SHA-256
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
   │   ├─ GroundSpeedEstimator   挑選路面目標（中位數）→ 換算 → 卡爾曼濾波 → 狀態機 → 里程
   │   ├─ RearThreat             後方來車：候選 → 確認 → 追蹤 → 距離趨勢核對 → 分級 → 保持
   │   ├─ RadarFrame             LD2451 一個資料框（最多 5 個目標），兩顆雷達共用
   │   ├─ SpeedConfig            執行期參數（對地測速 7 項＋後方來車 4 項）與範圍檢查
   │   └─ WheelSpeed             輪速感測器（參考值）：車速與圈數
   ├─ drivers/   LD2451Protocol（二進位資料框、指令）、LD2451Radar（自動找鮑率、寫入設定、只接 TX 也能用；
   │             兩顆雷達各一個實例）、WheelSensor（中斷）、StatusLed
   ├─ comm/      BleLink（NUS、依 MTU 分段、指令佇列）、Telemetry（輸出格式）、CommandParser
   ├─ storage/   SettingsStore（NVS 命名空間 speedRadar；從 3.x 升級時沿用安裝幾何）
   └─ app/       SpeedRadarApp：主迴圈排程、指令處理
```

### 資料流

```text
測速 LD2451（UART2）→ LD2451Radar → GroundSpeedEstimator.onFrame() → Telemetry → BleLink / USB（每個資料框一行）
                                            ↑ update()：逾時（保持 → 靜止／中斷）、兩筆之間的狀態傳播、里程
後方 LD2451（UART1）→ LD2451Radar → RearThreat.onFrame() → Telemetry 的 REAR 行（有目標每 0.1 s、平常 0.5 s、等級改變立刻）
WheelSensor（中斷）→ WheelSpeed → Telemetry 的 W / DW
BleLink / USB（指令）→ CommandParser → SettingsStore（NVS）→ 必要時重新寫入雷達設定
```

### LD2451 驅動（兩顆共用）

`LD2451Radar` 是非阻塞狀態機，兩個實例只差在名稱（序列埠訊息的前綴 `[測速雷達]`、`[後方雷達]`）與偵測設定：

```text
Searching ──找到鮑率、指令有回覆──> Configuring ──> Online（完整模式）
    │      └─收得到資料、1.2 秒內指令沒回覆──────> Online（只接收模式）
    └─每個鮑率聽 3.2 秒都沒資料──> Offline ──(5～30 秒後重試)──> Searching
```

- 鮑率自動偵測（原廠 115200）；接收腳一律開內建上拉（LD2451 TX 的高電位偏弱，[REAR_RADAR.md](../docs/REAR_RADAR.md) §2.3）。
- 設定先讀回比對，不同才寫（保護雷達的 flash）：

  | 雷達 | 最大距離 | 方向 | 最低速度 | 訊噪比 | 延遲／累計觸發 |
  | --- | --- | --- | --- | --- | --- |
  | 測速 | 10 m（固定） | 靠近遠離都回報（ESP32 依 `DIR` 判斷） | 1 km/h | `GSNR` | 1 s／1 次 |
  | 後方 | `RANGE` + 10 m | 只回報靠近 | `RSPD` | `RSNR` | 1 s／1 次 |

- 只接收模式（LD2451 RX 沒接）：用雷達自己存的設定，篩選全部在 ESP32 再做一次；每 30 秒再試一次指令，接上 RX 後自動改成完整模式。
- 超過 4 秒沒有任何位元組 → 離線；有位元組但 15 秒都解不出資料框 → 重新找鮑率。

### 對地速度估計（GroundSpeedEstimator）

完整說明見 [ALGORITHM.md](../docs/ALGORITHM.md) §0、§6：

1. **挑選**：每個目標檢查距離窗口（整數公尺）與水平角（±30°），換算 `g = CAL·|vr| / (cos θ · cos φ)`（`MODEL 0`；`MODEL 1` 用 `cos φ · sin α = h / r`）。方向正確的目標取 g 的**中位數**；沒有的話依序判為方向相反、靜止、窗口外。每個資料框都有判斷碼 `FV`，網頁的「數據」頁會統計。
2. **卡爾曼濾波**：
   - 狀態為速度、加速度（等加速度模型）。
   - 量測雜訊由二階差分的中位數自動估計。
   - 過程雜訊依正規化創新平方自動切換（巡航平順、加減速跟得上）。
   - 3σ 閘門；連續 3 筆一致的離群值會重新初始化。
3. **狀態機**：靜止 → 擷取（1 秒內 3 筆一致）→ 追蹤 ⇄ 保持（0.4 秒沒有可用量測）→ 靜止／訊號中斷（2 秒）。
4. **里程**：用量測值積分（急煞時濾波落後不會多算距離）；保持期間的距離依結果補回。

### LED（板載藍燈，GPIO2）

| 燈號 | 意思 |
| --- | --- |
| 慢閃（0.5 秒） | 正常，等待手機連線 |
| 快閃（0.15 秒） | 手機已連線 |
| 恆亮 | 正在量到地面速度（追蹤中） |
| 每秒閃兩下 | 測速雷達離線或初始化中 |

## 參數

**執行中可調**：存在 NVS，可從網頁或指令修改。

| 指令 | 意義 | 預設 |
| --- | --- | --- |
| `ANGLE` | 測速雷達俯角（度，10～75） | 30 |
| `HEIGHT` | 測速雷達離地高度（m） | 0.70 |
| `DIR` | 朝向：1 朝後、-1 朝前 | 1 |
| `MODEL` | 0 固定角度、1 距離幾何 | 0 |
| `CAL` | 校正係數 | 1.0000 |
| `GSNR` | 測速雷達訊噪比門檻（3～8，寫進 LD2451） | 4 |
| `WHEEL` | 輪周長（mm） | 2105 |
| `RANGE` | 後方來車警示距離（m） | 15 |
| `RSPD` | 後方來車最低接近速度（km/h，寫進 LD2451） | 5 |
| `TTC` | 危險的到達時間（s） | 2.5 |
| `RSNR` | 後方雷達訊噪比門檻（寫進 LD2451） | 4 |

範圍見 [PROTOCOL.md](../docs/PROTOCOL.md) §3。對地測速欄位的 NVS 版本 `ver=2`（4.0）：從 3.x（`ver=1`）升級時沿用 `ANGLE`、`HEIGHT`、`DIR`、`WHEEL`，`CAL` 回到 1、`MODEL`、`GSNR` 用預設值，C4001 的 `rthr`、`vmax` 在下次存檔時刪除。後方來車的 4 項另外記版本（`rver`），不受影響。

**編譯期**（`AppConfig.h`）：
- 腳位：測速 LD2451 16（接雷達 TX）／17（接雷達 RX）、後方 LD2451 25／26（RX 沒接也能用）、輪速感測器 27、LED 2。`kPinRearRx = -1` 表示沒有後方雷達。
- 藍牙名稱 `BSIS-Speed`、MTU 247、心跳 250 ms。
- `kAllowBleConfig`：設為 `false` 時，藍牙只能讀資料，修改參數必須用 USB。

## 測試

`tests/host_tests.cpp` 編譯 `src/core`、`src/comm`、`src/drivers/LD2451Protocol` 的純邏輯，共 360 項檢查：

- 幾何：距離窗口（含整數公尺的取整）、兩種換算模型（含水平角）、徑向速度的正負。
- 估計器：
  - 擷取、追蹤、停車、保持、中斷、重新擷取、急煞時重新初始化、空資料框之間的逾時。
  - 一個資料框多個目標：中位數、偶數個、水平角換算、路面＋後方來車、窗口外、目標數超過 5。
  - 剔除：窗口外、方向相反、離群值、停車時的雜散目標、DIR 設反。
  - 雜訊、加減速、雜散目標、回波斷續、每框只有 1 個點時的精度（模擬，`GroundRadarSim` 模擬 LD2451 的整數距離與整數 km/h）。
- 指令範圍、輸出格式（最長一行放得進緩衝區、也放得進一個藍牙通知）、輪速感測器。
- LD2451 協定：指令位元組、空資料框與多目標資料框、實機擷取到的位元錯誤、格式檢查。
- 後方來車：來車接近（注意 → 危險 → 保持 → 安全）、單筆雜訊、遠離／太慢／太遠、5 m 內、位元錯誤的跳值、第二台車、方向判斷錯誤、資料框停止。

最後會印出兩張模擬報表（情境表現、路面 × 模型），就是 ALGORITHM.md §0.6 的數據。

```powershell
.\arduino.ps1 test         # 電腦上跑（或 sh tests/run_tests.sh）
.\arduino.ps1 devicetest   # 在 ESP32 上跑（約 1.5 分鐘，含燒回正式韌體）
```

- `test` 需要電腦端的 g++：PATH 上的 → `C:\MinGW\bin` → winget 裝的 WinLibs（`winget install BrechtSanders.WinLibs.POSIX.UCRT`）。
- 測試執行檔產生在 `tests/`（已排除在 git 外）。開了 Windows「智慧型應用程式控制」的電腦會擋新編出來的 exe（「An Application Control policy has blocked this file」），這時改用 `devicetest`：同一份程式在 ESP32 上跑，結果從序列埠讀回，跑完自動燒回正式韌體（NVS 參數不受影響）。
- 新增 `.cpp` 時，要同時加進 `arduino.ps1` 的 `$TestSources` 與 `tests/run_tests.sh`。

## 診斷工具

`diagnostics/` 有兩個工具：
- `LD2451Probe`：自動找出 LD2451 接在哪兩支腳、用哪個鮑率，讀回設定並印出每個資料框。
- `analyze_ride.py`：分析網頁下載的騎乘 CSV：資料框統計、測速雷達的目標與距離分布、比較兩種模型、比對輪速。

說明見 [diagnostics/README.md](diagnostics/README.md)。

## 版本

- 4.0：測速雷達從 DFRobot C4001 換成 HLK-LD2451（和後方雷達同型號）。
- 3.1：加上後方來車（HLK-LD2451）。
- 3.0：對地測速（C4001）。
- 2.x：後方來車偵測，最後一版是 2.4.0，commit `8a5c3b6`。可用 `git checkout 8a5c3b6 -- firmware` 取回。
