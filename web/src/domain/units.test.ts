import { describe, expect, it } from 'vitest';
import { fileStamp, formatClock, formatDistance, formatDuration, formatSpeed, mpsToKmh } from './units';

describe('units', () => {
  it('m/s 換 km/h', () => {
    expect(mpsToKmh(7)).toBeCloseTo(25.2);
    expect(formatSpeed(7, 'kmh')).toBe('25');
    expect(formatSpeed(7, 'mps')).toBe('7.0');
    expect(formatSpeed(null, 'kmh')).toBe('—');
  });

  it('距離與時間格式', () => {
    expect(formatDistance(8.42)).toBe('8.4');
    expect(formatDistance(null)).toBe('—');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('時鐘與檔名時間戳', () => {
    const t = new Date(2026, 9, 3, 14, 3, 7).getTime();
    expect(formatClock(t)).toBe('14:03:07');
    expect(fileStamp(t)).toBe('20261003_140307');
  });
});
