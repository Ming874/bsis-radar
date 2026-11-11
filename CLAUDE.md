# BSIS 專題：對地測速雷達＋後方來車雷達（兩顆 HLK-LD2451）

- GitHub：https://github.com/Ming874/bsis-radar（公開；`main` 分支）
- 4.0 起兩顆雷達都是 HLK-LD2451：**測速雷達**斜照路面量對地速度（取代 3.x 的 DFRobot C4001，設計在 `docs/ALGORITHM.md` §0）、**後方雷達**朝正後方偵測來車（3.1 起，`docs/REAR_RADAR.md`）。3.x（C4001 測速）在 4.0 之前的 commit；2.x（C4001 當後方來車雷達）在 commit `8a5c3b6`
- **最大的未知**：LD2451 是設計來偵測車輛的，斜照路面會不會穩定回報路面、近距離盲區、有目標時的輸出頻率、距離怎麼取整數都還沒實測（ALGORITHM.md §0.7、GETTING_STARTED.md §10.1）
- `firmware/`：ESP32 韌體（Arduino，sketch 在 `firmware/SpeedRadar`，版本在 `AppConfig.h` 的 `FW_VERSION`）
  - 開發：`firmware/arduino.ps1`（compile / upload / monitor / test / devicetest / release）。arduino-cli 的搜尋順序：`$env:ARDUINO_CLI` → Arduino IDE 內建 → PATH。這台電腦（2026-11）有 Arduino IDE（`%LOCALAPPDATA%\Programs\Arduino IDE`，內建 arduino-cli），沒有設 `ARDUINO_CLI`；ESP32 套件 3.3.12 裝在 `%LOCALAPPDATA%\Arduino15`
  - 一鍵燒錄（不需 Arduino IDE）：雙擊 `firmware/flash.bat`，燒錄 `firmware/release/` 的預編譯檔；改了程式先跑 `.\arduino.ps1 release`
  - 燒錄時 USB 要插在 ESP32 板子本身的 USB-C 孔（擴充底板的孔只供電）；USB 晶片是 CH340，COM 埠號會變（出現過 COM7、COM3），用 `.\arduino.ps1 ports` 或裝置管理員確認
  - 估計器 `src/core/GroundSpeedEstimator`：每個資料框（最多 5 個目標）挑出方向正確、在整數距離窗口內、水平角 ±30° 內的目標，換算 `CAL·|vr|/(cos θ·cos φ)` 後取中位數 → 卡爾曼 → 狀態機。改了 `src/core` 先跑測試（360 項，最後印出模擬報表）；新增 .cpp 要同時加進 `arduino.ps1` 的 `$TestSources` 與 `tests/run_tests.sh`
  - 測試：`.\arduino.ps1 test` 用電腦端 g++（PATH → `C:\MinGW\bin` → winget 裝的 WinLibs，這台是 WinLibs）。**這台電腦的 Windows 智慧型應用程式控制會擋新編出來的 `host_tests.exe`**（「An Application Control policy has blocked this file」），不要想辦法繞過；改用 `.\arduino.ps1 devicetest -Port COMx`：同一份測試在 ESP32 上跑（約 1.5 分鐘），跑完自動燒回正式韌體，NVS 不受影響
  - 接線：測速 LD2451 TX → GPIO16、RX → GPIO17（UART2）；後方 LD2451 TX → GPIO25、RX → GPIO26（UART1）；VIN 都要 5 V。同一個驅動 `src/drivers/LD2451Radar` 兩個實例（名稱 `測速雷達`／`後方雷達` 只是序列埠訊息前綴），鮑率自動偵測（原廠 115200）。2026-11-11 兩顆都接好 RX、指令都有回覆（完整模式），韌體都是 V1.19.25070114
  - 寫進雷達的設定：測速 10 m／靠近遠離都回報（方向由 ESP32 依 `DIR` 判斷）／1 km/h／`GSNR`；後方 `RANGE`+10 m／只回報靠近／`RSPD`／`RSNR`。協定沒有檢查碼、實測有 1 → 0 的位元錯誤（LD2451 TX 高電位偏弱，接收腳一定要開內建上拉），解析器靠格式檢查擋（`src/drivers/LD2451Protocol`）；沒有目標時雷達約每 1.4 秒送一個空資料框
  - 後方警示判斷 `src/core/RearThreat`（注意 = RANGE 內、危險 = 5 m 內或 TTC 內、保持 1.5 s）。方向位元組（1 = 靠近）與角度正負還沒在實車驗證（`docs/REAR_RADAR.md` §10）。兩顆同型號雷達可能互相干擾，未驗證
  - 找 LD2451 腳位與鮑率：燒錄 `firmware/diagnostics/LD2451Probe`（不掃 GPIO16／17；用完燒回正式韌體）
  - 執行期參數（NVS 命名空間 `speedRadar`）：`ANGLE`（10～75，預設 30）、`HEIGHT`、`DIR`、`MODEL`、`CAL`、`GSNR`（3～8）、`WHEEL`；版本 `ver=2`。從 3.x（`ver=1`）升級時沿用 ANGLE／HEIGHT／DIR／WHEEL，CAL 回到 1，C4001 的 `rthr`、`vmax` 在下次存檔時刪除。改 ANGLE／HEIGHT 不必重寫雷達。後方來車：`RANGE`、`RSPD`、`TTC`、`RSNR`（另外記版本 `rver`，壞掉只重設後方設定，不會清掉 CAL）
  - 遙測：`R=… RO=… ST=… … N=… A=… RD=… RV=… S=… G=… FV=…`（代表目標的角度／整數距離／徑向速度正 = 遠離／訊噪比；3.x 的 `E` 能量、`ST 6`、`FV 2/6/9` 拿掉了）；後方來車另外一行 `REAR ON=… LV=… D=… X=…`（每行都要放得進一個 BLE 通知，≤ 177 bytes，單元測試會檢查）
  - 輪速霍爾感測器（GPIO27，`core/WheelSpeed`）只當參考值：校正與驗證，不參與估計
  - 騎乘紀錄分析：`firmware/diagnostics/analyze_ride.py`（Python 標準函式庫；這台電腦 2026-11 沒有 Python，`python` 只是 Microsoft Store 的別名）
