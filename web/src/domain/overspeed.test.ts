import { describe, expect, it } from 'vitest';
import { NO_OVERSPEED, overspeedEvidence, stepOverspeed, type OverspeedState } from './overspeed';
import type { SpeedState } from './types';

const LIMIT = 25 / 3.6;
const kmh = (v: number) => v / 3.6;

/** 以 10 Hz 依序送入速度（km/h），回傳每一筆之後的狀態 */
function run(speedsKmh: number[], start: OverspeedState = NO_OVERSPEED, state: SpeedState = 'tracking'): OverspeedState[] {
  let s = start;
  return speedsKmh.map((v, k) => (s = stepOverspeed(s, overspeedEvidence({ state, speedMps: kmh(v) }, LIMIT, null), k * 100)));
}

const repeat = (v: number, n: number) => Array<number>(n).fill(v);

describe('overspeedEvidence', () => {
  it('追蹤中：達到速限為 over，低於速限 − 1 km/h 為 under，中間維持現狀', () => {
    const ev = (v: number) => overspeedEvidence({ state: 'tracking', speedMps: kmh(v) }, LIMIT, null);
    expect(ev(25)).toBe('over');
    expect(ev(24.5)).toBe('hold');
    expect(ev(24.01)).toBe('hold');
    expect(ev(23.9)).toBe('under');
  });

  it('量不到速度（靜止、擷取、中斷、雷達離線）立即解除；保持中維持現狀', () => {
    for (const state of ['stopped', 'acquiring', 'lost', 'noRadar'] as const) {
      expect(overspeedEvidence({ state, speedMps: kmh(30) }, LIMIT, null)).toBe('unknown');
    }
    expect(overspeedEvidence({ state: 'holding', speedMps: kmh(30) }, LIMIT, null)).toBe('hold');
    expect(overspeedEvidence({ state: 'tracking', speedMps: null }, LIMIT, null)).toBe('unknown');
  });

  it('超出測速上限：只有不折疊的最高速度 ≥ 速限時才代表一定超速', () => {
    expect(overspeedEvidence({ state: 'overRange', speedMps: null }, LIMIT, kmh(16.7))).toBe('unknown');
    expect(overspeedEvidence({ state: 'overRange', speedMps: null }, LIMIT, kmh(50.9))).toBe('over');
    expect(overspeedEvidence({ state: 'overRange', speedMps: null }, LIMIT, null)).toBe('unknown');
  });
});

describe('stepOverspeed', () => {
  it('持續 0.5 秒達到速限才進入；開始時間是條件開始成立的時刻', () => {
    const states = run([20, 26, 26, 26, 26, 26, 26]);
    expect(states[5]?.active).toBe(false); // 26 km/h 才 0.4 秒
    expect(states[6]?.active).toBe(true);
    expect(states[6]?.since).toBe(100);
  });

  it('一兩筆超過速限的雜訊不會觸發', () => {
    const states = run([24, 25.5, 25.5, 24.5, 25.5, 25.5, 25.5, 24.5, 25.5]);
    expect(states.every((s) => !s.active)).toBe(true);
  });

  it('遲滯：在速限 − 1 km/h 到速限之間維持超速；低於速限 − 1 km/h 持續 1 秒才解除', () => {
    const entered = run(repeat(27, 6)).at(-1);
    expect(entered?.active).toBe(true);
    const band = run(repeat(24.3, 50), entered);
    expect(band.every((s) => s.active)).toBe(true);
    const below = run(repeat(23, 11), entered);
    expect(below[9]?.active).toBe(true); // 0.9 秒
    expect(below[10]?.active).toBe(false);
  });

  it('解除期間又回到遲滯帶內：重新計時', () => {
    const entered = run(repeat(27, 6)).at(-1);
    const states = run([...repeat(23, 8), 24.5, ...repeat(23, 8)], entered);
    expect(states.every((s) => s.active)).toBe(true);
  });

  it('量不到速度時立即解除，保持中維持超速', () => {
    const entered = run(repeat(27, 6)).at(-1);
    expect(run(repeat(27, 15), entered, 'holding').every((s) => s.active)).toBe(true);
    expect(run([27], entered, 'lost')[0]).toEqual(NO_OVERSPEED);
  });

  it('沒有變化時回傳同一個物件（訂閱者不會收到多餘的更新）', () => {
    const s = stepOverspeed(NO_OVERSPEED, 'under', 0);
    expect(s).toBe(NO_OVERSPEED);
    const pending = stepOverspeed(NO_OVERSPEED, 'over', 0);
    expect(stepOverspeed(pending, 'over', 100)).toBe(pending);
  });
});
