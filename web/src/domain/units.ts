/**
 * 【領域層】單位換算與數字格式。
 */
export type SpeedUnit = 'kmh' | 'mps';

export const mpsToKmh = (mps: number): number => mps * 3.6;

const DASH = '—';

export function formatDistance(m: number | null, digits = 1): string {
  return m === null ? DASH : m.toFixed(digits);
}

export function formatSpeed(mps: number | null, unit: SpeedUnit): string {
  if (mps === null) return DASH;
  return unit === 'kmh' ? mpsToKmh(mps).toFixed(0) : mps.toFixed(1);
}

export const speedUnitLabel = (unit: SpeedUnit): string => (unit === 'kmh' ? 'km/h' : 'm/s');

export function formatSeconds(s: number | null, digits = 1): string {
  return s === null ? DASH : s.toFixed(digits);
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

/** 時間戳 → 檔名用的「20261003_140327」 */
export function fileStamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
