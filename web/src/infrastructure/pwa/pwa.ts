/**
 * 【基礎設施層】Web App（PWA）：Service Worker、安裝成 App、新版本通知。
 *
 * - beforeinstallprompt 可能在 React 畫出來之前就來：startPwa() 在 main.tsx 一開始就呼叫，先把事件收起來
 * - 從主畫面的 App 打開時記一筆（bsis.installed）：Android 的主畫面 App 和 Chrome 共用 localStorage，Chrome 分頁就知道裝過了
 * - 新版本：每次回到前景、每 30 分鐘看一次 /version.json（建置時產生）。不自動重新載入——騎乘中重新載入會中斷藍牙，
 *   只顯示「有新版本」讓使用者自己按；換頁（navigate）本來就先問網路，下次打開就是新版
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** 現在是從主畫面的 App 打開的 */
  standalone: boolean;
  /** 瀏覽器給了安裝事件，可以一鍵安裝 */
  canInstall: boolean;
  /** 知道這台已經裝過 */
  installed: boolean;
  /** 伺服器上有比這一版新的網頁 */
  update: { version: string } | null;
  /** Service Worker 已經接管，沒有網路也打得開 */
  offlineReady: boolean;
}

const INSTALLED_KEY = 'bsis.installed';
const INSTALLED_FRESH_MS = 60 * 86_400_000;
const UPDATE_EVERY_MS = 30 * 60_000;

/** localStorage 裡記的時間（ms）；沒有或讀不到時 null */
export function readStoredTime(key: string): number | null {
  try {
    const at = Number(localStorage.getItem(key) ?? Number.NaN);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function writeStoredTime(key: string, at: number): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    // 私密模式存不了就算了
  }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

let deferred: InstallPromptEvent | null = null;

export const pwaStore: StoreApi<PwaState> = createStore<PwaState>()(() => ({
  standalone: false,
  canInstall: false,
  installed: false,
  update: null,
  offlineReady: false,
}));

/** 跳出瀏覽器的安裝視窗（只有 canInstall 時有用）；回傳使用者的選擇 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  pwaStore.setState({ canInstall: false });
  await event.prompt();
  const choice = await event.userChoice.catch(() => null);
  return choice?.outcome ?? 'dismissed';
}

/** 看伺服器上的版本；不同就記下來（開發模式沒有 version.json，不會有反應） */
export async function checkForUpdate(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { version?: string; buildId?: string };
    if (!data.buildId || data.buildId === __BUILD_ID__) return false;
    pwaStore.setState({ update: { version: data.version ?? '?' } });
    return true;
  } catch {
    return false;
  }
}

let started = false;

export function startPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const syncStandalone = () => {
    const standalone = isStandalone();
    if (standalone) writeStoredTime(INSTALLED_KEY, Date.now());
    pwaStore.setState({ standalone });
  };
  syncStandalone();
  standaloneQuery.addEventListener('change', syncStandalone);

  const at = readStoredTime(INSTALLED_KEY);
  if (at !== null && Date.now() - at < INSTALLED_FRESH_MS) pwaStore.setState({ installed: true });
  // Android 的 Chrome：manifest 的 related_applications 指向自己，問得到這台是不是已經裝過
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  nav
    .getInstalledRelatedApps?.()
    .then((apps) => apps.length > 0 && pwaStore.setState({ installed: true }))
    .catch(() => undefined);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    pwaStore.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    writeStoredTime(INSTALLED_KEY, Date.now());
    pwaStore.setState({ canInstall: false, installed: true });
  });

  // 正式版才註冊 Service Worker（開發模式不快取，免得一直看到舊的程式）
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
    void navigator.serviceWorker.ready.then(() => pwaStore.setState({ offlineReady: true }));
    setTimeout(() => void checkForUpdate(), 10_000);
    setInterval(() => void checkForUpdate(), UPDATE_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    });
  }
}
