import { describe, expect, it } from 'vitest';
import { BACKUP_APP, buildBackup, mergeTrips, parseBackup } from './backup';
import type { SavedTrip } from './trip';

const trip = (id: number, patch: Partial<SavedTrip> = {}): SavedTrip => ({
  id: String(id),
  startedAt: id,
  endedAt: id + 600_000,
  distanceM: 2500,
  movingS: 500,
  maxMps: 8,
  wheelDistanceM: null,
  overspeedS: 0,
  overspeedCount: 0,
  ...patch,
});

describe('backup', () => {
  it('匯出再匯入得到同樣的資料', () => {
    const file = buildBackup(
      {
        settings: { speedUnit: 'kmh' },
        trips: [trip(1, { trace: { stepS: 1, v: [100, -1, 200] }, limitKmh: 25 })],
        calibration: { runs: [{ id: 'r', method: 'distance', at: 1, radarM: 95, referenceM: 100, calibrationUsed: 1 }], lastApplied: null },
      },
      123,
      '3.0.0',
    );
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed).toEqual({ ok: true, skipped: 0, backup: file });
  });

  it('壞掉的行程與校正紀錄略過，其他照樣匯入', () => {
    const parsed = parseBackup(
      JSON.stringify({
        app: BACKUP_APP,
        version: 1,
        trips: [trip(1), { id: 2 }, trip(3, { distanceM: Number.NaN })],
        calibration: { runs: [{ id: 'x', method: 'laser' }] },
      }),
    );
    expect(parsed.ok && parsed.backup.trips.map((t) => t.id)).toEqual(['1']);
    expect(parsed.ok && parsed.skipped).toBe(3);
  });

  it('不是備份檔', () => {
    expect(parseBackup('hello')).toEqual({ ok: false, error: '不是 JSON 檔' });
    expect(parseBackup('{"app":"other"}')).toMatchObject({ ok: false, error: '不是 BSIS 測速的備份檔' });
    expect(parseBackup(`{"app":"${BACKUP_APP}","version":9}`)).toMatchObject({ ok: false });
  });

  it('合併行程：同一個 id 保留原本的，依開始時間由新到舊、限制筆數', () => {
    const current = [trip(5), trip(3)];
    const { trips, added } = mergeTrips(current, [trip(3, { distanceM: 1 }), trip(4), trip(1)], 3);
    expect(trips.map((t) => t.id)).toEqual(['5', '4', '3']);
    expect(trips[2]?.distanceM).toBe(2500);
    expect(added).toBe(1); // trip 1 被筆數上限擠掉，不算
  });
});
