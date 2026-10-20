# 診斷工具

平常不需要這些工具。要確認 C4001 本身的行為（設定、原始資料框）或分析騎乘紀錄時再用。PowerShell 指令都在 `firmware\diagnostics` 執行；COM 埠號會變，先用 `..\arduino.ps1 ports` 確認。

| 檔案 | 用途 |
| --- | --- |
| `analyze_ride.py` | 分析網頁「數據 → 記錄 CSV」下載的騎乘紀錄：資料框統計、C4001 測速上限（截斷或折疊）、兩種速度模型的最佳校正係數、與輪速的比對 |
| `C4001Bridge/` | 暫時燒進 ESP32 的直通程式：USB（115200）⇄ C4001（9600），每行加上 ESP32 時間（ms），可直接對雷達下指令 |
| `bridge.ps1` | 搭配直通程式：依序送指令並記錄雷達的每一筆原始輸出 |
| `analyze.awk` | 分析 `bridge.ps1` 的紀錄：偵測率、外插資料框、距離／速度／能量統計、每秒時間軸 |

## 分析騎乘紀錄

只用 Python 標準函式庫（3.8 以上）：

```powershell
python analyze_ride.py bsis-speed_20261021_093012.csv --angle 45 --height 0.70
```

`--angle`、`--height` 填裝置上的 `ANGLE`、`HEIGHT`（網頁「校正」頁，或主控台的 `CFG`）。報告內容：

1. **資料框**：頻率、各判斷（採用、沒有目標、窗口外…）的比例、追蹤中的可用比例。
2. **C4001 測速上限**：徑向速度的最大值。
   - 讀值堆積在最大值附近：**截斷**。
   - 在上限附近突然反向：**折疊**。
   - 會給出建議的 `VMAX`。
3. **速度模型比較**（需要輪速感測器）：只取穩定騎乘的資料框（輪速 ≥ 2 m/s、加速度 ≤ 0.4 m/s²），以輪速為參考，算出固定角度與距離幾何各自的最佳 `CAL`，以及單筆殘差的 1σ。
4. **雷達輸出 vs 輪速**：穩定騎乘時的速度差、整段的里程差，以及雷達相對輪速的時間差。

驗收流程見 [docs/GETTING_STARTED.md](../../docs/GETTING_STARTED.md) §10。

## 直通程式：直接問雷達

```powershell
$cli = $env:ARDUINO_CLI   # 或 Arduino IDE 內建的 arduino-cli.exe
& $cli compile --fqbn esp32:esp32:esp32 --build-path .\.bridge_build .\C4001Bridge
& $cli upload --fqbn esp32:esp32:esp32 --port COM7 --input-dir .\.bridge_build .\C4001Bridge

# 讀回雷達存的設定（每項 "等待毫秒|指令"）
.\bridge.ps1 -Port COM7 -Steps '200|sensorStop','1300|getRange','500|getThrFactor','500|getMicroMotion','500|sensorStart' -TailSeconds 3

# 記錄 30 秒原始資料框
.\bridge.ps1 -Port COM7 -Steps '500|sensorStart' -TailSeconds 30 -Out raw.txt
```

分析紀錄（Git Bash）：`awk -f analyze.awk raw.txt`

**用完一定要燒回正式韌體**（`..\flash.bat` 或 `..\arduino.ps1 upload`）。正式韌體開機時會重新寫入雷達設定，直通期間改過的雷達設定不會留下影響；ESP32 上的參數（NVS）也不受影響。

## 注意

- Windows PowerShell 5.1 會用系統編碼讀沒有 BOM 的 `.ps1`，所以 `bridge.ps1` 只用英文。
- 紀錄檔（`*.txt`）與 `.bridge_build/` 不放進 git。
- 2.x（後方來車偵測）的語音引導走動測試（`guided_test.ps1`）已移除，保留在 commit `8a5c3b6`。
