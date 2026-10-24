/**
 * 【UI 層】安裝成 App 的提醒（規則與判斷在 infrastructure/pwa/install.ts）：
 * - 用瀏覽器打開就跳出來（每次打開一次）；按「之後再說」這次不再出現，按「已經安裝了」30 天不提醒
 * - Android 的 Chrome、電腦的 Chrome／Edge 一鍵安裝；其他瀏覽器照步驟教（iPhone 分享 → 加入主畫面）
 * - LINE、Facebook 這類 App 裡面裝不了：改用瀏覽器打開
 * - 有面板開著、正在打字、騎乘模式、或正在騎（速度 > 1 m/s）時先等一下
 * 設定頁的「安裝成 App」也會打開這個面板（uiStore.sheet = 'install'）。
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { isScreenshot, openSheet, radarStore, toastStore, uiStore, usePwa, useUi } from '../../application/container';
import { promptInstall, readStoredTime, writeStoredTime } from '../../infrastructure/pwa/pwa';
import { chromeIntentUrl, externalBrowserUrl, installEnv, shouldPrompt, type InstallEnv } from '../../infrastructure/pwa/install';
import {
  Button,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  EllipsisVerticalIcon,
  ExternalIcon,
  LogoMark,
  MenuIcon,
  Notice,
  ShareIcon,
  Sheet,
  SquarePlusIcon,
  ToggleRightIcon,
  type IconProps,
} from '../kit';

const CLAIM_KEY = 'bsis.install.claimed';
const DISMISS_KEY = 'bsis.install.dismissed';
const SHOW_DELAY_MS = 2500;
const RETRY_MS = 2500;

function detect(): InstallEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return installEnv(navigator.userAgent, {
    touchMac: navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1,
    uaMobile: nav.userAgentData?.mobile === true,
    bluetooth: 'bluetooth' in navigator,
  });
}

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** 先不要跳出來：有面板開著、正在打字、騎乘模式、正在騎 */
function busy(): boolean {
  if (document.querySelector('[role="dialog"]') || uiStore.getState().ride || uiStore.getState().sheet) return true;
  const speed = radarStore.getState().telemetry?.speedMps ?? 0;
  if (radarStore.getState().connection.status === 'connected' && speed > 1) return true;
  return document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select, [contenteditable="true"]');
}

interface Step {
  Icon: ComponentType<IconProps>;
  text: string;
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-2 text-left">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-footnote font-bold text-muted">{i + 1}</span>
          <span className="min-w-0 flex-1 text-subhead font-medium text-ink">{s.text}</span>
          <s.Icon className="h-5 w-5 shrink-0 text-tint" />
        </li>
      ))}
    </ol>
  );
}

function stepsFor(env: InstallEnv, canInstall: boolean): Step[] {
  switch (env.kind) {
    case 'ios-safari':
      return (env.safari ?? 0) >= 26
        ? [
            { Icon: EllipsisIcon, text: '點網址列旁的「⋯」，再點「分享」' },
            { Icon: SquarePlusIcon, text: '往下滑，選「加入主畫面」' },
            { Icon: ToggleRightIcon, text: '「以網頁 App 開啟」保持打開，按「加入」' },
          ]
        : [
            { Icon: ShareIcon, text: '點 Safari 下方的「分享」' },
            { Icon: SquarePlusIcon, text: '往下滑，選「加入主畫面」，按「加入」' },
          ];
    case 'ios-browser':
      return [
        { Icon: ShareIcon, text: '點瀏覽器的「分享」（Chrome 在網址列右邊）' },
        { Icon: SquarePlusIcon, text: '選「加入主畫面」' },
      ];
    case 'android':
      if (canInstall) return [];
      return env.android === 'samsung'
        ? [
            { Icon: MenuIcon, text: '點下方的「≡」' },
            { Icon: SquarePlusIcon, text: '選「新增頁面至」→「主螢幕」' },
          ]
        : [
            { Icon: EllipsisVerticalIcon, text: '點右上角的「⋮」' },
            { Icon: SquarePlusIcon, text: '選「安裝應用程式」或「加到主畫面」' },
          ];
    case 'in-app':
      return env.ios ? [{ Icon: EllipsisIcon, text: '點右上角的「⋯」，選「用瀏覽器開啟」' }] : [];
    case 'mac-safari':
      return [
        { Icon: MenuIcon, text: '點選單列的「檔案」' },
        { Icon: SquarePlusIcon, text: '選「加入 Dock」，按「加入」' },
      ];
    case 'desktop':
      return canInstall ? [] : [{ Icon: DownloadIcon, text: 'Chrome、Edge：點網址列右邊的「安裝」圖示' }];
    default:
      return [];
  }
}

function Benefit({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-tint" strokeWidth={2.4} />
      <span>{children}</span>
    </li>
  );
}

