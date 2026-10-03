import { describe, expect, it } from 'vitest';
import type { Telemetry } from '../domain/types';
import { selectEnergyPeak, selectSafety } from './selectors';

const telemetry = (patch: Partial<Telemetry> = {}): Telemetry => ({
  radarOnline: true,
  warning: false,
  level: 0,
  distanceM: null,
  closingMps: null,
  ttcS: null,
  rawTargets: 0,
  rawRangeM: null,
  rawSpeedMps: null,
  energy: 0,
  uptimeS: 1,
  ownSpeedKmh: null,
  velocitySource: null,
  rangeRateMps: null,
  receivedAt: 10_000,
  ...patch,
});

describe('selectSafety', () => {
  it('依連線狀態顯示', () => {
    expect(selectSafety({ connection: { status: 'idle' }, stale: false, telemetry: null }).tone).toBe('idle');
    expect(selectSafety({ connection: { status: 'reconnecting', attempt: 3 }, stale: false, telemetry: null }).detail).toContain('第 3 次');
    expect(selectSafety({ connection: { status: 'connected' }, stale: true, telemetry: telemetry() }).tone).toBe('stale');
    expect(selectSafety({ connection: { status: 'connected' }, stale: false, telemetry: telemetry({ radarOnline: false }) }).tone).toBe('offline');
  });

  it('依警示等級顯示', () => {
    const base = { connection: { status: 'connected' as const }, stale: false };
    expect(selectSafety({ ...base, telemetry: telemetry() }).tone).toBe('safe');
    const caution = selectSafety({ ...base, telemetry: telemetry({ level: 1, distanceM: 12.3, ttcS: 2.1 }) });
    expect(caution).toEqual({ tone: 'caution', title: '注意：後方來車', detail: '距離 12.3 m，約 2.1 秒後到達' });
    expect(selectSafety({ ...base, telemetry: telemetry({ level: 2, distanceM: 5, ttcS: 0.8 }) }).tone).toBe('danger');
  });
});

describe('selectEnergyPeak', () => {
  it('只看最近 10 秒', () => {
    const history = [
      { t: -500, distanceM: null, level: 0 as const, energy: 90000 }, // 10.5 秒前：不算
      { t: 5000, distanceM: null, level: 0 as const, energy: 40000 },
      { t: 10000, distanceM: null, level: 0 as const, energy: 20000 },
    ];
    expect(selectEnergyPeak({ history, telemetry: telemetry({ receivedAt: 10_000 }) })).toBe(40000);
    expect(selectEnergyPeak({ history: [], telemetry: null })).toBe(0);
  });
});
