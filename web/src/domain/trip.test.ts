import { describe, expect, it } from 'vitest';
import { TripMeter, averageMps, isSavedTrip, summarizeTrips } from './trip';
import type { Telemetry } from './types';

function tele(at: number, patch: Partial<Telemetry>): Telemetry {
  return {
    radarOnline: true,
    state: 'tracking',
    speedMps: 5,
    sigmaMps: 0.1,
    qualityPct: 100,
    wrongDirPct: 0,
    frame: 0,
    targets: 1,
    rangeM: 0.9,
    radialMps: 3.5,
    energy: 1000,
    groundMps: 5,
    verdict: 'accepted',
    radarDistanceM: 0,
    wheelMps: null,
    wheelDistanceM: null,
    uptimeS: Math.floor(at / 1000),
    receivedAt: at,
    ...patch,
  };
}

describe('TripMeter', () => {
  it('里程用韌體的雷達里程差值累加；移動時間只算在動的時候', () => {
    const trip = new TripMeter(0);
    // 10 秒 5 m/s（10 Hz），再停 5 秒
    for (let k = 0; k <= 100; k++) trip.update(tele(k * 100, { radarDistanceM: 100 + k * 0.5 }));
    for (let k = 101; k <= 150; k++) trip.update(tele(k * 100, { radarDistanceM: 150, speedMps: 0, state: 'stopped' }));
    const s = trip.snapshot();
    expect(s.distanceM).toBeCloseTo(50, 6);
    expect(s.movingS).toBeCloseTo(10, 1);
    expect(s.maxMps).toBe(5);
    expect(averageMps(s)).toBeCloseTo(5, 1);
  });

  it('韌體重開機（DR 歸零）不會出現負的距離', () => {
    const trip = new TripMeter(0);
    trip.update(tele(0, { radarDistanceM: 500, uptimeS: 100 }));
    trip.update(tele(100, { radarDistanceM: 510, uptimeS: 100 }));
    trip.update(tele(200, { radarDistanceM: 0, uptimeS: 0 }));
    trip.update(tele(300, { radarDistanceM: 4, uptimeS: 0 }));
    expect(trip.snapshot().distanceM).toBeCloseTo(14, 6);
  });

  it('藍牙中斷期間韌體照樣積分：重新連上後的差值算進去，但不算移動時間', () => {
    const trip = new TripMeter(0);
    trip.update(tele(0, { radarDistanceM: 0 }));
    trip.update(tele(30_000, { radarDistanceM: 150 }));
    expect(trip.snapshot().distanceM).toBe(150);
    expect(trip.snapshot().movingS).toBe(0);
  });

  it('輪速感測器的里程', () => {
    const trip = new TripMeter(0);
    trip.update(tele(0, { radarDistanceM: 0, wheelDistanceM: 10, wheelMps: 5 }));
    trip.update(tele(100, { radarDistanceM: 0.5, wheelDistanceM: 10.52, wheelMps: 5 }));
    expect(trip.snapshot().wheelDistanceM).toBeCloseTo(0.52, 6);
    const noWheel = new TripMeter(0);
    noWheel.update(tele(0, {}));
    expect(noWheel.snapshot().wheelDistanceM).toBeNull();
  });

  it('超速時間與次數：依傳入的超速狀態累計，藍牙中斷的空檔不算', () => {
    const trip = new TripMeter(0);
    const over = (k: number) => (k >= 10 && k < 30) || (k >= 50 && k < 60);
    for (let k = 0; k < 80; k++) trip.update(tele(k * 100, { radarDistanceM: k * 0.5 }), over(k));
    expect(trip.snapshot().overspeedCount).toBe(2);
    expect(trip.snapshot().overspeedS).toBeCloseTo(1.9 + 0.9, 6);
    trip.update(tele(20_000, {}), true);
    trip.update(tele(30_000, {}), true); // 中斷 10 秒
    expect(trip.snapshot().overspeedCount).toBe(3);
    expect(trip.snapshot().overspeedS).toBeCloseTo(2.8, 6);
  });

  it('重設：從下一筆開始重新累加', () => {
    const trip = new TripMeter(0);
    trip.update(tele(0, { radarDistanceM: 0 }));
    trip.update(tele(100, { radarDistanceM: 20 }));
    trip.reset(200);
    trip.update(tele(300, { radarDistanceM: 25 }));
    expect(trip.snapshot().distanceM).toBe(5);
    expect(trip.snapshot().startedAt).toBe(200);
    expect(averageMps(trip.snapshot())).toBeNull();
  });

  it('存檔後接續：ESP32 沒重開機時，中間騎的距離也算進去；重開機就重新對齊', () => {
    const trip = new TripMeter(0);
    trip.update(tele(0, { radarDistanceM: 100, uptimeS: 50 }));
    trip.update(tele(100, { radarDistanceM: 110, uptimeS: 50 }));
    const saved = trip.save();

    const resumed = new TripMeter(999);
    resumed.restore(saved);
    resumed.update(tele(60_000, { radarDistanceM: 150, uptimeS: 110 }));
    expect(resumed.snapshot().distanceM).toBe(50);
    expect(resumed.snapshot().startedAt).toBe(0);

    const rebooted = new TripMeter(999);
    rebooted.restore(saved);
    rebooted.update(tele(60_000, { radarDistanceM: 3, uptimeS: 5 }));
    rebooted.update(tele(60_100, { radarDistanceM: 4, uptimeS: 5 }));
    expect(rebooted.snapshot().distanceM).toBe(11);
  });
});

describe('行程紀錄', () => {
  it('累計：總里程、總移動時間、平均、最高、最長', () => {
    const totals = summarizeTrips([
      { distanceM: 3000, movingS: 600, maxMps: 8 },
      { distanceM: 1000, movingS: 400, maxMps: 9 },
    ]);
    expect(totals).toEqual({ count: 2, distanceM: 4000, movingS: 1000, maxMps: 9, longestM: 3000, avgMps: 4 });
    expect(summarizeTrips([]).avgMps).toBeNull();
  });

  it('讀回來的行程要檢查格式（舊版沒有的欄位可以缺）', () => {
    const ok = { id: '1', startedAt: 1, endedAt: 2, distanceM: 100, movingS: 20, maxMps: 5, wheelDistanceM: null };
    expect(isSavedTrip(ok)).toBe(true);
    expect(isSavedTrip({ ...ok, trace: { stepS: 1, v: [1] }, limitKmh: null, overspeedS: 0, overspeedCount: 0 })).toBe(true);
    expect(isSavedTrip({ ...ok, distanceM: -1 })).toBe(false);
    expect(isSavedTrip({ ...ok, trace: { stepS: 1, v: 'x' } })).toBe(false);
  });
});