export function InstallPrompt() {
  const [env] = useState(detect);
  const { standalone, canInstall, installed } = usePwa((p) => p);
  // 文件截圖（?screenshot&install）直接打開
  const manual = useUi((u) => u.sheet === 'install') || (isScreenshot && new URLSearchParams(window.location.search).has('install'));
  const [auto, setAuto] = useState(false);
  const [claimedAt, setClaimedAt] = useState(() => readStoredTime(CLAIM_KEY));
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  const wanted = !isScreenshot && shouldPrompt({ env, standalone, installed, canInstall, dismissedThisSession: dismissed, claimedAt, now: Date.now() });

  // 停一下再跳出來；有面板開著、正在打字、正在騎就等空出來
  useEffect(() => {
    if (!wanted || auto) return;
    let timer = window.setTimeout(function tryOpen() {
      if (!busy()) setAuto(true);
      else timer = window.setTimeout(tryOpen, RETRY_MS);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [wanted, auto]);

  const open = manual || (auto && wanted);
  const close = () => {
    setAuto(false);
    if (manual) openSheet(null);
  };
  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 存不了：這次開著的期間照樣不再出現（state）
    }
    setDismissed(true);
    close();
  };
  const claim = () => {
    const now = Date.now();
    writeStoredTime(CLAIM_KEY, now);
    setClaimedAt(now);
    close();
  };
  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      close();
      toastStore.getState().push('success', '已安裝 BSIS 測速', '之後從主畫面或應用程式清單打開');
    } else if (outcome === 'dismissed') dismiss();
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toastStore.getState().push('success', '已複製網址', '貼到 Chrome 或 Safari 打開');
    } catch {
      toastStore.getState().push('error', '複製失敗', '請長按網址列手動複製');
    }
  };

  const { kind } = env;
  const steps = stepsFor(env, canInstall);
  const oneTap = canInstall && (kind === 'android' || kind === 'desktop');

  let body: ReactNode = '從主畫面一鍵打開，全螢幕顯示，像一般的 App 一樣。';
  if (kind === 'line') body = '在 LINE 裡面沒辦法安裝，也不能使用藍牙。改用手機的瀏覽器打開就能安裝。';
  else if (kind === 'in-app') body = '在這個 App 裡面沒辦法安裝，也不能使用藍牙。改用手機的瀏覽器打開就能安裝。';
  else if (kind === 'ios-bluetooth') body = '在 Bluefy 裡直接使用就好：加到主畫面的 App 會改用 Safari 的引擎，不能連線藍牙。';

  let primary: ReactNode = null;
  if (kind === 'line') {
    primary = (
      <Button variant="primary" size="lg" block icon={ExternalIcon} onClick={() => window.location.assign(externalBrowserUrl(window.location.href))}>
        用瀏覽器打開
      </Button>
    );
  } else if (kind === 'in-app' && !env.ios) {
    primary = (
      <Button variant="primary" size="lg" block icon={ExternalIcon} onClick={() => window.location.assign(chromeIntentUrl(window.location.href))}>
        用 Chrome 打開
      </Button>
    );
  } else if (oneTap) {
    primary = (
      <Button variant="primary" size="lg" block icon={DownloadIcon} onClick={() => void install()}>
        安裝
      </Button>
    );
  }

  return (
    <Sheet open={open} onClose={manual ? close : dismiss}>
      <div className="flex flex-col items-center gap-4 pt-3 pb-1 text-center sm:pt-6">
        <LogoMark className="h-[68px] w-[68px] text-tint-solid" />
        <div>
          <h2 className="text-title font-bold tracking-tight text-ink">{standalone ? '已經是 App 了' : '安裝 BSIS 測速 App'}</h2>
          <p className="mt-1 text-subhead text-muted">{standalone ? '現在就是從主畫面打開的 App；可以離線開啟，資料和網頁版相同。' : body}</p>
        </div>

        {!standalone && (kind === 'android' || kind === 'desktop' || kind === 'mac-safari' || kind === 'ios-safari' || kind === 'ios-browser') && (
          <ul className="flex w-full flex-col gap-1.5 rounded-2xl bg-surface-2 px-4 py-3 text-left text-footnote text-ink">
            <Benefit>全螢幕顯示，騎乘時不會被網址列擋住</Benefit>
            <Benefit>沒有網路也打得開（連線雷達只需要藍牙）</Benefit>
            {!env.ios && <Benefit>和瀏覽器共用資料：行程、設定、校正紀錄都在</Benefit>}
          </ul>
        )}

        {!standalone && steps.length > 0 && (
          <div className="w-full">
            <Steps steps={steps} />
          </div>
        )}

        {!standalone && (kind === 'ios-safari' || kind === 'ios-browser') && (
          <div className="w-full text-left">
            <Notice tone="warn" title="iPhone 不能用藍牙連線雷達" flat>
              Safari 與主畫面的 App 都不支援 Web Bluetooth（iOS 的限制）。要連線請安裝 Bluefy 瀏覽器開啟這個網址；主畫面的 App 可以看示範與行程紀錄。
            </Notice>
          </div>
        )}

        <div className="flex w-full flex-col gap-2">
          {!standalone && primary}
          {!standalone && kind === 'in-app' && (
            <Button size="lg" block icon={CopyIcon} variant={primary ? 'secondary' : 'primary'} onClick={() => void copyLink()}>
              複製網址
            </Button>
          )}
          {/* 照著步驟做完：按「完成」就當作裝好了，30 天不再提醒 */}
          {!standalone && steps.length > 0 && !primary && kind !== 'in-app' && (
            <Button variant="primary" size="lg" block onClick={claim}>
              完成
            </Button>
          )}
          {(standalone || kind === 'ios-bluetooth') && (
            <Button variant="primary" size="lg" block onClick={close}>
              知道了
            </Button>
          )}
          {!standalone && kind !== 'ios-bluetooth' && (
            <Button variant="secondary" size="lg" block onClick={manual ? close : dismiss}>
              之後再說
            </Button>
          )}
          {!standalone && kind !== 'ios-bluetooth' && !manual && (
            <button type="button" onClick={claim} className="mx-auto px-3 py-1.5 text-footnote font-semibold text-muted hover:text-ink">
              已經安裝了
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

