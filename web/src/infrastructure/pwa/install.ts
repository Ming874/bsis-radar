/**
 * 【基礎設施層】「安裝成 App」要怎麼教、什麼時候提醒（InstallPrompt 用）。只看傳進來的 userAgent 與時間，方便測試。
 *
 * - 看得出來的：手機或電腦、是不是已經用主畫面的 App 打開（display-mode: standalone）、在哪個瀏覽器或 App 裡、
 *   瀏覽器能不能用藍牙
 * - 看不出來的：瀏覽器分頁沒辦法知道這台已經裝過。Android 的 Chrome 可以問 getInstalledRelatedApps，
 *   主畫面的 App 和 Chrome 也共用 localStorage（打開過 App 就記一筆）；iPhone 的主畫面 App 和 Safari 資料分開，
 *   只能讓使用者按「已經安裝了」
 * - iPhone：Safari 與主畫面 App 都不支援 Web Bluetooth（iOS 限制），連線要用 Bluefy。
 *   在 Bluefy 這類有藍牙的 iOS 瀏覽器裡不提醒：加到主畫面的 App 用的是 Safari 的引擎，反而不能連線
 */

export type InstallKind =
  | 'ios-safari' // iPhone／iPad 的 Safari：分享 → 加入主畫面
  | 'ios-browser' // iPhone 上的 Chrome、Edge、Firefox（iOS 16.4 起一樣能加入主畫面）
  | 'ios-bluetooth' // Bluefy 等有 Web Bluetooth 的 iOS 瀏覽器：不提醒（加到主畫面就不能連線）
  | 'android' // Android 的瀏覽器：有 beforeinstallprompt 就一鍵安裝，沒有就教選單
  | 'line' // LINE 裡面：請 LINE 改用瀏覽器打開
  | 'in-app' // Facebook、Instagram 等 App 內建的瀏覽器：裝不了，請改用瀏覽器
  | 'mac-safari' // macOS 的 Safari 17 以上：檔案 → 加入 Dock
  | 'desktop'; // 電腦的 Chrome、Edge：瀏覽器給安裝事件才能一鍵安裝

export type AndroidBrowser = 'chrome' | 'samsung' | 'firefox' | 'other';

export interface InstallEnv {
  kind: InstallKind;
  /** 手機或平板 */
  mobile: boolean;
  /** iPhone／iPad（App 內建瀏覽器也算） */
  ios: boolean;
  /** Safari 的版本（Version/26.0 → 26）：iOS 26 起 userAgent 裡的系統版本固定不動，只能看這個 */
  safari: number | null;
  android: AndroidBrowser | null;
}

/** 已知的 App 內建瀏覽器（LINE 另外處理） */
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|MicroMessenger|Barcelona|musical_ly|BytedanceWebview|KAKAOTALK|Snapchat|GSA\//;

export interface EnvHints {
  /** iPadOS 的 Safari 假裝自己是 Mac：platform 是 MacIntel 又有觸控就是 iPad */
  touchMac?: boolean;
  /** Chromium 的 navigator.userAgentData.mobile */
  uaMobile?: boolean;
  /** 瀏覽器有 navigator.bluetooth */
  bluetooth?: boolean;
}

export function installEnv(ua: string, { touchMac = false, uaMobile = false, bluetooth = false }: EnvHints = {}): InstallEnv {
  const ios = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const androidOs = /Android/i.test(ua);
  const mobile = ios || androidOs || uaMobile || /Mobi/i.test(ua);
  const version = /Version\/(\d+)/.exec(ua);
  const safari = version ? Number(version[1]) : null;
  const env: InstallEnv = { kind: 'desktop', mobile, ios, safari: null, android: null };

  if (/\bLine\//i.test(ua)) return { ...env, kind: 'line' };
  if (IN_APP.test(ua)) return { ...env, kind: mobile ? 'in-app' : 'desktop' };
  if (ios) {
    if (bluetooth) return { ...env, kind: 'ios-bluetooth' };
    if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return { ...env, kind: 'ios-browser' };
    // App 內建的 WKWebView 沒有 Safari/ 這一段
    if (!/Safari\//.test(ua)) return { ...env, kind: 'in-app' };
    return { ...env, kind: 'ios-safari', safari };
  }
  if (!mobile) {
    // macOS 的 Safari（Chrome、Edge 的 userAgent 也有 Safari/，要排除）
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)) return { ...env, kind: 'mac-safari', safari };
    return env;
  }
  // Android 的 WebView（App 內建瀏覽器）userAgent 裡有「; wv)」
  if (/;\s*wv\)/.test(ua)) return { ...env, kind: 'in-app' };
  const android: AndroidBrowser = /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'firefox' : /Chrome\//.test(ua) && !/OPR\/|YaBrowser/.test(ua) ? 'chrome' : 'other';
  return { ...env, kind: 'android', android };
}

/** 按了「已經安裝了」：30 天內不再提醒（iPhone 看不出來裝過沒有） */
export const CLAIMED_QUIET_MS = 30 * 86_400_000;

export interface PromptInput {
  env: InstallEnv;
  /** 已經是主畫面的 App */
  standalone: boolean;
  /** 知道這台已經裝過（getInstalledRelatedApps，或主畫面的 App 在共用的 localStorage 記過） */
  installed: boolean;
  /** 瀏覽器給了 beforeinstallprompt，可以一鍵安裝 */
  canInstall: boolean;
  /** 這次打開網頁已經按過「之後再說」 */
  dismissedThisSession: boolean;
  claimedAt: number | null;
  now: number;
}

/**
 * 要不要提醒：用瀏覽器打開就提醒（每次打開一次，按「之後再說」後這次不再出現）。
 * - 不提醒：已經是 App、知道裝過了、30 天內按過「已經安裝了」、Bluefy 這類 iOS 藍牙瀏覽器
 * - 電腦：只有能安裝的瀏覽器才提醒（Chrome、Edge 給了安裝事件；macOS Safari 17 以上可以加入 Dock）
 */
export function shouldPrompt(p: PromptInput): boolean {
  if (p.standalone || p.installed || p.dismissedThisSession) return false;
  if (p.claimedAt !== null && p.now - p.claimedAt >= 0 && p.now - p.claimedAt < CLAIMED_QUIET_MS) return false;
  switch (p.env.kind) {
    case 'ios-bluetooth':
      return false;
    case 'desktop':
      return p.canInstall;
    case 'mac-safari':
      return (p.env.safari ?? 0) >= 17;
    default:
      return true;
  }
}

/** Android 的 App 內建瀏覽器：用 intent 請 Chrome 打開這一頁（沒有 Chrome 就留在原地；intent 網址不能帶 #，分頁回到速度頁） */
export function chromeIntentUrl(href: string): string {
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

/** 在 LINE 裡打開時，加上參數讓 LINE 改用手機的瀏覽器開 */
export function externalBrowserUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}
