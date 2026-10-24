/**
 * 【設計系統】提示訊息（連線、設定套用、錯誤…），幾秒後自動消失。手機在上方、電腦在右下角。
 */
import { isScreenshot, toastStore, useToasts } from '../../application/container';
import type { ToastTone } from '../../application/toastStore';
import { IconButton } from './Button';
import { cx } from './base';
import { AlertIcon, CheckCircleIcon, InfoIcon, XIcon, type IconProps } from './icons';
import type { ComponentType } from 'react';

const ICON: Record<ToastTone, { Icon: ComponentType<IconProps>; color: string }> = {
  success: { Icon: CheckCircleIcon, color: 'text-ok' },
  info: { Icon: InfoIcon, color: 'text-tint' },
  warning: { Icon: AlertIcon, color: 'text-warn' },
  error: { Icon: AlertIcon, color: 'text-bad' },
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  if (isScreenshot) return null; // 文件截圖不要被提示蓋住
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-3 lg:top-auto lg:right-6 lg:bottom-6 lg:left-auto lg:items-end lg:px-0"
    >
      {toasts.map((t) => {
        const { Icon, color } = ICON[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="chrome toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl py-3 pr-2 pl-4"
          >
            <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', color)} />
            <div className="min-w-0 flex-1">
              <p className="text-subhead font-semibold text-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-footnote text-muted">{t.detail}</p>}
            </div>
            <IconButton icon={XIcon} label="關閉提示" size="sm" onClick={() => toastStore.getState().dismiss(t.id)} />
          </div>
        );
      })}
    </div>
  );
}
