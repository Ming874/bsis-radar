/**
 * 【基礎設施層】CSV 匯出：原始遙測記錄與來車事件，給報告做成功率分析。
 */
import type { ApproachEvent, Telemetry } from '../../domain/types';

const TELEMETRY_HEADER = [
  'time_iso',
  'radar_online',
  'level',
  'distance_m',
  'closing_mps',
  'ttc_s',
  'raw_targets',
  'raw_range_m',
  'raw_speed_mps',
  'energy',
  'uptime_s',
  'own_speed_kmh',
  'velocity_source',
  'range_rate_mps',
];

const cell = (v: number | null | boolean): string => (v === null ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));

export class CsvRecorder {
  private rows: string[] = [];

  get rowCount(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
  }

  append(t: Telemetry): void {
    this.rows.push(
      [
        new Date(t.receivedAt).toISOString(),
        cell(t.radarOnline),
        t.level,
        cell(t.distanceM),
        cell(t.closingMps),
        cell(t.ttcS),
        t.rawTargets,
        cell(t.rawRangeM),
        cell(t.rawSpeedMps),
        t.energy,
        t.uptimeS,
        cell(t.ownSpeedKmh),
        t.velocitySource ?? '',
        cell(t.rangeRateMps),
      ].join(','),
    );
  }

  toCsv(): string {
    return [TELEMETRY_HEADER.join(','), ...this.rows].join('\n');
  }
}

export function eventsToCsv(events: ApproachEvent[]): string {
  const header = 'start_iso,end_iso,duration_s,min_distance_m,max_closing_kmh,min_ttc_s,max_level';
  const rows = events.map((e) =>
    [
      new Date(e.startedAt).toISOString(),
      new Date(e.endedAt).toISOString(),
      e.durationS.toFixed(1),
      e.minDistanceM?.toFixed(2) ?? '',
      e.maxClosingMps === null ? '' : (e.maxClosingMps * 3.6).toFixed(1),
      e.minTtcS?.toFixed(1) ?? '',
      e.maxLevel,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** 觸發瀏覽器下載（加 BOM，Excel 開啟中文才不會亂碼） */
export function downloadText(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob(['﻿', content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
