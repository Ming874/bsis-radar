/**
 * 【設計系統】對話框：電腦上置中、手機上從底部出現。只用在需要確認的動作，其他編輯都直接在面板裡進行。
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import { XIcon } from './icons';

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden className="absolute inset-0 bg-black/60" onClick={onClose} />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-lg border border-line bg-panel outline-none sm:rounded-lg"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-4">
          <h2 id={titleId} className="text-heading font-semibold text-fg">
            {title}
          </h2>
          <IconButton icon={XIcon} label="關閉" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-body text-muted">{children}</div>
        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** 確認動作（取代瀏覽器內建的 confirm 視窗） */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}
