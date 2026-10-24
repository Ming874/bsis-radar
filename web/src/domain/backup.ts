/**
 * 【領域層】備份檔：把這台裝置上的偏好設定、行程紀錄、校正紀錄存成一個 JSON，換手機或清除瀏覽器資料前備份。
 *
 * 匯入時逐筆檢查，壞掉的行程或校正紀錄略過（不讓整個檔案失敗）；設定由應用層挑出認得的欄位。
 */
import type { CalibrationRun } from './calibration';
import { isSavedTrip, type SavedTrip } from './trip';

export const BACKUP_APP = 'bsis-speed';
export const BACKUP_VERSION = 1;

export interface LastApplied {
  at: number;
  from: number;
  to: number;
  runs: number;
}

export interface BackupData {
  settings: Record<string, unknown>;
  trips: SavedTrip[];
  calibration: { runs: CalibrationRun[]; lastApplied: LastApplied | null };
}

export interface BackupFile extends BackupData {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  webVersion: string;
}

export function buildBackup(data: BackupData, exportedAt: number, webVersion: string): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, webVersion, ...data };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isCalibrationRun(value: unknown): value is CalibrationRun {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    (r.method === 'distance' || r.method === 'wheel') &&
    finite(r.at) &&
    finite(r.radarM) &&
    r.radarM > 0 &&
    finite(r.referenceM) &&
    r.referenceM > 0 &&
    finite(r.calibrationUsed) &&
    r.calibrationUsed > 0
  );
}

function isLastApplied(value: unknown): value is LastApplied {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  return finite(l.at) && finite(l.from) && finite(l.to) && finite(l.runs);
}

export type ParsedBackup = { ok: true; backup: BackupFile; skipped: number } | { ok: false; error: string };

/** 讀備份檔的文字；skipped 是略過的壞資料筆數 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是 JSON 檔' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '檔案內容不正確' };
  const b = raw as Record<string, unknown>;
  if (b.app !== BACKUP_APP) return { ok: false, error: '不是 BSIS 測速的備份檔' };
  if (b.version !== BACKUP_VERSION) return { ok: false, error: `備份檔版本 ${String(b.version)} 不支援` };

  const rawTrips = Array.isArray(b.trips) ? b.trips : [];
  const trips = rawTrips.filter(isSavedTrip);
  const cal = (b.calibration && typeof b.calibration === 'object' ? b.calibration : {}) as Record<string, unknown>;
  const rawRuns = Array.isArray(cal.runs) ? cal.runs : [];
  const runs = rawRuns.filter(isCalibrationRun);
  const settings = b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings) ? (b.settings as Record<string, unknown>) : {};

  return {
    ok: true,
    skipped: rawTrips.length - trips.length + (rawRuns.length - runs.length),
    backup: {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: finite(b.exportedAt) ? b.exportedAt : 0,
      webVersion: typeof b.webVersion === 'string' ? b.webVersion : '?',
      settings,
      trips,
      calibration: { runs, lastApplied: isLastApplied(cal.lastApplied) ? cal.lastApplied : null },
    },
  };
}

/** 合併行程：同一個 id 保留原本的，新的依開始時間由新到舊排在一起；回傳合併後的清單與新增筆數 */
export function mergeTrips(current: SavedTrip[], incoming: SavedTrip[], max: number): { trips: SavedTrip[]; added: number } {
  const ids = new Set(current.map((t) => t.id));
  const fresh: SavedTrip[] = [];
  for (const t of incoming) {
    if (ids.has(t.id)) continue; // 已經有的、或同一個檔案裡重複的
    ids.add(t.id);
    fresh.push(t);
  }
  const trips = [...current, ...fresh].sort((a, b) => b.startedAt - a.startedAt).slice(0, max);
  const kept = new Set(trips.map((t) => t.id));
  return { trips, added: fresh.filter((t) => kept.has(t.id)).length };
}
