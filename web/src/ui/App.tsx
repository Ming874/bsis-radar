/**
 * 【UI 層】App 外框：頂端列、導覽（手機底部分頁列 / 電腦左側選單）、提示訊息、分頁內容；套用深色 / 淺色主題。
 */
import { useEffect } from 'react';
import { useSettings } from '../application/container';
import { CalibratePage } from './features/calibrate/CalibratePage';
import { DataPage } from './features/data/DataPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SpeedPage } from './features/speed/SpeedPage';
import { Toaster } from './kit';
import { SideNav, TabBar } from './shell/Navigation';
import { useTab } from './shell/tabs';
import { TopBar } from './shell/TopBar';

/** 依設定切換深色 / 淺色，跟隨系統時會即時反應 */
function useApplyTheme(): void {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      // 與頂端列同色，手機瀏覽器的網址列才不會突兀
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#131518' : '#ffffff');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  const [tab, select] = useTab();
  useApplyTheme();

  return (
    <div className="min-h-dvh bg-canvas font-sans text-fg antialiased">
      <TopBar />
      <SideNav active={tab} onSelect={select} />
      <Toaster />
      <main className="px-4 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pt-[calc(5.5rem+env(safe-area-inset-top))] lg:pr-8 lg:pb-10 lg:pl-64">
        <div className="mx-auto max-w-xl lg:max-w-6xl">
          {tab === 'speed' && <SpeedPage />}
          {tab === 'calibrate' && <CalibratePage />}
          {tab === 'data' && <DataPage />}
          {tab === 'settings' && <SettingsPage />}
        </div>
      </main>
      <TabBar active={tab} onSelect={select} />
    </div>
  );
}
