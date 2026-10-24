import { describe, expect, it } from 'vitest';
import { GAP, MAX_TRACE_POINTS, TraceBuilder, isTrace, tracePoints } from './trace';

/** 10 Hz 的遙測：從 fromMs 到 toMs，速度固定 */
function feed(b: TraceBuilder, fromMs: number, toMs: number, speedMps: number | null) {
  for (let t = fromMs; t < toMs; t += 100) b.update({ receivedAt: t, speedMps });
}

describe('TraceBuilder', () => {
  it('每秒一格的平均速度（cm/s）', () => {
    const b = new TraceBuilder();
    feed(b, 0, 1000, 5);
    feed(b, 1000, 2000, 6);
    expect(b.snapshot()).toEqual({ stepS: 1, v: [500, 600] });
  });

  it('藍牙中斷的空檔記 GAP；量不到速度的那一筆不算進平均', () => {
    const b = new TraceBuilder();
    feed(b, 0, 1000, 4);
    feed(b, 3000, 4000, 4);
    b.update({ receivedAt: 4000, speedMps: null });
    b.update({ receivedAt: 4500, speedMps: 2 });
    expect(b.snapshot().v).toEqual([400, GAP, GAP, 400, 200]);
    expect(tracePoints(b.snapshot())[1]).toEqual({ s: 1, mps: null });
  });

  it('點數到上限時兩兩合併、間隔加倍，平均不變', () => {
    const b = new TraceBuilder();
    feed(b, 0, MAX_TRACE_POINTS * 1000 + 500, 5);
    const s = b.snapshot();
    expect(s.stepS).toBe(2);
    expect(s.v.length).toBeLessThan(MAX_TRACE_POINTS);
    expect(s.v.length).toBeGreaterThan(MAX_TRACE_POINTS / 2 - 2);
    expect(s.v.every((v) => v === 500)).toBe(true);
  });

  it('一小時的行程不會超過上限', () => {
    const b = new TraceBuilder();
    for (let t = 0; t < 3600_000; t += 100) b.update({ receivedAt: t, speedMps: 5 + Math.sin(t / 60_000) });
    const s = b.snapshot();
    expect(s.v.length).toBeLessThanOrEqual(MAX_TRACE_POINTS);
    expect(s.stepS * s.v.length).toBeGreaterThanOrEqual(3599);
  });

  it('從存檔接續：中間沒開網頁的時間是 GAP', () => {
    const b = new TraceBuilder();
    b.restore({ stepS: 1, v: [300, 310] }, 10_000);
    feed(b, 12_000, 13_000, 5);
    expect(b.snapshot().v).toEqual([300, 310, GAP, GAP, 500]);
  });

  it('isTrace 檢查存檔', () => {
    expect(isTrace({ stepS: 1, v: [1, 2] })).toBe(true);
    expect(isTrace({ stepS: 0, v: [] })).toBe(false);
    expect(isTrace({ stepS: 1, v: ['x'] })).toBe(false);
    expect(isTrace(null)).toBe(false);
  });
});
