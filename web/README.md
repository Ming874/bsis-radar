# Radar A 網頁

自行車後方來車警示系統的顯示端：用 **Web Bluetooth** 連線 ESP32（C4001 毫米波雷達），即時顯示來車距離、接近速度、到達時間，並以嗶聲、震動、語音、畫面紅光警示騎士。不用安裝 App。

- 正式網址：<https://bsis.iosoftware.ai>
- 手機（< 1024 px）：底部分頁列、單欄；電腦（≥ 1024 px）：左側選單、雙欄，騎乘頁右側多一張距離趨勢圖

## 技術

React 19 · TypeScript（strict）· Vite · Tailwind CSS 4 · Zustand · Vitest · ESLint · PWA（Service Worker，離線也能開啟）

## 架構：分層，相依只往下

```text
src/
├─ domain/          領域層：純 TypeScript，不碰瀏覽器 API（全部有單元測試）
│                   協定解析與指令產生、藍牙分段重組、來車事件、單位換算
├─ infrastructure/  基礎設施層：Web Bluetooth（NUS、自動重連、寫入排隊）、Web Audio 警示、
│                   localStorage、CSV、螢幕常亮
├─ application/     應用層：Zustand 狀態、警示控制、提示訊息、錯誤訊息繁中化、
│                   container.ts（組裝根：唯一知道具體實作的地方）
└─ ui/
   ├─ kit/          設計系統：Button、Section/ListRow、Sheet、Switch/Segmented/Slider/Stepper、
   │                Banner/Badge/StatusDot、圖示——頁面只用這些元件
   ├─ shell/        外框：頂端列、左側導覽（電腦）、底部分頁列（手機）、連線面板、危險紅光
   ├─ features/     頁面：ride（騎乘）、history（紀錄）、device（裝置）、settings（設定）
   ├─ widgets/      跨頁共用的小工具（距離趨勢圖）
   ├─ content/      所有繁中說明文字（help.ts）
   └─ hooks/
```

## 設計系統

設計基準（design tokens）集中在 `src/index.css`，元件只用語意化名稱，深淺色只在這裡切換：

| 類別 | 名稱 |
| --- | --- |
| 顏色 | `canvas`（頁面）、`surface`（卡片）、`fill`、`line`、`ink` / `ink-2` / `ink-3`（文字）、`accent`（品牌橘 #F38020）、`accent-ink`（白底上的橘色文字）、`safe` / `caution` / `danger` / `neutral` |
| 警示卡 | `alert-safe` / `alert-caution` / `alert-danger` / `alert-neutral` / `alert-brand`（各有 `-deep` 漸層色） |
| 字級 | `display`、`headline`、`title`、`body`、`callout`、`caption`；大數字用 `font-rounded` |
| 圓角 | `control`（按鈕、輸入）、`card`（卡片）、`widget`（騎乘頁小工具）、`panel`（警示卡、面板） |

風格：整體參考 Cloudflare 的白底橘色；騎乘頁採 iOS 小工具風格（漸層警示卡、毛玻璃數值、圓體數字、柔和陰影）。

## 指令

```bash
npm install
npm run dev       # 開發伺服器（localhost 可以使用 Web Bluetooth）
npm test          # 單元測試（Vitest）
npm run lint      # ESLint
npm run build     # 型別檢查 + 產生 dist/
npm run preview   # 預覽 build 結果
```

版本號只在 `package.json` 維護，建置時注入成 `__APP_VERSION__`。

## 瀏覽器支援

| 瀏覽器 | 支援 |
| --- | --- |
| Android Chrome | ✅ |
| 電腦 Chrome／Edge（Windows、macOS，需有藍牙） | ✅ |
| iPhone Safari | ❌ 改用 Bluefy 瀏覽器 |
| Brave | 預設關閉，需在 `brave://flags` 開啟 Web Bluetooth |
| Firefox | ❌ |

網頁必須用 HTTPS（或 localhost）開啟，瀏覽器才允許使用藍牙。

## 資料格式

見 [docs/PROTOCOL.md](../docs/PROTOCOL.md)。

## 部署

部署在 Zeabur，連結 GitHub repo 的 `main` 分支、根目錄 `web/`：**push 到 `main` 就會自動建置並上線**。
