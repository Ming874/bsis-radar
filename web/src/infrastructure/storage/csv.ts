/**
 * 【基礎設施層】CSV 匯出：每一筆雷達資料框一列，給精度分析（雷達 vs 輪速、模型比較）用。
 * 欄位與遙測一一對應，定義見 docs/PROTOCOL.md。
 */
import { tracePoints } from '../../domain/trace';
import type { SavedTrip } from '../../domain/trip';
import type { Telemetry } from '../../domain/types';

const HEADER = [
  'time_iso',
  'uptime_s',
  'frame',
  'radar_online',
  'state',
  'speed_mps',
  'sigma_mps',
  'quality_pct',
  'targets',
  'range_m',
  'radial_mps',
  'energy',
  'ground_mps',
  'verdict',
  'radar_distance_m',
  'wheel_mps',
  'wheel_distance_m',
];

const cell = (v: number | null | boolean | string): string =>
  v === null ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v);

export class CsvRecorder {
  private rows: string[] = [];
  private lastFrame = -1;

  get rowCount(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
    this.lastFrame = -1;
  }

  /** 新的資料框才記錄（心跳行的 FN 不變）；雷達離線時每一行都記，看得出中斷了多久 */
  append(t: Telemetry): boolean {
    if (t.radarOnline && t.frame === this.lastFrame) return false;
    this.lastFrame = t.frame;
    this.rows.push(
      [
        new Date(t.receivedAt).toISOString(),
        t.uptimeS,
        t.frame,
        cell(t.radarOnline),
        t.state,
        cell(t.speedMps),
        t.sigmaMps,
        t.qualityPct,
        t.targets,
        cell(t.rangeM),
        cell(t.radialMps),
        t.energy,
        cell(t.groundMps),
        t.verdict,
        t.radarDistanceM,
        cell(t.wheelMps),
        cell(t.wheelDistanceM),
      ].join(','),
    );
    return true;
  }

  toCsv(): string {
    return [HEADER.join(','), ...this.rows].join('\n');
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const fixed = (v: number | null | undefined, digits: number) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(digits));

/** 行程紀錄 → CSV（「行程」頁的匯出）：一筆行程一列 */
export function tripsCsv(trips: SavedTrip[]): string {
  const header = 'start_iso,end_iso,distance_m,moving_s,elapsed_s,avg_kmh,max_kmh,overspeed_count,overspeed_s,limit_kmh,wheel_distance_m';
  const rows = trips.map((t) =>
    [
      iso(t.startedAt),
      iso(t.endedAt),
      fixed(t.distanceM, 1),
      fixed(t.movingS, 0),
      fixed((t.endedAt - t.startedAt) / 1000, 0),
      t.movingS >= 1 ? fixed((t.distanceM / t.movingS) * 3.6, 2) : '',
      fixed(t.maxMps * 3.6, 2),
      t.overspeedCount ?? '',
      fixed(t.overspeedS, 1),
      fixed(t.limitKmh, 0),
      fixed(t.wheelDistanceM, 1),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** 一筆行程的速度曲線 → CSV：每一格一列（沒有資料的格子留空） */
export function traceCsv(trip: SavedTrip): string {
  if (!trip.trace) return 'elapsed_s,speed_kmh';
  const rows = tracePoints(trip.trace).map((p) => `${p.s},${p.mps === null ? '' : (p.mps * 3.6).toFixed(2)}`);
  return ['elapsed_s,speed_kmh', ...rows].join('\n');
}

/** 觸發瀏覽器下載 */
export function downloadText(filename: string, content: string, mime = 'text/csv'): void {
  // CSV 加 BOM（Excel 才認得 UTF-8）；JSON 不加
  const blob = new Blob(mime === 'text/csv' ? ['﻿', content] : [content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
