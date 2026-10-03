# BSIS 專題：Radar A 後方來車偵測

- `firmware/`：ESP32 韌體（Arduino）
  - 開發：`firmware/arduino.ps1`（compile / upload / monitor / test / release）
  - 一鍵燒錄（不需 Arduino IDE）：雙擊 `firmware/flash.bat`，燒錄 `firmware/release/` 的預編譯檔；改了程式先跑 `.\arduino.ps1 release`
  - 燒錄時 USB 要插在 ESP32 板子本身的 USB-C 孔（擴充底板的孔只供電）；USB 晶片是 CH340，這台電腦上是 COM7
- `web/`：手機網頁（React + TypeScript + Vite），`npm test`、`npm run lint`、`npm run build`
  - UI 用統一設計系統 `web/src/ui/kit`（設計基準在 `web/src/index.css`），頁面在 `ui/features`，外框在 `ui/shell`

## Zeabur Deployment
- 網址：https://bsis.iosoftware.ai（另有 https://bsis-radar.zeabur.app）
- Project ID: 6ac0ef3493154e21e628668f（bsis-radar，Ming's Server）
- Service ID: 6ac0faab93154e21e6286b07（radar-a-web）
- 重新部署（在 web/ 資料夾）：`npx zeabur@latest deploy --project-id 6ac0ef3493154e21e628668f --service-id 6ac0faab93154e21e6286b07 --json`
