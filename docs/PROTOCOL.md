# ESP32 ⇄ 網頁通訊協定（韌體 3.x）

ESP32 與網頁之間以**一行一筆的純文字**溝通：`鍵=值` 以空白分隔，每行以 `\n` 結尾。同一套指令也可以從 USB 序列埠（115200 bps）輸入，USB 端輸出的遙測與藍牙完全相同，可直接用同一套工具記錄與分析。

韌體實作：`firmware/SpeedRadar/src/comm/Telemetry.cpp`、`CommandParser.cpp`；網頁實作：`web/src/domain/protocol.ts`。

## 1. 傳輸層：BLE Nordic UART Service

| 項目 | 值 |
| --- | --- |
| 裝置名稱 | `BSIS-Speed`（2.x 以前為 `RadarA-ESP32`） |
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX（網頁 → ESP32，Write） | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX（ESP32 → 網頁，Notify） | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |
| MTU | ESP32 要求 247，實際值由手機決定 |

- ESP32 依協商到的 MTU 把一行切成多個通知（每段最多 MTU − 3 位元組，上限 180），網頁收到 `\n` 才組成一行。
- 一般藍牙序列 App（nRF Connect、Serial Bluetooth Terminal）也能連線並收發相同文字。
- 藍牙**沒有加密**。安裝與校正完成後，可將 `AppConfig.h` 的 `kAllowBleConfig` 改為 `false`：藍牙只能讀資料，修改參數必須經由 USB。

## 2. 遙測（ESP32 → 網頁）

每收到一筆 C4001 資料框（約 10 Hz）送一行；雷達沒有資料時每 250 ms 送一行心跳，心跳的 `FN` 不變。

```text
R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.5 W=5.51 DW=1240.2 T=812
```

| 欄位 | 意義 | 單位／格式 | 沒有資料時 |
| --- | --- | --- | --- |
| `R` | 雷達是否在線（ESP32 有收到 C4001 的資料框） | 0／1 | — |
| `ST` | 估計器狀態，見 §2.1 | 0～6 | `0` |
| `V` | 對地速度（濾波後、已乘校正係數） | m/s，2 位小數 | `-1`（速度未知） |
| `SD` | `V` 的 1σ 不確定度（卡爾曼濾波的共變異數） | m/s | `0` |
| `Q` | 最近 20 筆資料框中可用量測（採用、折疊還原）的比例 | % | `0` |
| `WD` | 最近 20 筆資料框中「方向相反」的比例；持續偏高代表 `DIR` 可能設反 | % | `0` |
| `FN` | 資料框序號（開機起累計） | 整數 | — |
| `N` | 這一筆資料框的目標數（C4001 最多 1 個） | 0／1 | `0` |
| `RD` | 原始距離 | m | `-1` |
| `RV` | 原始徑向速度（C4001 自己的正負號：遠離為正） | m/s | `0` |
| `E` | 原始反射能量 | 整數 | `0` |
| `G` | 這一筆換算的對地速度（濾波前） | m/s | `-1`（沒有換算） |
| `FV` | 這一筆的判斷結果，見 §2.2 | 0～9 | `1` |
| `DR` | 雷達里程（開機起） | m，1 位小數 | — |
| `W` | 輪速感測器的速度（參考值） | m/s | 開機後沒收過脈衝時不送 |
| `DW` | 輪速感測器的里程（圈數 × 輪周長） | m | 同上 |
| `T` | ESP32 開機後經過的時間 | s | — |

雷達離線（`R=0`）時 `ST=0`、`V=-1`，不送過時的原始值；`W`／`DW` 與雷達無關，照常送出。最長的一行約 150 位元組，韌體緩衝區 176 位元組（單元測試會檢查）。

### 2.1 估計器狀態 `ST`

| 值 | 名稱 | 意義 | `V` |
| --- | --- | --- | --- |
| 0 | NoRadar | 雷達離線或尚未有資料 | `-1` |
| 1 | Stopped | 靜止 | `0` |
| 2 | Acquiring | 剛看到地面回波，確認中（3 筆一致才開始追蹤） | `0` |
| 3 | Tracking | 正常追蹤 | 估計值 |
| 4 | Holding | 短暫失去地面回波，沿用估計值（最多 2 秒） | 估計值 |
| 5 | Lost | 訊號中斷 | `-1` |
| 6 | OverRange | 速度超過雷達測速上限（`VMAX`） | `-1` |

