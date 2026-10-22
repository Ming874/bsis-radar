/**
 * 【應用層】使用者偏好設定（存在這支手機的瀏覽器裡）。
 */
import { createStore } from 'zustand/vanilla';
import { SPEED_LIMIT_KMH } from '../domain/overspeed';
import type { SpeedUnit } from '../domain/units';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';

export type ThemeSetting = 'system' | 'dark' | 'light';

export interface AppSettings {
  speedUnit: SpeedUnit;
  theme: ThemeSetting;
  keepAwake: boolean;
  autoReconnect: boolean;
  speedAlert: boolean; // 超速警示
  speedLimitKmh: number; // 速限
  alertSound: boolean;
  alertVibrate: boolean;
}

export interface SettingsStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  speedUnit: 'kmh',
  theme: 'dark',
  keepAwake: true,
  autoReconnect: true,
  speedAlert: true,
  speedLimitKmh: 25, // 台灣電動輔助自行車、微型電動二輪車的最大行駛速率（docs/SPEED_ALERT.md §1）
  alertSound: true,
  alertVibrate: true,
};

/** 存檔的速限不合理（手動改過或舊資料）時用預設值 */
function sanitize(saved: Partial<AppSettings>): Partial<AppSettings> {
  const limit = saved.speedLimitKmh;
  const ok = typeof limit === 'number' && Number.isFinite(limit) && limit >= SPEED_LIMIT_KMH.min && limit <= SPEED_LIMIT_KMH.max;
  return ok ? saved : { ...saved, speedLimitKmh: DEFAULT_SETTINGS.speedLimitKmh };
}

// index.html 開頭的主題腳本也讀這個名稱
export const SETTINGS_STORAGE_KEY = 'bsis.settings.v1';

export function createSettingsStore() {
  const saved = sanitize(loadJson<Partial<AppSettings>>(SETTINGS_STORAGE_KEY, {}));
  const store = createStore<SettingsStore>()((set) => ({
    ...DEFAULT_SETTINGS,
    ...saved,
    update: (patch) => set(patch),
    reset: () => set(DEFAULT_SETTINGS),
  }));
  store.subscribe((s) => {
    const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;
    saveJson(SETTINGS_STORAGE_KEY, Object.fromEntries(keys.map((k) => [k, s[k]])));
  });
  return store;
}
