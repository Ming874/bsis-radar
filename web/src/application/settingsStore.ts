/**
 * 【應用層】使用者偏好設定（存在這支手機的瀏覽器裡）。
 */
import { createStore } from 'zustand/vanilla';
import type { SpeedUnit } from '../domain/units';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';

export type ThemeSetting = 'system' | 'dark' | 'light';

export interface AppSettings {
  speedUnit: SpeedUnit;
  theme: ThemeSetting;
  keepAwake: boolean;
  autoReconnect: boolean;
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
};

// index.html 開頭的主題腳本也讀這個名稱
export const SETTINGS_STORAGE_KEY = 'bsis.settings.v1';

export function createSettingsStore() {
  const saved = loadJson<Partial<AppSettings>>(SETTINGS_STORAGE_KEY, {});
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
