# BSIS 專題：Radar A 後方來車偵測

- GitHub：https://github.com/Ming874/bsis-radar（公開；`main` 分支）
- `firmware/`：ESP32 韌體（Arduino）
  - 開發：`firmware/arduino.ps1`（compile / upload / monitor / test / release）
  - 一鍵燒錄（不需 Arduino IDE）：雙擊 `firmware/flash.bat`，燒錄 `firmware/release/` 的預編譯檔；改了程式先跑 `.\arduino.ps1 release`
  - 燒錄時 USB 要插在 ESP32 板子本身的 USB-C 孔（擴充底板的孔只供電）；USB 晶片是 CH340，這台電腦上是 COM7
  - 來車演算法（卡爾曼 + 都卜勒 × 距離變化率交叉核對）說明在 `docs/ALGORITHM.md`；改了 `src/core` 先跑 `.rduino.ps1 test`（173 項），新增 .cpp 要同時加進 `arduino.ps1` 的 test 清單與 `tests/run_tests.sh`
- `web/`：網頁（React + TypeScript + Vite），`npm test`、`npm run lint`、`npm run build`
  - UI 用統一設計系統 `web/src/ui/kit`（設計基準在 `web/src/index.css`），頁面在 `ui/features`，外框在 `ui/shell`
  - 手機版：底部分頁列；電腦版（≥ 1024 px）：左側導覽 `ui/shell/SideNav.tsx` + 雙欄
- `docs/proposal/`（計畫書 PDF，含組員學號）不進 git

## Zeabur Deployment
- 網址：https://bsis.iosoftware.ai（只有這一個網址）
- Project ID: 6ac0ef3493154e21e628668f（bsis-radar，Ming's Server）
- Service ID: 6ac1119593154e21e62873bc（web；GitHub Ming874/bsis-radar 的 `main`，Root Directory `/web`）
- **push 到 `main` 就會自動建置部署**，不要再用 `npx zeabur deploy` 上傳（會蓋掉 Git 設定）
