/**
 * 【UI 層】分頁與網址（#/speed、#/trips…）：重新整理後停在同一頁，電腦上也能直接分享連結。
 *
 * - 換分頁用 location.replace：不留瀏覽紀錄，Android 的返回鍵不會在分頁之間來回跳（主畫面的 App 按返回就離開）
 * - 騎乘模式（#/ride）用一般的跳頁：按返回回到原本的分頁
 */
import { useSyncExternalStore, type ComponentType } from 'react';
import { ActivityIcon, GaugeIcon, RouteIcon, RulerIcon, SettingsIcon, type IconProps } from '../kit';

export type Tab = 'speed' | 'trips' | 'calibrate' | 'data' | 'settings';
export type Route = Tab | 'ride';

export interface TabItem {
  id: Tab;
  label: string;
  /** 電腦版左欄的說明 */
  description: string;
  Icon: ComponentType<IconProps>;
}

export const TABS: TabItem[] = [
  { id: 'speed', label: '速度', description: '對地速度與本次行程', Icon: GaugeIcon },
  { id: 'trips', label: '行程', description: '行程紀錄與速度曲線', Icon: RouteIcon },
  { id: 'calibrate', label: '校正', description: '安裝幾何與校正係數', Icon: RulerIcon },
  { id: 'data', label: '數據', description: '原始資料框與記錄', Icon: ActivityIcon },
  { id: 'settings', label: '設定', description: '顯示、警示與裝置參數', Icon: SettingsIcon },
];

export function parseRoute(hash: string): Route {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  if (id === 'ride') return 'ride';
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'speed';
}

const readRoute = (): Route => parseRoute(window.location.hash);

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, readRoute, () => 'speed' as Route);
}

/** 換分頁；已經在這一頁就捲回最上面 */
export function goTab(tab: Tab): void {
  if (readRoute() === tab) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.location.replace(`#/${tab}`);
  window.scrollTo({ top: 0 });
}

let rideEntered = false;

export function openRide(): void {
  rideEntered = true;
  window.location.hash = '#/ride';
}

/** 離開騎乘模式：從速度頁進來的就返回；直接打開 #/ride（App 捷徑）的就換成速度頁 */
export function closeRide(): void {
  if (rideEntered) {
    rideEntered = false;
    window.history.back();
  } else window.location.replace('#/speed');
}
