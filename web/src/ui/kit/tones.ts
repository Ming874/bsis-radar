/**
 * 【設計系統】狀態色調對應的樣式，與小工具函式（元件以外的匯出放在這裡，熱更新才正常）。
 */
import type { Tone } from '../../application/selectors';

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  idle: 'text-subtle',
  busy: 'text-accent',
};

export const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  idle: 'bg-subtle',
  busy: 'bg-accent',
};

/** 數值是有限數而且在範圍內 */
export function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}
