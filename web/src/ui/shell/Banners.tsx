/**
 * 【UI 層】頁面最上方的橫幅：示範模式、有新版本。
 */
import { isDemo, isScreenshot, usePwa, useRadar } from '../../application/container';
import { Button, InfoIcon, RefreshIcon } from '../kit';

export function Banners() {
  const update = usePwa((p) => p.update);
  const connected = useRadar((r) => r.connection.status === 'connected');
  const showUpdate = update !== null && !isScreenshot;
  if (!isDemo && !showUpdate) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 lg:mb-5">
      {isDemo && !isScreenshot && (
        <div className="flex items-center gap-3 rounded-2xl bg-tint-soft px-4 py-2.5">
          <InfoIcon className="h-5 w-5 shrink-0 text-tint" />
          <p className="min-w-0 flex-1 text-footnote text-ink">示範模式：模擬一段城市騎乘，不需要硬體；行程不會存進紀錄</p>
          <a href="/" className="shrink-0 text-footnote font-semibold text-tint">
            離開
          </a>
        </div>
      )}
      {showUpdate && (
        <div className="card flex items-center gap-3 px-4 py-2.5">
          <RefreshIcon className="h-5 w-5 shrink-0 text-tint" />
          <p className="min-w-0 flex-1 text-footnote text-ink">
            有新版本 v{update.version}
            <span className="block text-muted">{connected ? '重新載入會中斷藍牙，停車時再更新' : '重新載入就會更新'}</span>
          </p>
          <Button size="sm" variant="tinted" onClick={() => window.location.reload()}>
            重新載入
          </Button>
        </div>
      )}
    </div>
  );
}
