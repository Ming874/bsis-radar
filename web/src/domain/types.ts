/**
 * 【領域層】資料型別。純 TypeScript，不依賴 React 或瀏覽器 API。
 */

/** 0 安全 / 1 注意（確認來車在警示距離內）/ 2 危險（即將到達） */
export type AlertLevel = 0 | 1 | 2;

/** ESP32 每 200 ms 送來的一筆遙測（欄位對應韌體 Telemetry.h） */
export interface Telemetry {
  radarOnline: boolean; // R
  warning: boolean; // W
  level: AlertLevel; // L
  distanceM: number | null; // D：追蹤距離，沒目標為 null
  closingMps: number | null; // V：接近速度，正值 = 越來越近
  ttcS: number | null; // TTC：到達時間
  rawTargets: number; // N：雷達原始目標數
  rawRangeM: number | null; // RD：雷達原始距離
  rawSpeedMps: number | null; // RV：雷達原始速度（雷達自己的正負號）
  energy: number; // E：反射能量（最近 5 筆中位數）
  uptimeS: number; // T：ESP32 開機秒數
  ownSpeedKmh: number | null; // S：自身車速（隊友的 Radar B，選用）
  receivedAt: number; // 收到的時間（ms），由網頁填入
}

/** 裝置上可調整的偵測參數（對應韌體 CFG 回覆） */
export interface DeviceConfig {
  testMode: boolean; // TEST
  minSpeedMps: number; // MINSPD
  minEnergy: number; // MINE
  warnRangeM: number; // RANGE
  approachSign: -1 | 0 | 1; // SIGN
  dangerTtcS: number; // DTTC
  dangerDistM: number; // DDIST
  holdMs: number; // HOLD
  confirmHits: number; // CONFIRM
  firmware: string; // FW
}

export type ParsedLine =
  | { kind: 'telemetry'; telemetry: Omit<Telemetry, 'receivedAt'> }
  | { kind: 'config'; config: DeviceConfig }
  | { kind: 'ack'; ok: boolean; message: string }
  | { kind: 'unknown'; text: string };

/** 網頁送給 ESP32 的指令 */
export type DeviceCommand =
  | { type: 'get' }
  | { type: 'defaults' }
  | { type: 'reboot' }
  | { type: 'testMode'; enabled: boolean }
  | { type: 'minSpeed'; mps: number }
  | { type: 'minEnergy'; value: number }
  | { type: 'warnRange'; meters: number }
  | { type: 'approachSign'; sign: -1 | 0 | 1 }
  | { type: 'dangerTtc'; seconds: number }
  | { type: 'dangerDist'; meters: number }
  | { type: 'hold'; ms: number }
  | { type: 'confirm'; hits: number };

/** 一次「來車事件」：從開始警示到解除 */
export interface ApproachEvent {
  id: string;
  startedAt: number;
  endedAt: number;
  durationS: number;
  minDistanceM: number | null;
  maxClosingMps: number | null;
  minTtcS: number | null;
  maxLevel: AlertLevel;
}

/** 歷史圖表的一個點 */
export interface HistoryPoint {
  t: number;
  distanceM: number | null;
  level: AlertLevel;
  energy: number;
}
