import { describe, expect, it } from 'vitest';
import { fileStamp, formatClock, formatDistance, formatDuration, formatPercent, formatSpeed, mpsToKmh, toUnit } from './units';

describe('units', () => {
  it('速度：km/h 一位小數、m/s 兩位小數', () => {
    expect(mpsToKmh(7)).toBeCloseTo(25.2);
    expect(formatSpeed(7, 'kmh')).toBe('25.2');
    expect(formatSpeed(7, 'mps')).toBe('7.00');
    expect(formatSpeed(7, 'kmh', 0)).toBe('25');
    expect(formatSpeed(null, 'kmh')).toBe('—');
    expect(formatSpeed(Number.NaN, 'kmh')).toBe('—');
    expect(toUnit(5, 'kmh')).toBeCloseTo(18);
    expect(toUnit(5, 'mps')).toBe(5);
  });

  it('距離：1 km 以下用 m，以上用 km', () => {
    expect(formatDistance(8.42)).toEqual({ value: '8.4', unit: 'm' });
    expect(formatDistance(523.6)).toEqual({ value: '524', unit: 'm' });
    expect(formatDistance(12345)).toEqual({ value: '12.35', unit: 'km' });
    expect(formatDistance(null).value).toBe('—');
  });

  it('百分比帶正負號', () => {
    expect(formatPercent(1.234)).toBe('+1.2%');
    expect(formatPercent(-0.56, 2)).toBe('−0.56%');
    expect(formatPercent(null)).toBe('—');
  });

  it('時間格式', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    const t = new Date(2026, 9, 21, 14, 3, 7).getTime();
    expect(formatClock(t)).toBe('14:03:07');
    expect(fileStamp(t)).toBe('20261021_140307');
  });
});