### 2.2 資料框判斷 `FV`

| 值 | 名稱 | 意義 |
| --- | --- | --- |
| 0 | Accepted | 採用，用來更新速度 |
| 1 | NoTarget | 雷達沒有回報目標 |
| 2 | Repeated | C4001 的外插資料框（速度、能量與上一筆完全相同），不算量測 |
| 3 | OutOfGate | 距離不在地面距離窗口內（不是腳下的路面） |
| 4 | WrongDirection | 速度方向與 `DIR` 相反 |
| 5 | Static | 靜止回波（徑向速度約 0），或停著時的微小晃動 |
| 6 | AtLimit | 原始徑向速度在 `VMAX` 附近，不可靠 |
| 7 | Outlier | 與目前估計相差超過 3σ 閘門 |
| 8 | Acquiring | 擷取階段的量測 |
| 9 | Unfolded | 採用；都卜勒超過 `VMAX` 被雷達折疊，已依預測還原 |

## 3. 設定（ESP32 → 網頁）

回應 `GET`，以及每次設定成功後主動廣播一次：

```text
CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=10.0 RMIN=0.62 RMAX=2.15 FW=3.0.0
```

| 欄位 | 指令 | 意義 | 範圍 | 預設 |
| --- | --- | --- | --- | --- |
| `ANGLE` | `ANGLE <度>` | 雷達視軸的俯角（與水平面的夾角） | 15～75 | 45 |
| `HEIGHT` | `HEIGHT <m>` | 雷達天線面中心的離地高度 | 0.15～1.50 | 0.70 |
| `DIR` | `DIR 1\|-1` | 雷達朝向：`1` 朝後（地面遠離，C4001 回報正值）、`-1` 朝前 | 1／-1 | 1 |
| `MODEL` | `MODEL 0\|1` | 速度模型：`0` 固定角度、`1` 距離幾何（[ALGORITHM.md](ALGORITHM.md) §5） | 0／1 | 0 |
| `CAL` | `CAL <係數>` | 校正係數，速度與里程都乘上它 | 0.5～2.0，4 位小數 | 1.0000 |
| `RTHR` | `RTHR <n>` | C4001 本身的偵測門檻（`setThrFactor`），越大越不靈敏 | 1～50 的整數 | 5 |
| `WHEEL` | `WHEEL <mm>` | 輪周長，只用於輪速感測器（參考值） | 1000～3000 的整數 | 2105 |
| `VMAX` | `VMAX <m/s>` | C4001 徑向測速上限，用於截斷偵測與折疊還原 | 2～20 | 10.0 |
| `RMIN`／`RMAX` | — | 由 `ANGLE`、`HEIGHT` 算出的地面距離窗口（唯讀） | m | — |
| `FW` | — | 韌體版本 | — | — |

- 參數存在 ESP32 的 NVS（命名空間 `speedRadar`），斷電不會消失；3.0 不讀取 2.x 的設定。
- 修改 `ANGLE`、`HEIGHT`、`RTHR` 時，ESP32 會把新的距離窗口與門檻寫進 C4001，約 4 秒內沒有資料框（`R=0`）。

## 4. 指令（網頁 → ESP32）

一行一個指令，大小寫不拘，數值可用空白、`=` 或 `:` 分隔，以 `\n` 結尾。

| 指令 | 作用 |
| --- | --- |
| `GET` | 回傳一行 `CFG` |
| `ANGLE 45`、`HEIGHT 0.7`、`DIR -1`、`MODEL 1`、`CAL 1.0425`、`RTHR 5`、`WHEEL 2105`、`VMAX 10` | 修改單一參數 |
| `DEFAULTS` | 所有參數恢復預設值 |
| `REBOOT` | 重新啟動 ESP32 |
| `HELP` 或 `?` | 列出所有指令 |

