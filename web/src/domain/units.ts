/**
 * 【領域層】單位換算與數字格式。
 */
export type SpeedUnit = 'kmh' | 'mps';

export const DASH = '—';

export const mpsToKmh = (mps: number): number => mps * 3.6;
export const kmhToMps = (kmh: number): number => kmh / 3.6;

export const speedUnitLabel = (unit: SpeedUnit): string => (unit === 'kmh' ? 'km/h' : 'm/s');

/** 速度顯示：km/h 一位小數、m/s 兩位小數 */
export function formatSpeed(mps: number | null, unit: SpeedUnit, digits?: number): string {
  if (mps === null || !Number.isFinite(mps)) return DASH;
  return unit === 'kmh' ? mpsToKmh(mps).toFixed(digits ?? 1) : mps.toFixed(digits ?? 2);
}

/** 速限（設定以 km/h 為單位）：km/h 顯示整數或一位小數、m/s 兩位小數 */
export function formatLimit(kmh: number, unit: SpeedUnit): string {
  return unit === 'kmh' ? String(Number(kmh.toFixed(1))) : kmhToMps(kmh).toFixed(2);
}

/** 換算成目前單位的數值（圖表用） */
export function toUnit(mps: number, unit: SpeedUnit): number {
  return unit === 'kmh' ? mpsToKmh(mps) : mps;
}

/** 距離：1 km 以下用 m，以上用 km（兩位小數） */
export function formatDistance(m: number | null): { value: string; unit: string } {
  if (m === null || !Number.isFinite(m)) return { value: DASH, unit: 'm' };
  if (Math.abs(m) < 1000) return { value: m.toFixed(m < 100 ? 1 : 0), unit: 'm' };
  return { value: (m / 1000).toFixed(2), unit: 'km' };
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%`;
}

/** 秒數 → 「1:05:09」或「5:09」 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 時間戳 → 「14:03:27」 */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 時間戳 → 「10/21 14:03」 */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 時間戳 → 檔名用的「20261021_140327」 */
export function fileStamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 時間戳 → 「14:03」 */
export function formatHm(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAY = '日一二三四五六';
const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** 行程列表的日期標題：「今天」「昨天」「10/22（四）」，不是今年的加上年份 */
export function formatDayLabel(epochMs: number, now: number): string {
  const days = Math.round((dayStart(now) - dayStart(epochMs)) / 86_400_000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  const d = new Date(epochMs);
  const md = `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY[d.getDay()]}）`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/** 秒數 → 「1 小時 5 分」「12 分」「45 秒」（行程的總時間） */
export function formatDurationWords(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} 秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}
