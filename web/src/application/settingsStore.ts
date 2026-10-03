/**
 * 【應用層】使用者偏好設定（存在這支手機的瀏覽器裡）。
 */
import { createStore } from 'zustand/vanilla';
import type { SpeedUnit } from '../domain/units';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';

export type ThemeSetting = 'system' | 'dark' | 'light';
/** 什麼時候開始發出聲音 / 震動：注意就提醒，或只在危險時提醒 */
export type AlertMode = 'caution' | 'danger';

export interface AppSettings {
  sound: boolean;
  volume: number; // 0 ~ 1
  alertMode: AlertMode;
  vibration: boolean;
  voice: boolean;
  speakDistance: boolean;
  flashScreen: boolean;
  keepAwake: boolean;
  speedUnit: SpeedUnit;
  autoReconnect: boolean;
  theme: ThemeSetting;
}

export interface SettingsStore extends AppSettings {
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sound: true,
  volume: 0.8,
  alertMode: 'caution',
  vibration: true,
  voice: true,
  speakDistance: true,
  flashScreen: true,
  keepAwake: true,
  speedUnit: 'kmh',
  autoReconnect: true,
  theme: 'dark',
};

// v3：預設改為深色主題，舊版存的偏好設定不沿用（index.html 開頭的主題腳本也讀這個名稱）
export const SETTINGS_STORAGE_KEY = 'radarA.settings.v3';

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
