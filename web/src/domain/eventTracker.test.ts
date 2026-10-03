import { describe, expect, it } from 'vitest';
import { EventTracker } from './eventTracker';
import type { AlertLevel, Telemetry } from './types';

function sample(t: number, level: AlertLevel, distanceM: number | null = null, closingMps: number | null = null, ttcS: number | null = null): Telemetry {
  return {
    radarOnline: true,
    warning: level > 0,
    level,
    distanceM,
    closingMps,
    ttcS,
    rawTargets: distanceM === null ? 0 : 1,
    rawRangeM: distanceM,
    rawSpeedMps: closingMps === null ? null : -closingMps,
    energy: 0,
    uptimeS: t / 1000,
    ownSpeedKmh: null,
    receivedAt: t,
  };
}

describe('EventTracker', () => {
  it('記錄一次來車：最近距離、最大接近速度、最短 TTC、最高等級', () => {
    const tr = new EventTracker(1500);
    expect(tr.update(sample(0, 0))).toBeNull();
    expect(tr.update(sample(200, 1, 14, 6, 2.3))).toBeNull();
    expect(tr.active).toBe(true);
    expect(tr.update(sample(400, 2, 9, 7, 1.3))).toBeNull();
    expect(tr.update(sample(600, 2, 6, 6.5, 0.9))).toBeNull();
    expect(tr.update(sample(800, 0))).toBeNull(); // 剛回到安全，還在保持期間
    const e = tr.update(sample(2200, 0));
    expect(e).not.toBeNull();
    expect(e).toMatchObject({ startedAt: 200, endedAt: 600, minDistanceM: 6, maxClosingMps: 7, minTtcS: 0.9, maxLevel: 2 });
    expect(e?.durationS).toBeCloseTo(0.4);
    expect(tr.active).toBe(false);
  });

  it('短暫回到安全又警示，算同一次事件', () => {
    const tr = new EventTracker(1500);
    tr.update(sample(0, 1, 12, 5, 2.4));
    tr.update(sample(500, 0));
    tr.update(sample(1000, 1, 8, 5, 1.6));
    expect(tr.update(sample(1400, 0))).toBeNull();
    const e = tr.update(sample(2600, 0));
    expect(e?.startedAt).toBe(0);
    expect(e?.minDistanceM).toBe(8);
  });

  it('flush 會結束進行中的事件', () => {
    const tr = new EventTracker();
    tr.update(sample(0, 2, 3, 4, 0.8));
    expect(tr.flush()?.maxLevel).toBe(2);
    expect(tr.flush()).toBeNull();
  });
});
