import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startServices } from './application/container';
import './index.css';
import { App } from './ui/App';

startServices();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 正式版才註冊 Service Worker（離線也能開啟、可加入主畫面）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
