/**
 * 【領域層】資料型別。純 TypeScript，不依賴 React 或瀏覽器 API。
 * 欄位與韌體 3.1 的 src/comm/Telemetry.h 對應，定義見 docs/PROTOCOL.md。
 */

/** 估計器狀態（韌體 ST 欄位） */
export type SpeedState = 'noRadar' | 'stopped' | 'acquiring' | 'tracking' | 'holding' | 'lost' | 'overRange';

/** 每一筆雷達資料框的判斷結果（韌體 FV 欄位） */
export type FrameVerdict =
  | 'accepted'
  | 'noTarget'
  | 'repeated'
  | 'outOfGate'
  | 'wrongDirection'
  | 'static'
  | 'atLimit'
  | 'outlier'
  | 'acquiring'
  | 'unfolded';

/** 由單筆量測換算對地速度的方式（韌體 MODEL） */
export type SpeedModel = 'fixedAngle' | 'rangeGeometry';

/** ESP32 送來的一行遙測：每一筆雷達資料框一行（約 10 Hz），沒有資料時每 250 ms 一行心跳 */
export interface Telemetry {
  radarOnline: boolean; // R
  state: SpeedState; // ST
  speedMps: number | null; // V：對地速度，未知時 null
  sigmaMps: number; // SD：1σ 不確定度
  qualityPct: number; // Q：最近 20 筆可用量測的比例
  wrongDirPct: number; // WD：最近 20 筆方向相反的比例（DIR 可能設反）
  frame: number; // FN：資料框序號，心跳時不變
  targets: number; // N
  rangeM: number | null; // RD：原始距離
  radialMps: number | null; // RV：原始徑向速度（雷達自己的正負號）
  energy: number; // E
  groundMps: number | null; // G：這一筆換算的對地速度（濾波前）
  verdict: FrameVerdict; // FV
  radarDistanceM: number; // DR：雷達里程（開機起）
  wheelMps: number | null; // W：輪速感測器（參考值），沒接時 null
  wheelDistanceM: number | null; // DW
  uptimeS: number; // T
  receivedAt: number; // 收到的時間（ms），由網頁填入
}

/** 後方來車警示等級（韌體 REAR 行的 LV） */
export type RearLevel = 'safe' | 'caution' | 'danger';

/** 後方雷達（HLK-LD2451）一個資料框裡的目標 */
export interface RearTarget {
  angleDeg: number; // 0 = 正後方（左右哪邊是正值要看安裝，網頁可對調）
  distanceM: number;
  speedKmh: number; // 正 = 靠近、負 = 遠離（相對腳踏車的徑向速度）
}

/** ESP32 送來的一行後方來車狀態（REAR 行）：有目標或警示中每 0.1 秒、平常每 0.5 秒、離線每 1 秒 */
export interface RearTelemetry {
  online: boolean; // ON
  receiveOnly: boolean; // RO：指令沒有回覆（只接了 LD2451 TX），偵測設定沒寫進雷達
  level: RearLevel; // LV
  distanceM: number | null; // D：主要來車的距離（濾波後）
  closingMps: number | null; // V：接近速度
  ttcS: number | null; // TTC：到達時間
  holding: boolean; // HOLD：警示保持中（來車已不在視野：正在旁邊超車或停下來）
  targets: RearTarget[]; // X
  alerts: number; // CNT：ESP32 開機後的警示次數
  frame: number; // FN：後方雷達資料框序號
  receivedAt: number; // 收到的時間（ms），由網頁填入
}

/** 後方來車參數（CFG 的 RANGE、RSPD、TTC、RSNR、RDET） */
export interface RearConfig {
  rangeM: number; // RANGE：警示距離
  minSpeedKmh: number; // RSPD：最低接近速度
  ttcS: number; // TTC：危險的到達時間
  snr: number; // RSNR：LD2451 訊噪比門檻
  detectRangeM: number; // RDET：寫進 LD2451 的偵測距離（唯讀，RANGE + 10）
}

export type EditableRearConfig = Omit<RearConfig, 'detectRangeM'>;

/** 裝置參數（韌體 CFG 回覆） */
export interface DeviceConfig {
  angleDeg: number; // ANGLE：視軸俯角
  heightM: number; // HEIGHT：雷達離地高度
  direction: 1 | -1; // DIR：1 朝後、-1 朝前
  model: SpeedModel; // MODEL
  calibration: number; // CAL
  radarThreshold: number; // RTHR
  wheelMm: number; // WHEEL
  radialLimitMps: number; // VMAX：C4001 徑向測速上限
  gateMinM: number; // RMIN：地面距離窗口（唯讀）
  gateMaxM: number; // RMAX
  /** 後方來車參數；韌體 3.0 沒有後方雷達功能時 null */
  rear: RearConfig | null;
  firmware: string; // FW
}

/** 可以修改的對地測速參數（不含唯讀的窗口與版本；後方來車參數另外處理） */
export type EditableConfig = Omit<DeviceConfig, 'gateMinM' | 'gateMaxM' | 'firmware' | 'rear'>;

export type ParsedLine =
  | { kind: 'telemetry'; telemetry: Omit<Telemetry, 'receivedAt'> }
  | { kind: 'config'; config: DeviceConfig }
  | { kind: 'rear'; rear: Omit<RearTelemetry, 'receivedAt'> }
  | { kind: 'legacyConfig'; firmware: string } // 3.0 以前（後方來車偵測版）的韌體
  | { kind: 'ack'; ok: boolean; message: string }
  | { kind: 'unknown'; text: string };

/** 網頁送給 ESP32 的指令 */
export type DeviceCommand =
  | { type: 'get' }
  | { type: 'defaults' }
  | { type: 'reboot' }
  | { type: 'angle'; deg: number }
  | { type: 'height'; m: number }
  | { type: 'direction'; dir: 1 | -1 }
  | { type: 'model'; model: SpeedModel }
  | { type: 'calibration'; factor: number }
  | { type: 'radarThreshold'; value: number }
  | { type: 'wheel'; mm: number }
  | { type: 'radialLimit'; mps: number }
  | { type: 'rearRange'; m: number }
  | { type: 'rearMinSpeed'; kmh: number }
  | { type: 'rearTtc'; s: number }
  | { type: 'rearSnr'; value: number };

/** 速度圖的一個點 */
export interface SpeedPoint {
  t: number;
  speedMps: number | null;
  wheelMps: number | null;
  state: SpeedState;
}

/** 散佈圖與診斷用的一筆資料框 */
export interface FrameSample {
  t: number;
  frame: number;
  rangeM: number | null;
  radialMps: number | null;
  groundMps: number | null;
  verdict: FrameVerdict;
}
