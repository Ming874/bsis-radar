import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startServices } from './application/container';
import './index.css';
import { startPwa } from './infrastructure/pwa/pwa';
import { App } from './ui/App';

// 先收起安裝事件（可能在畫面出來之前就到）、註冊 Service Worker
startPwa();
startServices();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