### 指令回覆

| 回覆 | 時機 |
| --- | --- |
| `OK saved` | 設定成功並已存檔，接著廣播一行 `CFG` |
| `OK applied (flash save failed)` | 已生效，但寫入快閃記憶體失敗（重開機會還原） |
| `OK reboot` | 收到 `REBOOT`，約 0.2 秒後重新開機 |
| `OK commands: …` | `HELP` 的指令列表 |
| `ERR <參數> must be <範圍>` | 數值超出範圍或格式錯誤（例如 `ERR ANGLE must be 15-75 (deg)`） |
| `ERR missing or bad value` | 缺少數值，或數值後面有多餘文字 |
| `ERR settings over Bluetooth are disabled, use USB` | `kAllowBleConfig = false` 時從藍牙修改參數 |
| `ERR unknown command, try HELP` | 不認得的指令 |

## 5. 解析規則

- 以空白切成 `鍵=值`；**不認得的鍵直接忽略**，之後新增欄位不會破壞舊的接收端。
- 同一行出現重複的鍵代表兩行被黏在一起（藍牙分段遺失），整行丟棄。
- 數值一律使用小數點、不含單位；`-1` 代表「沒有資料」（`V`、`RD`、`G`）。
- 開頭為 `CFG` 的是設定，`OK`／`ERR` 是指令回覆，其他含 `R`、`ST`、`V` 的是遙測。
- 判斷韌體世代：`CFG` 含 `TEST=`、`MINSPD=` 的是 2.x（後方來車偵測版），網頁會提示更新韌體。

## 6. CSV 紀錄格式（網頁「數據 → 記錄 CSV」）

每一筆新的資料框一列（心跳行不重複記錄），UTF-8 含 BOM，Excel 可直接開啟。欄位與遙測一一對應：

```text
time_iso,uptime_s,frame,radar_online,state,speed_mps,sigma_mps,quality_pct,targets,range_m,radial_mps,energy,ground_mps,verdict,radar_distance_m,wheel_mps,wheel_distance_m
```

`state` 與 `verdict` 以名稱表示（`tracking`、`accepted`…）。分析工具：[`firmware/diagnostics/analyze_ride.py`](../firmware/diagnostics/README.md)。

## 7. 網頁的匯出檔

這兩種檔案只在網頁產生，不經過 ESP32。

**行程紀錄**（「行程」頁的匯出，CSV，UTF-8 含 BOM）：一筆行程一列。

```text
start_iso,end_iso,distance_m,moving_s,elapsed_s,avg_kmh,max_kmh,overspeed_count,overspeed_s,limit_kmh,wheel_distance_m
```

`avg_kmh` 是里程 ÷ 移動時間；沒有的欄位留空（網頁 2.1 以前的行程沒有超速，3.0 以前沒有 `limit_kmh`）。

**一筆行程的速度曲線**（行程詳情的匯出，CSV）：`elapsed_s,speed_kmh`。每一格是那段時間的平均速度，間隔從 1 秒開始，點數到 900 時兩兩合併、間隔加倍（一小時的行程是 4 秒一格）；藍牙中斷的那幾格留空。

**備份檔**（「設定 → 資料 → 匯出備份」，JSON）：

```json
{ "app": "bsis-speed", "version": 1, "exportedAt": 1792000000000, "webVersion": "3.0.0",
  "settings": { "speedUnit": "kmh", "speedLimitKmh": 25, "...": "..." },
  "trips": [ { "id": "…", "startedAt": 0, "endedAt": 0, "distanceM": 0, "movingS": 0, "maxMps": 0, "trace": { "stepS": 1, "v": [512, -1, 530] } } ],
  "calibration": { "runs": [ { "id": "…", "method": "distance", "radarM": 95.2, "referenceM": 100, "calibrationUsed": 1 } ], "lastApplied": null } }
```

`trace.v` 是 cm/s 的整數，`-1` 代表那一格沒有資料。匯入時逐筆檢查：格式不對的行程或校正紀錄略過；設定只取認得的欄位；行程與校正紀錄依 `id` 合併，不會重複。
