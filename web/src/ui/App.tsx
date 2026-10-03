/**
 * 【UI 層】App 外框：頂端列、導覽（手機底部分頁列 / 電腦左側導覽列）、提示訊息、分頁內容、危險光暈；套用深色 / 淺色主題。
 */
import { useEffect, useState } from 'react';
import { useSettings } from '../application/container';
import { DevicePage } from './features/device/DevicePage';
import { HistoryPage } from './features/history/HistoryPage';
import { RidePage } from './features/ride/RidePage';
import { SettingsPage } from './features/settings/SettingsPage';
import { BikeIcon, CpuIcon, HistoryIcon, SettingsIcon, Toaster } from './kit';
import { DangerFlash } from './shell/DangerFlash';
import { SideNav } from './shell/SideNav';
import { TabBar, type TabItem } from './shell/TabBar';
import { TopBar } from './shell/TopBar';

type Tab = 'ride' | 'history' | 'device' | 'settings';

const TABS: Array<TabItem<Tab>> = [
  { id: 'ride', label: '騎乘', Icon: BikeIcon },
  { id: 'history', label: '紀錄', Icon: HistoryIcon },
  { id: 'device', label: '裝置', Icon: CpuIcon },
  { id: 'settings', label: '設定', Icon: SettingsIcon },
];

/** 依設定切換深色 / 淺色，跟隨系統時會即時反應 */
function useApplyTheme(): void {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      // 與頂端列同色，手機瀏覽器的網址列才不會突兀
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1a1b1e' : '#ffffff');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  const [tab, setTab] = useState<Tab>('ride');
  useApplyTheme();

  const select = (id: Tab) => {
    setTab(id);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-dvh bg-canvas font-sans text-ink">
      <TopBar />
      <SideNav tabs={TABS} active={tab} onSelect={select} />
      <Toaster />
      <DangerFlash />
      <main className="px-4 pt-4 pb-32 lg:pt-8 lg:pr-8 lg:pb-12 lg:pl-68">
        <div className="mx-auto max-w-xl lg:max-w-6xl">
          {tab === 'ride' && <RidePage />}
          {tab === 'history' && <HistoryPage />}
          {tab === 'device' && <DevicePage />}
          {tab === 'settings' && <SettingsPage />}
        </div>
      </main>
      <TabBar tabs={TABS} active={tab} onSelect={select} />
    </div>
  );
}
