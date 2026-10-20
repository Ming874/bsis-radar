/**
 * 【應用層】把狀態整理成畫面要的文字與色調（純函式，可單元測試）。
 */
import { FIRMWARE_MAJOR, firmwareMajor } from '../domain/protocol';
import type { FrameVerdict, SpeedPoint, SpeedState } from '../domain/types';
import type { RadarState } from './radarStore';

/** 畫面上的狀態色調：ok 正常、warn 需要注意、bad 異常、idle 沒有資料、busy 處理中 */
export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'busy';

export interface StatusView {
  tone: Tone;
  label: string;
  detail?: string;
}

/** 連線（頂端列） */
export function selectLink(s: Pick<RadarState, 'connection' | 'stale' | 'telemetry' | 'legacyFirmware'>): StatusView {
  const { status, attempt, error } = s.connection;
  switch (status) {
    case 'idle':
      return { tone: 'idle', label: '未連線' };
    case 'disconnected':
      return { tone: 'bad', label: '已中斷', detail: error };
    case 'connecting':
      return { tone: 'busy', label: '連線中' };
    case 'reconnecting':
      return { tone: 'busy', label: '重新連線', detail: `第 ${attempt ?? 1} 次` };
    case 'connected':
      break;
  }
  if (s.legacyFirmware) return { tone: 'bad', label: '韌體過舊', detail: `v${s.legacyFirmware}` };
  if (s.stale) return { tone: 'bad', label: '資料中斷', detail: '超過 1.5 秒沒有資料' };
  if (!s.telemetry) return { tone: 'busy', label: '等待資料' };
  if (!s.telemetry.radarOnline) return { tone: 'bad', label: '雷達離線', detail: 'ESP32 正在重新設定雷達' };
  return { tone: 'ok', label: '已連線' };
}

const STATE_VIEW: Record<SpeedState, StatusView> = {
  noRadar: { tone: 'bad', label: '雷達離線' },
  stopped: { tone: 'idle', label: '靜止' },
  acquiring: { tone: 'busy', label: '擷取地面回波' },
  tracking: { tone: 'ok', label: '追蹤中' },
  holding: { tone: 'warn', label: '暫時失去回波', detail: '暫時沿用估計值' },
  lost: { tone: 'bad', label: '訊號中斷', detail: '雷達量不到路面' },
  overRange: { tone: 'bad', label: '超出測速上限', detail: '速度高於雷達可量範圍' },
};

/** 估計器狀態（速度旁的狀態列） */
export function describeState(state: SpeedState): StatusView {
  return STATE_VIEW[state];
}

export const VERDICT_LABEL: Record<FrameVerdict, string> = {
  accepted: '採用',
  noTarget: '沒有目標',
  repeated: '外插（重複）',
  outOfGate: '距離窗口外',
  wrongDirection: '方向相反',
  static: '靜止回波',
  atLimit: '接近測速上限',
  outlier: '離群值',
  acquiring: '擷取中',
  unfolded: '採用（折疊還原）',
};

/** 韌體版本與網頁不相容（主版本不同） */
export function firmwareMismatch(version: string | undefined): boolean {
  if (!version) return false;
  const major = firmwareMajor(version);
  return major !== null && major !== FIRMWARE_MAJOR;
}

/**
 * 最近約 1 秒的加速度（m/s²），用來判斷「穩定騎乘」：輪速感測器平均兩圈、本身就落後，
 * 加減速時拿瞬間的雷達與輪速相比沒有意義。資料不足時回傳 null。
 */
export function recentAccel(history: SpeedPoint[], windowMs = 1000): number | null {
  const last = history[history.length - 1];
  if (!last || last.speedMps === null) return null;
  let first: SpeedPoint | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    if (!p || p.t < last.t - windowMs) break;
    if (p.speedMps !== null) first = p;
  }
  if (!first || first.speedMps === null || last.t - first.t < windowMs * 0.6) return null;
  return ((last.speedMps - first.speedMps) * 1000) / (last.t - first.t);
}

/** 穩定騎乘的加速度上限（m/s²） */
export const STEADY_ACCEL = 0.4;

/** 方向可能設反：在動（有回波）但大部分資料框「方向相反」 */
export const WRONG_DIRECTION_HINT_PCT = 60;

/** 判斷碼統計（資料頁）：最近 N 筆各種判斷的比例，依數量排序 */
export function verdictBreakdown(verdicts: FrameVerdict[]): Array<{ verdict: FrameVerdict; count: number; pct: number }> {
  const counts = new Map<FrameVerdict, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = verdicts.length;
  return [...counts.entries()]
    .map(([verdict, count]) => ({ verdict, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}
