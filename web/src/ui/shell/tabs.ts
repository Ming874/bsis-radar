/**
 * 【UI 層】分頁定義與網址同步（#/speed、#/calibrate…）：重新整理後停在同一頁，電腦上也能直接分享連結。
 */
import { useCallback, useSyncExternalStore, type ComponentType } from 'react';
import { ActivityIcon, GaugeIcon, RulerIcon, SettingsIcon, type IconProps } from '../kit';

export type Tab = 'speed' | 'calibrate' | 'data' | 'settings';

export interface TabItem {
  id: Tab;
  label: string;
  Icon: ComponentType<IconProps>;
}

export const TABS: TabItem[] = [
  { id: 'speed', label: '速度', Icon: GaugeIcon },
  { id: 'calibrate', label: '校正', Icon: RulerIcon },
  { id: 'data', label: '數據', Icon: ActivityIcon },
  { id: 'settings', label: '設定', Icon: SettingsIcon },
];

function readTab(): Tab {
  const id = window.location.hash.replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? (id as Tab) : 'speed';
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function useTab(): [Tab, (tab: Tab) => void] {
  const tab = useSyncExternalStore(subscribe, readTab, () => 'speed' as Tab);
  const select = useCallback((next: Tab) => {
    if (next !== readTab()) window.location.hash = `/${next}`;
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, select];
}
