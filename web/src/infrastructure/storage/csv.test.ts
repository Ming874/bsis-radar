import { describe, expect, it } from 'vitest';
import type { SavedTrip } from '../../domain/trip';
import { traceCsv, tripsCsv } from './csv';

const trip: SavedTrip = {
  id: '1',
  startedAt: Date.UTC(2026, 9, 24, 6, 0, 0),
  endedAt: Date.UTC(2026, 9, 24, 6, 20, 0),
  distanceM: 5000,
  movingS: 1000,
  maxMps: 8,
  wheelDistanceM: null,
  overspeedS: 3.25,
  overspeedCount: 2,
  limitKmh: 25,
  trace: { stepS: 2, v: [500, -1, 250] },
};

describe('行程匯出', () => {
  it('行程紀錄：一筆一列，速度換成 km/h', () => {
    const lines = tripsCsv([trip, { ...trip, id: '2', movingS: 0, overspeedS: undefined, overspeedCount: undefined, limitKmh: undefined }]).split('\n');
    expect(lines[0]).toBe('start_iso,end_iso,distance_m,moving_s,elapsed_s,avg_kmh,max_kmh,overspeed_count,overspeed_s,limit_kmh,wheel_distance_m');
    expect(lines[1]).toBe('2026-10-24T06:00:00.000Z,2026-10-24T06:20:00.000Z,5000.0,1000,1200,18.00,28.80,2,3.3,25,');
    expect(lines[2]).toBe('2026-10-24T06:00:00.000Z,2026-10-24T06:20:00.000Z,5000.0,0,1200,,28.80,,,,');
  });

  it('速度曲線：沒有資料的格子留空', () => {
    expect(traceCsv(trip).split('\n')).toEqual(['elapsed_s,speed_kmh', '0,18.00', '2,', '4,9.00']);
  });
});
