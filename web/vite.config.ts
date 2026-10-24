import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// 這一次建置的代號：網頁定期比對 /version.json，不一樣就提示「有新版本」
const buildId = `${pkg.version}-${Date.now().toString(36)}`;

// public/ 底下也要離線可用的檔案（不在打包結果裡，另外列）
const PUBLIC_PRECACHE = ['manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

/**
 * 離線用的清單與版本：
 * - precache.json：Service Worker（public/sw.js）照它把這一版的網頁、打包的程式與圖示全部存好，沒網路也打得開
 * - version.json：網頁比對用（infrastructure/pwa/pwa.ts 的 checkForUpdate）
 */
function pwaManifest(): Plugin {
  return {
    name: 'bsis-pwa-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ buildId, files: [...files, ...PUBLIC_PRECACHE].sort() }) });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, buildId }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaManifest()],
  // 網頁版本號只在 package.json 維護一份
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
