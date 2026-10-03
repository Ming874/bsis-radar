/**
 * 【設計系統】畫面上方的提示訊息（連線、設定套用、錯誤…），幾秒後自動消失。
 */
import type { ComponentType } from 'react';
import { toastStore, useToasts } from '../../application/container';
import type { ToastTone } from '../../application/toastStore';
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon } from './icons';

const TONES: Record<ToastTone, { Icon: ComponentType<{ className?: string }>; color: string }> = {
  success: { Icon: CheckCircleIcon, color: 'text-safe' },
  info: { Icon: InfoIcon, color: 'text-accent-ink' },
  warning: { Icon: AlertIcon, color: 'text-caution' },
  error: { Icon: AlertIcon, color: 'text-danger' },
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-40 flex flex-col items-center gap-2 px-4 lg:items-end lg:px-6">
      {toasts.map((t) => {
        const { Icon, color } = TONES[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-card border border-line bg-surface/95 px-4 py-3 shadow-xl shadow-slate-950/15 backdrop-blur-xl"
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} />
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-callout leading-relaxed text-ink-2">{t.detail}</p>}
            </div>
            <button
              type="button"
              aria-label="關閉提示"
              onClick={() => toastStore.getState().dismiss(t.id)}
              className="-mr-1 rounded-full p-1 text-ink-3 hover:text-ink"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
