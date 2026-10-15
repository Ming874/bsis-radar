# C4001 診斷工具

[docs/ALGORITHM.md §10](../../docs/ALGORITHM.md) 的實測就是用這些工具做的。平常不需要；懷疑雷達本身的輸出或設定有問題時再用。

| 檔案 | 用途 |
| --- | --- |
| `C4001Bridge/` | 暫時燒進 ESP32 的直通程式：USB（115200）⇄ C4001（9600），每行加上 ESP32 時間（ms），可以直接對雷達下指令 |
| `bridge.ps1` | 搭配直通程式：依序送指令並記錄雷達的每一筆原始輸出 |
| `analyze.awk` | 分析 `bridge.ps1` 的紀錄：偵測率、外插資料框、距離／速度／能量統計、每秒時間軸 |
| `guided_test.ps1`、`prompts.txt` | 搭配**正式韌體**：用中文語音引導人移動（離開 → 站著 → 來回走），逐輪比較不同的 `RTHR` |

PowerShell 指令都在 `firmware\diagnostics` 執行；COM 埠號會變，先用 `..\arduino.ps1 ports` 確認。

## 直通程式：直接問雷達

```powershell
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
$cfg = "$env:USERPROFILE\.arduinoIDE\arduino-cli.yaml"
& $cli --config-file $cfg compile --fqbn esp32:esp32:esp32 --build-path .\.bridge_build .\C4001Bridge
& $cli --config-file $cfg upload --fqbn esp32:esp32:esp32 --port COM3 --input-dir .\.bridge_build .\C4001Bridge

# 讀回雷達存的設定（每項 "等待毫秒|指令"）
.\bridge.ps1 -Steps '200|sensorStop','1300|getRange','500|getThrFactor','500|getMicroMotion','500|sensorStart' -TailSeconds 3

# 改門檻後記錄 30 秒原始資料
.\bridge.ps1 -Steps '200|sensorStop','1300|setThrFactor 5','300|saveConfig','500|sensorStart' -TailSeconds 30 -Out raw_thr5.txt
```

用 Git Bash 分析：`awk -f analyze.awk raw_thr5.txt`

**用完一定要燒回正式韌體**（`..\arduino.ps1 upload`）：正式韌體開機時會重新寫入雷達設定，直通期間改過的雷達設定不會留下影響。ESP32 上的偵測參數（NVS）不受影響。

## 語音引導走動測試（正式韌體）

```powershell
.\guided_test.ps1 -Port COM3 -Thresholds 5,15,30 -OutDir .
```

每輪約 1.5 分鐘：先改 `RTHR`（雷達重新設定約 4 秒）→ 離開雷達前方 20 秒 → 回到前方約 2 m 站著 15 秒 → 在 1～4 m 之間來回走 30 秒；結束後改回 `RTHR 5`。每輪的序列埠輸出（每 0.2 秒一行，含原始資料與追蹤結果）存成 `guided_fw_rthr<N>.txt`，`#PHASE` 行標出各階段。需要喇叭與中文語音（Windows 的 Microsoft Hanhan）。

## 注意

- Windows PowerShell 5.1 會用系統編碼讀沒有 BOM 的 `.ps1`：腳本裡只能用英文（中文會讓參數宣告失效），中文提示放在 `prompts.txt`。
- 紀錄檔（`*.txt`）與 `.bridge_build/` 不用放進 git。
