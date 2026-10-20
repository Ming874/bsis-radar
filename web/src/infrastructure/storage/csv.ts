/**
 * 【基礎設施層】CSV 匯出：每一筆雷達資料框一列，給精度分析（雷達 vs 輪速、模型比較）用。
 * 欄位與遙測一一對應，定義見 docs/PROTOCOL.md。
 */
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
