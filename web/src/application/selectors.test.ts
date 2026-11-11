import { describe, expect, it } from 'vitest';
import type { Telemetry } from '../domain/types';
import { describeState, firmwareMismatch, recentAccel, selectLink, verdictBreakdown } from './selectors';

const tele = { radarOnline: true } as Telemetry;

describe('selectLink', () => {
  it('連線狀態', () => {
    expect(selectLink({ connection: { status: 'idle' }, stale: false, telemetry: null, legacyFirmware: null }).label).toBe('未連線');
    expect(selectLink({ connection: { status: 'connecting' }, stale: false, telemetry: null, legacyFirmware: null }).tone).toBe('busy');
    expect(selectLink({ connection: { status: 'reconnecting', attempt: 3 }, stale: false, telemetry: null, legacyFirmware: null }).detail).toBe('第 3 次');
  });

  it('已連線：依序檢查韌體版本、資料中斷、雷達', () => {
    const base = { connection: { status: 'connected' as const }, stale: false, telemetry: tele, legacyFirmware: null };
    expect(selectLink(base)).toEqual({ tone: 'ok', label: '已連線' });
    expect(selectLink({ ...base, legacyFirmware: '2.4.0' }).label).toBe('韌體過舊');
    expect(selectLink({ ...base, stale: true }).label).toBe('資料中斷');
    expect(selectLink({ ...base, telemetry: null }).label).toBe('等待資料');
    expect(selectLink({ ...base, telemetry: { ...tele, radarOnline: false } }).label).toBe('雷達離線');
  });
});

describe('其他', () => {
  it('估計器狀態', () => {
    expect(describeState('tracking').tone).toBe('ok');
    expect(describeState('lost').tone).toBe('bad');
    expect(describeState('stopped').label).toBe('靜止');
  });

  it('韌體主版本不同', () => {
    expect(firmwareMismatch('3.0.0')).toBe(false);
    expect(firmwareMismatch('4.0.0')).toBe(true);
    expect(firmwareMismatch(undefined)).toBe(false);
  });

  it('最近 1 秒的加速度', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ t: i * 100, speedMps: 5 + 0.2 * i, wheelMps: null, state: 'tracking' as const }));
    expect(recentAccel(pts)).toBeCloseTo(2, 6);
    expect(recentAccel(pts.slice(-3))).toBeNull(); // 資料不足 1 秒
    expect(recentAccel([])).toBeNull();
  });

  it('判斷碼統計', () => {
    const b = verdictBreakdown(['accepted', 'accepted', 'noTarget', 'accepted']);
    expect(b[0]).toEqual({ verdict: 'accepted', count: 3, pct: 75 });
    expect(b[1]?.verdict).toBe('noTarget');
    expect(verdictBreakdown([])).toEqual([]);
  });
});
