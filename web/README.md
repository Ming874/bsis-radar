# 網頁：BSIS 測速

對地測速雷達的顯示與設定端。以 **Web Bluetooth** 連線 ESP32，即時顯示對地速度、行程、校正與診斷資料，不需要安裝 App。

- 正式網址：<https://bsis.mingchen.dev>
- 示範模式（不需要硬體，模擬一段城市騎乘）：<https://bsis.mingchen.dev/?demo>

## 頁面

| 分頁 | 內容 |
| --- | --- |
| 速度 | 對地速度（大字）、量測狀態與訊號品質、超速警示（數字與外框變紅）、不確定度、輪速參考值與差異、本次行程（里程、移動時間、平均、最高、超速次數與時間）、最近 2 分鐘的速度趨勢（含速限線） |
| 校正 | 安裝幾何（俯角、高度、朝向、速度模型，附即時示意圖）、校正係數（已知距離／輪速感測器，多趟依距離加權合併）、精度驗證（雷達 vs 輪速） |
| 數據 | 即時資料框、距離 × 徑向速度散佈圖（含平坦路面理論曲線與地面窗口）、判斷統計、CSV 記錄、行程紀錄、指令主控台 |
| 設定 | 顯示（單位、外觀、螢幕常亮、自動重連）、超速警示（速限、提示音、震動、測試）、裝置參數（雷達門檻、測速上限、輪周長）、維護、關於 |

超速警示的規則、依據與限制見 [docs/SPEED_ALERT.md](../docs/SPEED_ALERT.md)。

- 手機（< 1024 px）：底部分頁列、單欄。
- 電腦（≥ 1024 px）：左側選單、雙欄。
- 分頁同步到網址（`#/speed`、`#/calibrate`…）。

## 技術

React 19、TypeScript（strict）、Vite、Tailwind CSS 4、Zustand、Vitest、ESLint；PWA（Service Worker，離線也能開啟）。

## 架構：分層，相依只往下

```text
src/
├─ domain/          領域層：純 TypeScript，不碰瀏覽器 API，全部有單元測試
│                   協定解析與指令（protocol）、行程統計（trip）、校正與比對（calibration）、超速判斷（overspeed）、
│                   藍牙分段重組（lineAssembler）、單位與格式（units）
├─ infrastructure/  基礎設施層：Web Bluetooth（NUS、自動重連、寫入排隊）、示範模式（DemoTransport）、
│                   localStorage、CSV、螢幕常亮、提示音與震動（alertOutput）
├─ application/     應用層：Zustand 狀態（radar、trip、calibration、settings、overspeed、toast）、
│                   錯誤訊息繁中化、container.ts（組裝根：唯一知道具體實作的地方）
└─ ui/
   ├─ kit/          設計系統：Button、Panel、Field／NumberInput／Segmented／Switch／Select、
   │                Stat／KeyValue／Notice／StatusDot、Dialog、Toaster、圖示——頁面只用這些元件
   ├─ shell/        外框：頂端列（連線狀態）、左側選單、底部分頁列、分頁與網址同步
   ├─ features/     頁面：speed、calibrate、data、settings、common（裝置提示、連線引導）
   ├─ widgets/      SpeedChart、ScatterPlot、MountDiagram（SVG，不依賴圖表函式庫）
   └─ hooks/
```

## 設計系統

設計基準（design tokens）集中在 `src/index.css`，元件只用語意化名稱；深淺色只在這裡切換。

| 類別 | 名稱 |
| --- | --- |
| 底色 | `canvas`（頁面）、`panel`（面板）、`sunken`（輸入框、表頭）、`hover` |
| 線 | `line`、`line-strong` |
| 文字 | `fg`、`muted`、`subtle` |
| 重點色 | `accent`（連結、焦點、雷達資料線）、`accent-strong`（主要按鈕） |
| 狀態 | `ok`、`warn`、`bad`；`ref`（參考值資料線） |
| 字級 | `label`、`body`、`value`、`heading`、`stat`；主速度用 `clamp(5.5rem, 26vw, 10rem)` |
| 圓角 | `sm` 4 px、`md` 6 px、`lg` 8 px |

設計原則：
- **儀表風格**：中性灰階為主，只有一個重點色。綠、黃、紅只表示狀態。
- 1 px 邊框、小圓角，不用陰影、漸層、毛玻璃。
- 數字一律用等寬數字（`tabular-nums`），表格數值用等寬字型。
- 每個面板只放一個主要動作。說明文字短，放在欄位下方，不用彈出視窗。
- 深色為預設，可切換淺色或跟隨系統。

## 指令

```bash
npm install
npm run dev       # 開發伺服器（localhost 可使用 Web Bluetooth；加 ?demo 看示範資料）
npm test          # 單元測試（Vitest）
npm run lint      # ESLint
npm run build     # 型別檢查 + 產生 dist/
npm run preview   # 預覽 build 結果
```

版本號只在 `package.json` 維護，建置時注入成 `__APP_VERSION__`。

## 瀏覽器支援

| 瀏覽器 | 支援 |
| --- | --- |
| Android Chrome | 支援 |
| 電腦 Chrome／Edge（Windows、macOS，需有藍牙） | 支援 |
| iPhone Safari | 不支援，改用 Bluefy 瀏覽器 |
| Brave | 預設關閉，需在 `brave://flags` 開啟 Web Bluetooth |
| Firefox | 不支援 |

網頁必須以 HTTPS（或 localhost）開啟，瀏覽器才允許使用藍牙。

## 資料格式

見 [docs/PROTOCOL.md](../docs/PROTOCOL.md)。網頁對應韌體主版本 3；連上 2.x（後方來車偵測版）時會提示更新韌體。

## 部署

部署在 Zeabur，連結 GitHub repo 的 `main` 分支、根目錄 `web/`：**push 到 `main` 就會自動建置並上線**。Service Worker 的快取名稱（`public/sw.js` 的 `CACHE`）在不相容的大改版時要更新，舊的快取才會被清掉。
