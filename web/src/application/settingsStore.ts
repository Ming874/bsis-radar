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
  haptics: boolean; // 按鍵的觸覺回饋（Android）
}

export interface SettingsStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  speedUnit: 'kmh',
  theme: 'system',
  keepAwake: true,
  autoReconnect: true,
  speedAlert: true,
  speedLimitKmh: 25, // 台灣電動輔助自行車、微型電動二輪車的最大行駛速率（docs/SPEED_ALERT.md §1）
  alertSound: true,
  alertVibrate: true,
  haptics: true,
};

/** 存檔的速限不合理（手動改過或舊資料）時用預設值 */
function sanitize(saved: Partial<AppSettings>): Partial<AppSettings> {
  const limit = saved.speedLimitKmh;
  const ok = typeof limit === 'number' && Number.isFinite(limit) && limit >= SPEED_LIMIT_KMH.min && limit <= SPEED_LIMIT_KMH.max;
  return ok ? saved : { ...saved, speedLimitKmh: DEFAULT_SETTINGS.speedLimitKmh };
}

const CHOICES: { [K in keyof AppSettings]?: readonly AppSettings[K][] } = {
  speedUnit: ['kmh', 'mps'],
  theme: ['system', 'dark', 'light'],
};

/** 從匯入的備份挑出認得、型別正確的設定（其他忽略） */
export function pickSettings(raw: Record<string, unknown>): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    const value = raw[key];
    const choices = CHOICES[key] as readonly unknown[] | undefined;
    if (choices ? choices.includes(value) : typeof value === typeof DEFAULT_SETTINGS[key]) out[key] = value;
  }
  // 沒有速限的備份不要蓋掉現在的速限
  return 'speedLimitKmh' in out ? sanitize(out as Partial<AppSettings>) : (out as Partial<AppSettings>);
}

/** 目前的設定（不含函式），匯出備份用 */
export function settingsSnapshot(s: AppSettings): AppSettings {
  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;
  return Object.fromEntries(keys.map((k) => [k, s[k]])) as unknown as AppSettings;
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
  store.subscribe((s) => saveJson(SETTINGS_STORAGE_KEY, settingsSnapshot(s)));
  return store;
}
