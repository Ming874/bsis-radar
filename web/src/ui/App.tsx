/**
 * 【UI 層】App 外框：手機是大標題頁面＋浮動分頁列，電腦（≥ 1024 px）是左欄＋內容。
 * 也負責：套用深淺色主題、觸覺回饋開關、移除開場畫面、從任何一頁都能打開的面板（連線、安裝）。
 */
import { useEffect } from 'react';
import { useSettings } from '../application/container';
import { CalibratePage } from './features/calibrate/CalibratePage';
import { DataPage } from './features/data/DataPage';
import { RideMode } from './features/ride/RideMode';
import { SettingsPage } from './features/settings/SettingsPage';
import { SpeedPage } from './features/speed/SpeedPage';
import { TripsPage } from './features/trips/TripsPage';
import { Toaster, setHaptics } from './kit';
import { Banners } from './shell/Banners';
import { ConnectionSheet } from './shell/Connection';
import { InstallPrompt } from './shell/InstallPrompt';
import { MobileTabBar } from './shell/MobileTabBar';
import { Sidebar } from './shell/Sidebar';
import { useRoute } from './shell/tabs';

/** 依設定切換深色 / 淺色，跟隨系統時會即時反應；網址列（theme-color）跟頁面底色一樣 */
function useApplyTheme(): void {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f3f5');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** 開場畫面（index.html 的 #launch，只在從主畫面打開 App 時出現）：畫面好了就淡出移除 */
function hideLaunchScreen(): void {
  const el = document.getElementById('launch');
  const root = document.documentElement;
  if (!el) return;
  const done = () => {
    el.remove();
    root.removeAttribute('data-launch');
  };
  if (!root.hasAttribute('data-launch') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  el.classList.add('out');
  setTimeout(done, 450);
}

export function App() {
  const route = useRoute();
  const tab = route === 'ride' ? 'speed' : route;
  const haptics = useSettings((s) => s.haptics);
  useApplyTheme();
  useEffect(() => setHaptics(haptics), [haptics]);
  useEffect(() => {
    // 讓開場畫面停一下（品牌），內容畫好再淡出
    const timer = setTimeout(hideLaunchScreen, 350);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh bg-bg font-sans text-ink antialiased lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <Sidebar active={tab} />
      <main className="mx-auto w-full max-w-xl px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:max-w-2xl lg:max-w-6xl lg:px-10 lg:pt-10 lg:pb-14">
        <Banners />
        <div key={tab} className="page-enter">
          {tab === 'speed' && <SpeedPage />}
          {tab === 'trips' && <TripsPage />}
          {tab === 'calibrate' && <CalibratePage />}
          {tab === 'data' && <DataPage />}
          {tab === 'settings' && <SettingsPage />}
        </div>
      </main>
      <MobileTabBar active={tab} />
      <Toaster />
      <ConnectionSheet />
      <InstallPrompt />
      {route === 'ride' && <RideMode />}
    </div>
  );
}
