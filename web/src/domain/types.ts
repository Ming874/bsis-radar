/**
 * 【領域層】資料型別。純 TypeScript，不依賴 React 或瀏覽器 API。
 * 欄位與韌體 3.0 的 src/comm/Telemetry.h 對應，定義見 docs/PROTOCOL.md。
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
  firmware: string; // FW
}

/** 可以修改的參數（不含唯讀的窗口與版本） */
export type EditableConfig = Omit<DeviceConfig, 'gateMinM' | 'gateMaxM' | 'firmware'>;

export type ParsedLine =
  | { kind: 'telemetry'; telemetry: Omit<Telemetry, 'receivedAt'> }
  | { kind: 'config'; config: DeviceConfig }
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
  | { type: 'radialLimit'; mps: number };

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
