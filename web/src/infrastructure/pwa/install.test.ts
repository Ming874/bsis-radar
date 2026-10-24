// 安裝成 App 的提醒：從 userAgent 認出瀏覽器或 App、什麼時候提醒、改用 Chrome／外部瀏覽器打開的網址
import { describe, expect, it } from 'vitest';
import { CLAIMED_QUIET_MS, chromeIntentUrl, externalBrowserUrl, installEnv, shouldPrompt, type PromptInput } from './install';

const UA = {
  ios26Safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ios17Safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iPadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iosLine: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.9.0',
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5)',
  iosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
  androidLine: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.0.0 Mobile Safari/537.36 Line/14.12.0/IAB',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/475.0.0.0;]',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  macSafari18: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macSafari16: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};

describe('installEnv', () => {
  it('iPhone Safari：iOS 26 起看 Safari 的版本', () => {
    expect(installEnv(UA.ios26Safari)).toEqual({ kind: 'ios-safari', mobile: true, ios: true, safari: 26, android: null });
    expect(installEnv(UA.ios17Safari)).toMatchObject({ kind: 'ios-safari', safari: 17 });
  });

  it('iPad 的 Safari 假裝是 Mac：有觸控才算 iPad', () => {
    expect(installEnv(UA.iPadSafari, { touchMac: true })).toMatchObject({ kind: 'ios-safari', mobile: true, ios: true });
    expect(installEnv(UA.iPadSafari)).toMatchObject({ kind: 'mac-safari', mobile: false, safari: 18 });
  });

  it('iPhone 上有藍牙的瀏覽器（Bluefy）另外分一類', () => {
    expect(installEnv(UA.iosWebView, { bluetooth: true }).kind).toBe('ios-bluetooth');
    expect(installEnv(UA.iosChrome)).toMatchObject({ kind: 'ios-browser', mobile: true });
  });

  it('LINE 與其他 App 內建的瀏覽器', () => {
    expect(installEnv(UA.iosLine).kind).toBe('line');
    expect(installEnv(UA.androidLine).kind).toBe('line');
    expect(installEnv(UA.iosInstagram)).toMatchObject({ kind: 'in-app', ios: true });
    expect(installEnv(UA.iosWebView)).toMatchObject({ kind: 'in-app', ios: true });
    expect(installEnv(UA.androidFacebook)).toMatchObject({ kind: 'in-app', ios: false });
  });

  it('Android 的瀏覽器（平板也算行動裝置）', () => {
    expect(installEnv(UA.androidChrome)).toEqual({ kind: 'android', mobile: true, ios: false, safari: null, android: 'chrome' });
    expect(installEnv(UA.androidTablet)).toMatchObject({ kind: 'android', android: 'chrome' });
    expect(installEnv(UA.samsung)).toMatchObject({ kind: 'android', android: 'samsung' });
    expect(installEnv(UA.androidFirefox)).toMatchObject({ kind: 'android', android: 'firefox' });
  });

  it('電腦：Mac 的 Safari 和 Chrome 分得開', () => {
    expect(installEnv(UA.windowsChrome)).toMatchObject({ kind: 'desktop', mobile: false });
    expect(installEnv(UA.macChrome).kind).toBe('desktop');
    expect(installEnv(UA.macSafari18)).toMatchObject({ kind: 'mac-safari', safari: 18 });
    expect(installEnv(UA.windowsChrome, { uaMobile: true }).mobile).toBe(true);
  });
});

describe('shouldPrompt', () => {
  const now = 1_800_000_000_000;
  const base = (ua: string, over: Partial<PromptInput> = {}, bluetooth = false): PromptInput => ({
    env: installEnv(ua, { bluetooth }),
    standalone: false,
    installed: false,
    canInstall: false,
    dismissedThisSession: false,
    claimedAt: null,
    now,
    ...over,
  });

  it('用手機的瀏覽器打開：一律提醒，不用等瀏覽器給安裝事件', () => {
    for (const ua of [UA.ios26Safari, UA.iosChrome, UA.androidChrome, UA.samsung, UA.androidFirefox, UA.iosLine, UA.androidFacebook]) {
      expect(shouldPrompt(base(ua))).toBe(true);
    }
  });

  it('已經是 App、知道裝過、這次已經關掉：不提醒', () => {
    expect(shouldPrompt(base(UA.androidChrome, { standalone: true }))).toBe(false);
    expect(shouldPrompt(base(UA.androidChrome, { installed: true }))).toBe(false);
    expect(shouldPrompt(base(UA.androidChrome, { dismissedThisSession: true }))).toBe(false);
  });

  it('按了「已經安裝了」30 天不提醒；時間跑到未來的紀錄不算', () => {
    expect(shouldPrompt(base(UA.ios26Safari, { claimedAt: now - CLAIMED_QUIET_MS + 60_000 }))).toBe(false);
    expect(shouldPrompt(base(UA.ios26Safari, { claimedAt: now - CLAIMED_QUIET_MS }))).toBe(true);
    expect(shouldPrompt(base(UA.ios26Safari, { claimedAt: now + 60_000 }))).toBe(true);
  });

  it('Bluefy 不提醒：加到主畫面的 App 不能用藍牙', () => {
    expect(shouldPrompt(base(UA.iosWebView, {}, true))).toBe(false);
  });

  it('電腦：能安裝的瀏覽器才提醒', () => {
    expect(shouldPrompt(base(UA.windowsChrome, { canInstall: true }))).toBe(true);
    expect(shouldPrompt(base(UA.windowsChrome))).toBe(false);
    expect(shouldPrompt(base(UA.windowsFirefox))).toBe(false);
    expect(shouldPrompt(base(UA.macSafari18))).toBe(true);
    expect(shouldPrompt(base(UA.macSafari16))).toBe(false);
  });
});

describe('改用其他瀏覽器打開', () => {
  it('Chrome intent：同一頁、同樣的參數，沒有 Chrome 就回到原本的網址', () => {
    const href = 'https://bsis.mingchen.dev/?demo#/trips';
    expect(chromeIntentUrl(href)).toBe(
      `intent://bsis.mingchen.dev/?demo#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`,
    );
  });

  it('LINE：加上 openExternalBrowser=1', () => {
    expect(externalBrowserUrl('https://bsis.mingchen.dev/#/speed')).toBe('https://bsis.mingchen.dev/?openExternalBrowser=1#/speed');
  });
});
