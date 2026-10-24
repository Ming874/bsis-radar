// 文件（docs/images）與 manifest（public/screenshots）的截圖。
// 用 Chrome DevTools Protocol 模擬手機（390 × 844、2 倍）與電腦（1440 × 900），開示範模式（?demo&screenshot），
// 等模擬騎乘跑到指定秒數再截圖。headless Chrome 的視窗最窄約 500 px，所以不用 --window-size，改用裝置模擬。
//
//   npm run dev -- --port 5180          （另一個終端機）
//   node scripts/screenshots.mjs [檔名的一部分]
//
// 環境變數：CHROME（Chrome 的路徑）、BASE（網址，預設 http://127.0.0.1:5180）。需要 Node 22（內建 WebSocket）。
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5180';
const WEB = fileURLToPath(new URL('..', import.meta.url));
const IMG = join(WEB, '../docs/images');
const PUB = join(WEB, 'public/screenshots');
const PORT = 9333;
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };

const SHOTS = [
  { out: `${IMG}/phone-speed.png`, path: '?demo&screenshot#/speed', device: PHONE, waitS: 20, dark: true },
  { out: `${IMG}/phone-speed-light.png`, path: '?demo&screenshot#/speed', device: PHONE, waitS: 20, dark: false },
  { out: `${IMG}/phone-speed-alert.png`, path: '?demo&screenshot#/speed', device: PHONE, waitS: 75, dark: true },
  { out: `${IMG}/phone-trips.png`, path: '?demo&screenshot#/trips', device: PHONE, waitS: 30, dark: false },
  { out: `${IMG}/phone-trip-detail.png`, path: '?demo&screenshot#/trips', device: PHONE, waitS: 6, dark: false, click: true },
  { out: `${IMG}/phone-calibrate.png`, path: '?demo&screenshot#/calibrate', device: PHONE, waitS: 6, dark: true },
  { out: `${IMG}/phone-ride.png`, path: '?demo&screenshot#/ride', device: PHONE, waitS: 30, dark: true },
  { out: `${IMG}/phone-ride-alert.png`, path: '?demo&screenshot#/ride', device: PHONE, waitS: 75, dark: true },
  { out: `${IMG}/phone-install.png`, path: '?demo&screenshot&install#/speed', device: PHONE, waitS: 6, dark: false, ua: ANDROID_UA },
  { out: `${IMG}/phone-settings.png`, path: '?demo&screenshot#/settings', device: PHONE, waitS: 5, dark: false },
  { out: `${IMG}/desktop-speed.png`, path: '?demo&screenshot#/speed', device: DESKTOP, waitS: 30, dark: true },
  { out: `${IMG}/desktop-trips.png`, path: '?demo&screenshot#/trips', device: DESKTOP, waitS: 30, dark: false },
  { out: `${IMG}/desktop-data.png`, path: '?demo&screenshot#/data', device: DESKTOP, waitS: 30, dark: true },
  { out: `${PUB}/phone-speed.png`, path: '?demo&screenshot#/speed', device: PHONE, waitS: 20, dark: false },
  { out: `${PUB}/phone-trips.png`, path: '?demo&screenshot#/trips', device: PHONE, waitS: 30, dark: false },
  { out: `${PUB}/phone-calibrate.png`, path: '?demo&screenshot#/calibrate', device: PHONE, waitS: 6, dark: false },
  { out: `${PUB}/desktop-speed.png`, path: '?demo&screenshot#/speed', device: DESKTOP, waitS: 30, dark: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(PUB, { recursive: true });
  const profile = join(tmpdir(), `bsis-screenshots-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let version;
    for (let i = 0; i < 50 && !version; i++) {
      await sleep(200);
      version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => undefined);
    }
    if (!version) throw new Error('Chrome 沒有啟動');
    const only = process.argv[2];
    await Promise.all(SHOTS.filter((s) => !only || s.out.includes(only)).map((s, i) => sleep(i * 300).then(() => shoot(s))));
  } finally {
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function shoot(shot) {
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send('Emulation.setDeviceMetricsOverride', shot.device);
  if (shot.device.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.dark ? 'dark' : 'light' }] });
  if (shot.ua) await send('Emulation.setUserAgentOverride', { userAgent: shot.ua });
  await send('Page.enable');
  await send('Page.navigate', { url: `${BASE}/${shot.path}` });
  await sleep(shot.waitS * 1000);
  if (shot.click) {
    await send('Runtime.evaluate', {
      expression: `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('–') && b.textContent.includes('km'))?.click()`,
    });
    await sleep(1200);
  }
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot.out, Buffer.from(result.data, 'base64'));
  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => undefined);
  console.log('saved', shot.out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
