# BSIS 專題：Radar A 後方來車偵測

- GitHub：https://github.com/Ming874/bsis-radar（公開；`main` 分支）
- `firmware/`：ESP32 韌體（Arduino）
  - 開發：`firmware/arduino.ps1`（compile / upload / monitor / test / release）
  - 一鍵燒錄（不需 Arduino IDE）：雙擊 `firmware/flash.bat`，燒錄 `firmware/release/` 的預編譯檔；改了程式先跑 `.\arduino.ps1 release`
  - 燒錄時 USB 要插在 ESP32 板子本身的 USB-C 孔（擴充底板的孔只供電）；USB 晶片是 CH340，這台電腦上 COM 埠號會變（出現過 COM7、COM3），用 `.\arduino.ps1 ports` 確認
  - 來車演算法（卡爾曼 + 都卜勒 × 距離變化率交叉核對）說明在 `docs/ALGORITHM.md`；改了 `src/core` 先跑 `.\arduino.ps1 test`（203 項），新增 .cpp 要同時加進 `arduino.ps1` 的 test 清單與 `tests/run_tests.sh`
  - C4001 實測行為（10 Hz、一次一個目標、靜止物體大多不回報但正對的牆會、外插資料框、`setThrFactor` 原廠預設 5、能量約隨距離 5 次方下降）在 `docs/ALGORITHM.md` §10；雷達門檻是執行期參數 `RTHR`
  - 這台電腦沒有裝 g++ 與 Node.js：跑測試時用免安裝版（WinLibs MinGW-w64、Node.js zip）並只在該指令的 PATH 加入；Windows 會擋暫存資料夾裡新編出來的 exe，測試執行檔要放在 `firmware/tests/`（已被 .gitignore 排除）
- `web/`：網頁（React + TypeScript + Vite），`npm test`、`npm run lint`、`npm run build`
  - UI 用統一設計系統 `web/src/ui/kit`（設計基準在 `web/src/index.css`），頁面在 `ui/features`，外框在 `ui/shell`
  - 手機版：底部分頁列；電腦版（≥ 1024 px）：左側導覽 `ui/shell/SideNav.tsx` + 雙欄
- `docs/proposal/`（計畫書 PDF，含組員學號）不進 git

## Zeabur Deployment
- 網址：https://bsis.mingchen.dev（只有這一個網址）
- Project ID: 6ac0ef3493154e21e628668f（bsis-radar，Ming's Server）
- Service ID: 6ac1119593154e21e62873bc（web；GitHub Ming874/bsis-radar 的 `main`，Root Directory `/web`）
- **push 到 `main` 就會自動建置部署**，不要再用 `npx zeabur deploy` 上傳（會蓋掉 Git 設定）
