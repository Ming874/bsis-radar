/**
 * 【設計系統】提示訊息（連線、設定套用、錯誤…），幾秒後自動消失。手機在上方、電腦在右下角。
 */
import { toastStore, useToasts } from '../../application/container';
import type { ToastTone } from '../../application/toastStore';
import { IconButton } from './Button';
import { XIcon } from './icons';

const BAR: Record<ToastTone, string> = {
  success: 'bg-ok',
  info: 'bg-accent',
  warning: 'bg-warn',
  error: 'bg-bad',
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 flex flex-col items-center gap-2 px-4 lg:top-auto lg:right-6 lg:bottom-6 lg:left-auto lg:items-end lg:px-0"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex w-full max-w-sm items-stretch overflow-hidden rounded-lg border border-line-strong bg-panel"
        >
          <span aria-hidden className={`w-1 shrink-0 ${BAR[t.tone]}`} />
          <div className="min-w-0 flex-1 py-2.5 pl-3">
            <p className="text-body font-medium text-fg">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-label text-muted">{t.detail}</p>}
          </div>
          <div className="p-1.5">
            <IconButton icon={XIcon} label="關閉提示" onClick={() => toastStore.getState().dismiss(t.id)} />
          </div>
        </div>
      ))}
    </div>
  );
}
