# BSIS 專題：對地測速雷達（C4001 斜照路面量自行車速度）

- GitHub：https://github.com/Ming874/bsis-radar（公開；`main` 分支）
- 3.0 起 C4001 改為朝後下方照路面、量對地速度；後方來車改由另一套倒車雷達負責（不在本 repo）。2.x 後方來車版在 commit `8a5c3b6`
- `firmware/`：ESP32 韌體（Arduino，sketch 在 `firmware/SpeedRadar`）
  - 開發：`firmware/arduino.ps1`（compile / upload / monitor / test / release）。arduino-cli 的搜尋順序：`$env:ARDUINO_CLI` → Arduino IDE 內建 → PATH。這台電腦的 Arduino IDE 已移除（ESP32 套件 3.3.12 還在 `%LOCALAPPDATA%\Arduino15`），要用官方免安裝版 arduino-cli 並設定 `ARDUINO_CLI`
  - 一鍵燒錄（不需 Arduino IDE）：雙擊 `firmware/flash.bat`，燒錄 `firmware/release/` 的預編譯檔；改了程式先跑 `.\arduino.ps1 release`
  - 燒錄時 USB 要插在 ESP32 板子本身的 USB-C 孔（擴充底板的孔只供電）；USB 晶片是 CH340，COM 埠號會變（出現過 COM7、COM3），用 `.\arduino.ps1 ports` 或裝置管理員確認
  - 估計器 `src/core/GroundSpeedEstimator`（原理、文獻、參數依據在 `docs/ALGORITHM.md`）；改了 `src/core` 先跑 `.\arduino.ps1 test`（318 項，最後印出模擬報表）；新增 .cpp 要同時加進 `arduino.ps1` 的 `$TestSources` 與 `tests/run_tests.sh`
  - C4001 的測速上限不確定（規格書 3 m/s、資料框說明 10 m/s，觀察值約 3.28）：`VMAX` 預設 3.28、韌體依預測還原折疊、量到 |vr| > VMAX + 0.3 時自動調為 10 並存檔（ALGORITHM.md §2）
  - 執行期參數（NVS 命名空間 `speedRadar`）：`ANGLE`、`HEIGHT`、`DIR`、`MODEL`、`CAL`、`RTHR`、`WHEEL`、`VMAX`；改 ANGLE／HEIGHT／RTHR 會把新的地面距離窗口寫進雷達（約 4 秒沒有資料）
  - 輪速霍爾感測器（GPIO27，`core/WheelSpeed`）只當參考值：校正與驗證，不參與估計
  - 電腦端測試用 `C:\MinGW\bin\g++`（GCC 6.3，C++14）；Windows 會擋暫存資料夾裡新編出來的 exe，測試執行檔要放在 `firmware/tests/`（已被 .gitignore 排除）
  - 騎乘紀錄分析：`firmware/diagnostics/analyze_ride.py`（Python 標準函式庫；這台電腦有 Python 3.13）
- `web/`：網頁（React + TypeScript + Vite），`npm test`、`npm run lint`、`npm run build`；Node.js 在 `C:\Program Files\nodejs`（指令前要把它加進 PATH）
  - UI 用統一設計系統 `web/src/ui/kit`（設計基準在 `web/src/index.css`：中性灰階、單一重點色、1 px 邊框、小圓角，不用漸層與陰影），頁面在 `ui/features`，外框在 `ui/shell`
  - 手機版：底部分頁列；電腦版（≥ 1024 px）：左側選單 + 雙欄；分頁同步到網址 `#/speed` 等
  - 示範模式 `?demo`（`infrastructure/transport/DemoTransport.ts`）：不需要硬體，也用來產生 `docs/images` 的截圖
- `docs/proposal/`（計畫書 PDF，含組員學號）不進 git

## Zeabur Deployment
- 網址：https://bsis.mingchen.dev（只有這一個網址）
- Project ID: 6ac0ef3493154e21e628668f（bsis-radar，Ming's Server）
- Service ID: 6ac1119593154e21e62873bc（web；GitHub Ming874/bsis-radar 的 `main`，Root Directory `/web`）
- **push 到 `main` 就會自動建置部署**，不要再用 `npx zeabur deploy` 上傳（會蓋掉 Git 設定）