- `web/`：網頁（React + TypeScript + Vite），`npm test`、`npm run lint`、`npm run build`。這台電腦 2026-11 沒有 Node.js（`C:\Program Files\nodejs` 不存在）：用 VS Code 內建的 Node，`ELECTRON_RUN_AS_NODE=1 "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" node_modules/vitest/vitest.mjs run`（tsc、eslint、vite 同理，跑 `node_modules` 裡的腳本）。網頁的主版本要和韌體相同（`FIRMWARE_MAJOR`），不同時會提示
  - 設計語言和 Lodestar（`C:\GitHub\lodestar`）統一：同樣的 token 名稱（`bg`、`surface`、`ink`、`muted`、`faint`、`line`、`tint`）、大標題頁面、卡片 20 px 圓角、膠囊按鈕、底部面板、浮動分頁列；BSIS 的重點色是藍（`#1765e5`）。仍然不用漸層、光暈、彩色圖示底；只有浮在內容上的導覽用半透明材質。元件在 `web/src/ui/kit`、基準在 `web/src/index.css`，頁面在 `ui/features`，外框在 `ui/shell`
  - 五個分頁：速度、行程、校正、數據、設定，加上騎乘模式（`#/ride`）；手機是浮動分頁列，電腦（≥ 1024 px）是左欄 + 雙欄；分頁同步到網址 `#/speed` 等
  - 後方來車：速度頁 `RearCard`、騎乘模式右側直條（`ui/widgets/RearRadar`）、校正頁 `RearPanel`、設定頁「後方來車警示」、數據頁「後方雷達」；提示規則在 `domain/rear.ts`（注意柔和兩聲、危險急促四聲每 1.5 秒重複）。資料中斷或後方雷達離線時絕不顯示「安全」
  - PWA：用瀏覽器打開就提醒安裝（規則在 `infrastructure/pwa/install.ts`）；`public/sw.js` 照建置產生的 `precache.json` 離線快取；新版本靠 `/version.json` 比對，不自動重新載入（會中斷藍牙）
  - 截圖：`npm run screenshots`（`scripts/screenshots.mjs`，DevTools Protocol 模擬手機；先 `npm run dev -- --port 5180`）
  - 示範模式 `?demo`（`infrastructure/transport/DemoTransport.ts`）：不需要硬體，也用來產生 `docs/images` 的截圖。後方來車照固定時刻表出現（約 19.5 秒注意、29.5 秒危險、75 秒沒有車），截圖才穩定
  - 截圖時 dev server 只聽 `localhost`：`BASE=http://localhost:5180 node scripts/screenshots.mjs [檔名的一部分]`
  - 超速警示（預設 25 km/h，只在網頁端）：規則在 `domain/overspeed.ts`（遲滯 1 km/h、進入 0.5 秒、解除 1 秒），依據與限制在 `docs/SPEED_ALERT.md`
- `docs/proposal/`（計畫書 PDF，含組員學號）不進 git

## 部署（Mac 上自架的 Zeabur，2026-11-06 起）
- 網址：https://bsis.mingchen.dev（只有這一個網址）；Cloudflare DNS 是 CNAME 指向 Cloudflare Tunnel（Proxied），沒有公開的源站 IP
- 跑在 Mac mini 的 Lima 虛擬機 `mac-a`（K3s ＋ Zeabur 開源版，也叫 Ming's Server，但不是 Zeabur 雲端），Zeabur 介面只能透過 Tailscale 開。舊的 Zeabur 雲端（東京）專案／服務 ID 都已失效，`npx zeabur` 指令也不再適用
- Kubernetes namespace `bsis-radar`，服務 `web`：建置 GitHub Ming874/bsis-radar 的 `production` 分支、根目錄 `web/`，用 railpack
- **部署：push 到 `main`（或合併 PR）**，CI（`.github/workflows/ci.yml`：網頁的 lint、測試、build，加上 secret scan）全部通過後，promote job 會把 `production` 快轉到該 commit，Mac 約 1 分鐘內建好 arm64 映像並換上。CI 沒過就不會上線，main 上失敗會發 Discord
- 緊急上線（跳過 CI）：`git push origin <commit>:production`。退回：Zeabur 介面 → 服務 → 重新啟動與回滾，或 `kubectl -n bsis-radar set image deploy/web web=zot.zot.svc:5000/bsis-radar/web:<舊 tag>`
- 日誌：Zeabur 介面，或 `limactl shell mac-a -- sudo k3s kubectl -n bsis-radar logs deploy/web`
