/**
 * 【領域層】備份檔：把這台裝置上的偏好設定、行程紀錄存成一個 JSON，換手機或清除瀏覽器資料前備份。
 *
 * 匯入時逐筆檢查，壞掉的行程略過（不讓整個檔案失敗）；設定由應用層挑出認得的欄位。
 * 網頁 3.1 以前的備份檔另有 calibration（校正紀錄），網頁已經不做校正，匯入時忽略。
 */
import { isSavedTrip, type SavedTrip } from './trip';

export const BACKUP_APP = 'bsis-speed';
export const BACKUP_VERSION = 1;

export interface BackupData {
  settings: Record<string, unknown>;
  trips: SavedTrip[];
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
  const settings = b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings) ? (b.settings as Record<string, unknown>) : {};

  return {
    ok: true,
    skipped: rawTrips.length - trips.length,
    backup: {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: finite(b.exportedAt) ? b.exportedAt : 0,
      webVersion: typeof b.webVersion === 'string' ? b.webVersion : '?',
      settings,
      trips,
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
