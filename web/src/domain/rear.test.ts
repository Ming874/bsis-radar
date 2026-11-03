import { describe, expect, it } from 'vitest';
import { CAUTION_COOLDOWN_MS, DANGER_REPEAT_MS, NO_REAR_CUE, alertDelta, lateralM, leadTarget, rearSpeech, stepRearCue, vehicleSpeedMps, type RearCue, type RearCueState } from './rear';
import { TripMeter } from './trip';
import type { RearLevel } from './types';

/** 依序餵 [時間, 等級, 保持中]，回傳每一步的提示 */
function run(steps: Array<[number, RearLevel, boolean?]>, online = true): Array<RearCue | null> {
  let state: RearCueState = NO_REAR_CUE;
  return steps.map(([at, level, holding = false]) => {
    const r = stepRearCue(state, { online, level, holding }, at);
    state = r.state;
    return r.cue;
  });
}

describe('stepRearCue：後方來車什麼時候響', () => {
  it('安全 → 注意 → 危險：各響一次；危險持續時每 1.5 秒再響', () => {
    const cues = run([
      [0, 'safe'],
      [100, 'caution'],
      [200, 'caution'],
      [300, 'danger'],
      [400, 'danger'],
      [300 + DANGER_REPEAT_MS, 'danger'],
      [400 + DANGER_REPEAT_MS, 'danger'],
    ]);
    expect(cues).toEqual([null, 'caution', null, 'danger', null, 'danger', null]);
  });

  it('來車已不在視野（保持中）：不重複響', () => {
    const cues = run([
      [0, 'danger'],
      [DANGER_REPEAT_MS + 10, 'danger', true],
      [DANGER_REPEAT_MS * 2 + 20, 'danger', true],
    ]);
    expect(cues).toEqual(['danger', null, null]);
  });

  it('注意在邊界反覆進出：4 秒內只響一次；直接跳到危險照響', () => {
    const cues = run([
      [0, 'caution'],
      [500, 'safe'],
      [1000, 'caution'],
      [1500, 'safe'],
      [CAUTION_COOLDOWN_MS + 10, 'caution'],
      [CAUTION_COOLDOWN_MS + 100, 'safe'],
      [CAUTION_COOLDOWN_MS + 200, 'danger'],
    ]);
    expect(cues).toEqual(['caution', null, null, null, 'caution', null, 'danger']);
  });

  it('等級下降不響；後方雷達離線清除狀態', () => {
    expect(run([[0, 'danger'], [100, 'caution'], [200, 'safe']])).toEqual(['danger', null, null]);
    expect(run([[0, 'danger']], false)).toEqual([null]);
  });

  it('語音內容', () => {
    expect(rearSpeech('caution')).toBe('後方有車');
    expect(rearSpeech('danger')).toContain('小心');
  });
});

describe('顯示用換算', () => {
  it('後車車速 = 自己的對地速度 + 接近速度', () => {
    expect(vehicleSpeedMps(5, 8)).toBe(13);
    expect(vehicleSpeedMps(null, 8)).toBeNull();
    expect(vehicleSpeedMps(5, null)).toBeNull();
  });

  it('左右位置 = 距離 × sin（角度），可對調', () => {
    expect(lateralM({ angleDeg: 30, distanceM: 10 }, false)).toBeCloseTo(5, 6);
    expect(lateralM({ angleDeg: 30, distanceM: 10 }, true)).toBeCloseTo(-5, 6);
    expect(lateralM({ angleDeg: 0, distanceM: 10 }, false)).toBeCloseTo(0, 6);
  });

  it('主要來車：最接近濾波距離的靠近目標', () => {
    const targets = [
      { angleDeg: 0, distanceM: 20, speedKmh: 30 },
      { angleDeg: 0, distanceM: 12, speedKmh: -20 }, // 遠離的不算
      { angleDeg: 0, distanceM: 9, speedKmh: 15 },
    ];
    expect(leadTarget({ distanceM: 11.6, targets })).toBe(targets[2]);
    expect(leadTarget({ distanceM: null, targets })).toBeNull();
  });
});

describe('警示次數（行程）', () => {
  it('用韌體的累計值差值累加；ESP32 重新開機時從 0 開始', () => {
    expect(alertDelta(null, 5)).toBe(0); // 第一筆只當基準
    expect(alertDelta(5, 7)).toBe(2);
    expect(alertDelta(7, 1)).toBe(1); // 重新開機
    const trip = new TripMeter(0);
    trip.updateRear(10);
    trip.updateRear(11);
    trip.updateRear(13);
    trip.updateRear(1); // ESP32 重新開機
    expect(trip.snapshot().rearAlerts).toBe(4);
    trip.reset(1000);
    expect(trip.snapshot().rearAlerts).toBe(0);
    trip.updateRear(2);
    expect(trip.snapshot().rearAlerts).toBe(1); // 重設後基準保留
    // 存檔、接續
    const saved = trip.save();
    const resumed = new TripMeter(0);
    resumed.restore(saved);
    resumed.updateRear(3);
    expect(resumed.snapshot().rearAlerts).toBe(2);
    // 3.1 以前存的本次行程沒有這兩個欄位
    const old = new TripMeter(0);
    old.restore({ ...saved, rearAlerts: undefined, lastRearCnt: undefined });
    old.updateRear(9);
    expect(old.snapshot().rearAlerts).toBe(0);
  });
});
