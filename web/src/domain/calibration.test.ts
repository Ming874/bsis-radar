import { describe, expect, it } from 'vitest';
import { AgreementTracker, checkCalibration, combineRuns, evaluateRun, roundCalibration } from './calibration';

describe('calibration', () => {
  it('單趟：雷達量少了 5% → 係數放大 1/0.95', () => {
    const r = evaluateRun({ radarM: 95, referenceM: 100, calibrationUsed: 1 });
    expect(r?.errorPct).toBeCloseTo(-5, 6);
    expect(r?.newCalibration).toBeCloseTo(100 / 95, 6);
    expect(evaluateRun({ radarM: 0, referenceM: 100, calibrationUsed: 1 })).toBeNull();
  });

  it('單趟：沿用目前的係數', () => {
    const r = evaluateRun({ radarM: 102, referenceM: 100, calibrationUsed: 1.2 });
    expect(r?.newCalibration).toBeCloseTo((1.2 * 100) / 102, 6);
  });

  it('多趟合併：依距離加權，且不同趟用不同係數也能合併', () => {
    // 真實的「CAL = 1 時」雷達讀數 = 真實距離 × 0.8
    const runs = [
      { radarM: 80, referenceM: 100, calibrationUsed: 1 },
      { radarM: 200, referenceM: 200, calibrationUsed: 1.25 },
    ];
    const c = combineRuns(runs);
    expect(c?.calibration).toBeCloseTo(1.25, 6);
    expect(c?.runs).toBe(2);
    expect(c?.spreadPct).toBeCloseTo(0, 6);
    expect(combineRuns([])).toBeNull();
    expect(combineRuns([{ radarM: 90, referenceM: 100, calibrationUsed: 1 }])?.spreadPct).toBeNull();
  });

  it('合理性檢查', () => {
    expect(checkCalibration(1, 1.1)).toBeNull();
    expect(checkCalibration(1, 1.6)).toBe('largeChange');
    expect(checkCalibration(1, 2.4)).toBe('outOfRange');
    expect(checkCalibration(1, Number.NaN)).toBe('outOfRange');
    expect(roundCalibration(1.234567)).toBe(1.2346);
  });
});

describe('AgreementTracker', () => {
  it('距離比與速度差', () => {
    const a = new AgreementTracker();
    // 雷達比輪速多 2%
    for (let k = 0; k <= 100; k++) a.update(5.1, 5, 1000 + k * 0.51, 300 + k * 0.5);
    const s = a.stats();
    expect(s.samples).toBe(101);
    expect(s.meanDiffMps).toBeCloseTo(0.1, 6);
    expect(s.rmsDiffMps).toBeCloseTo(0.1, 6);
    expect(s.meanDiffPct).toBeCloseTo(2, 6);
    expect(s.distanceErrorPct).toBeCloseTo(2, 6);
    expect(s.wheelDistanceM).toBeCloseTo(50, 6);
  });

  it('慢速與雷達非追蹤狀態不取樣；距離太短不算距離誤差', () => {
    const a = new AgreementTracker();
    a.update(1, 1, 0, 0);
    a.update(null, 5, 1, 1);
    a.update(5, 5, 2, 2);
    expect(a.stats().samples).toBe(1); // 只有最後一筆（雷達追蹤中、輪速 ≥ 2 m/s）
    expect(a.stats().distanceErrorPct).toBeNull(); // 才走 2 m
  });

  it('沒有輪速感測器時什麼都不算；重設', () => {
    const a = new AgreementTracker();
    a.update(5, null, 10, null);
    expect(a.stats().samples).toBe(0);
    a.update(5, 5, 10, 10);
    a.update(5, 5, 30, 30);
    a.reset();
    expect(a.stats().samples).toBe(0);
    expect(a.stats().radarDistanceM).toBe(0);
  });
});
