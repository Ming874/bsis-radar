# 診斷工具

平常不需要這些工具。要確認 LD2451 接在哪裡、分析騎乘紀錄時再用。PowerShell 指令都在 `firmware\diagnostics` 執行；COM 埠號會變，先用 `..\arduino.ps1 ports` 確認。

| 檔案 | 用途 |
| --- | --- |
| `analyze_ride.py` | 分析網頁「數據 → 記錄 CSV」下載的騎乘紀錄：資料框統計、測速雷達的目標與距離分布、兩種速度模型的最佳校正係數、與輪速的比對 |
| `LD2451Probe/` | 暫時燒進 ESP32：自動找出 HLK-LD2451 接在哪兩支腳、用哪個鮑率，讀回韌體與設定，之後每個資料框印一行 |

3.x 的 C4001 直通程式（`C4001Bridge`、`bridge.ps1`、`analyze.awk`）在 4.0 換成 LD2451 時移除，保留在 git 歷史。

## 分析騎乘紀錄

只用 Python 標準函式庫（3.8 以上）：

```powershell
python analyze_ride.py bsis-speed_20261111_093012.csv --angle 30 --height 0.70
```

`--angle`、`--height` 填裝置上的 `ANGLE`、`HEIGHT`（網頁「校正」頁，或主控台的 `CFG`）。報告內容：

1. **資料框**：頻率、各判斷（採用、沒有目標、窗口外…）的比例、追蹤中的可用比例。
2. **測速雷達（LD2451）的目標**：每框幾個目標、追蹤中有目標的比例與資料框間隔（有目標時的輸出頻率）、採用的距離／水平角／訊噪比分布、徑向速度最大值。這是驗收第一項「量得到路面」的依據（[GETTING_STARTED.md](../../docs/GETTING_STARTED.md) §10.1）。
3. **速度模型比較**（需要輪速感測器）：只取穩定騎乘的資料框（輪速 ≥ 2 m/s、加速度 ≤ 0.4 m/s²），以輪速為參考，算出固定角度與距離幾何各自的最佳 `CAL`，以及單筆殘差的 1σ（換算含水平角，與韌體相同）。
4. **雷達輸出 vs 輪速**：穩定騎乘時的速度差、整段的里程差，以及雷達相對輪速的時間差。

網頁 3.x（C4001）的 CSV 也讀得進來：沒有 `angle_deg` 時當作 0°。驗收流程見 [docs/GETTING_STARTED.md](../../docs/GETTING_STARTED.md) §10。

## LD2451 腳位偵測

```powershell
$cli = $env:ARDUINO_CLI
& $cli compile --fqbn esp32:esp32:esp32 --build-path .\.probe_build .\LD2451Probe
& $cli upload --fqbn esp32:esp32:esp32 --port COM3 --input-dir .\.probe_build .\LD2451Probe
..\arduino.ps1 monitor -Port COM3
```

1. **被動**：同時監看 19 支候選腳 2.5 秒，電位有變化的就是 LD2451 TX；在那支腳上依序試 8 種鮑率並印出原始位元組（`SNIFF`）。
2. **找 TX**：知道 RX 之後，輪流在候選腳上送「進入設定」，有回覆的就是接到 LD2451 RX 的腳（先用開汲極、再用推挽；GPIO27／2／0 只用開汲極）。
3. **被動找不到**時（LD2451 沒有目標時可能完全不送）：輪流在候選腳送指令，看哪一支腳有回覆。
4. 印出 `RESULT rx=… tx=… baud=…`、10～30 秒的原始位元組（看資料框間隔與位元錯誤）、韌體版本、目標參數、靈敏度，之後每個資料框一行（`FRAME targets=… | angle=… dist=… dir=… speed=…`）。
5. 序列埠可輸入 `R`（讀設定）、`T <距離> <方向> <速度> <延遲>`、`S <觸發次數> <訊噪比>`。

候選腳不含 GPIO16／17（3.x 接 C4001，4.0 接測速 LD2451）、USB（1／3）、flash（6～11），所以它找的是後方雷達。要查測速雷達時，暫時把測速雷達的 TX／RX 改接到候選腳，或直接看正式韌體開機時的 `[測速雷達]` 訊息。本機 2026-11-04 的結果見 [REAR_RADAR.md](../../docs/REAR_RADAR.md) §2.3。

**用完一定要燒回正式韌體**（`..\flash.bat` 或 `..\arduino.ps1 upload`）。正式韌體開機時會重新寫入雷達設定；ESP32 上的參數（NVS）不受影響。

## 注意

- Windows PowerShell 5.1 會用系統編碼讀沒有 BOM 的 `.ps1`：有中文的 `.ps1` 一定要存成 UTF-8 含 BOM。
- 紀錄檔（`*.txt`）、`.probe_build/` 不放進 git。
- 2.x（後方來車偵測）的語音引導走動測試（`guided_test.ps1`）已移除，保留在 commit `8a5c3b6`。
