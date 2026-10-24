// Service Worker：讓網頁離線也能開啟（連 ESP32 只需要藍牙，騎車的地方常常沒有網路）。
//
// - 網頁本體（index.html、打包的程式與樣式、圖示、manifest）：照 /precache.json 把這一版的檔案全部存好（syncShell）。
//   安裝時存一次；之後每次有網路打開網頁都看伺服器是不是新版（sw.js 沒改就不會重新安裝，不能只靠安裝）。
//   沒變的打包檔（檔名帶雜湊）從舊版複製，只下載新的；全部存好才換過去、刪掉舊版，
//   存到一半（網路不穩、部署到一半）就繼續用舊版，離線時永遠是完整、前後一致的一版
// - 換頁（navigate）：先問網路，有網路就是最新版；沒網路或 3 秒沒回應才用存好的 index.html
// - /assets/ 的檔名帶雜湊、內容不會變：先用存的，沒有才抓
// - version.json、precache.json 不經過快取（比對版本用）
// 開發模式（vite dev）不註冊這個檔（src/infrastructure/pwa/pwa.ts）。

const SHELL = 'bsis-shell-';
const META = 'bsis-meta';
const NO_CACHE = ['/version.json', '/precache.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await syncShell().catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 2.x 的快取名稱（bsis-speed-v1）
      for (const name of await caches.keys()) if (!name.startsWith(SHELL) && name !== META) await caches.delete(name);
      await dropOldShells();
      await self.clients.claim();
    })(),
  );
});

let syncing = null;

function syncShell() {
  syncing ??= (async () => {
    const res = await fetch('/precache.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { buildId, files } = await res.json();
    const name = SHELL + buildId;
    if ((await currentShell()) === name) return;
    const cache = await caches.open(name);
    const save = async (file) => {
      const key = `/${file}`;
      if (await cache.match(key)) return true;
      // 帶雜湊的打包檔沒變就直接拿舊的；其他檔案每版都可能不同
      const old = file.startsWith('assets/') ? await caches.match(key) : undefined;
      if (old) {
        await cache.put(key, old);
        return true;
      }
      try {
        await cache.add(new Request(key, { cache: 'reload' }));
        return true;
      } catch {
        return false;
      }
    };
    let missing = files;
    for (let round = 0; round < 2 && missing.length; round++) {
      const ok = await Promise.all(missing.map(save));
      missing = missing.filter((_, i) => !ok[i]);
    }
    if (missing.length) return;
    await (await caches.open(META)).put('/__shell', new Response(name));
    await dropOldShells(name);
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** 只留 keep 這一版（沒指定就是現在用的那一版；還沒有完整的一版時什麼都不刪） */
async function dropOldShells(keep) {
  const current = keep ?? (await currentShell());
  if (!current) return;
  for (const name of await caches.keys()) if (name.startsWith(SHELL) && name !== current) await caches.delete(name);
}

async function currentShell() {
  const meta = await caches.open(META);
  const hit = await meta.match('/__shell');
  return hit ? hit.text() : null;
}

async function fromShell(request) {
  const name = await currentShell();
  if (!name) return undefined;
  const cache = await caches.open(name);
  return cache.match(request, { ignoreSearch: true });
}

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

async function navigate(event, request) {
  const network = fetch(request).catch(() => null);
  const first = await Promise.race([network, wait(3000)]);
  if (first) {
    // 有網路：順便看伺服器是不是換新版了，是的話在背景把新版存起來
    if (first.ok) event.waitUntil(syncShell().catch(() => {}));
    return first;
  }
  const cached = (await fromShell('/index.html')) || (await caches.match('/index.html'));
  if (cached) return cached;
  // 沒存過（第一次打開就沒網路）：只能等網路
  return (await network) || new Response('目前沒有網路，而且這台裝置還沒有存過網頁。', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function asset(request) {
  // 現在這一版沒有（換版存到一半）就找其他版本存的同一個檔（檔名帶雜湊，同名就是同一個檔）
  const cached = (await fromShell(request)) || (await caches.match(request));
  if (cached) return cached;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NO_CACHE.includes(url.pathname)) return;
  if (request.mode === 'navigate') return event.respondWith(navigate(event, request));
  if (url.pathname.startsWith('/assets/')) return event.respondWith(asset(request));
  // 其他同網域的檔案（圖示、manifest）：先問網路，沒網路用存的
  event.respondWith(fetch(request).catch(async () => (await fromShell(request)) || (await caches.match(request)) || Response.error()));
});
