/**
 * 【設計系統】面板：手機上從底部滑出（單手好操作），電腦上是置中的對話框。說明、編輯參數、確認動作都用它。
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HelpText } from '../content/help';
import { Button, FOCUS_RING } from './Button';
import { InfoIcon, XIcon } from './icons';

export function Sheet({
  title,
  description,
  onClose,
  children,
  footer,
  tall = false,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** 內容很多（例如主控台）時撐到接近全螢幕 */
  tall?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" onClick={onClose} />
      <section
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex w-full max-w-lg flex-col rounded-t-panel bg-surface text-ink shadow-2xl outline-none sm:rounded-panel ${
          tall ? 'h-[88dvh]' : 'max-h-[88dvh]'
        }`}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line sm:hidden" />
        <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-3 pb-2">
          <div className="min-w-0">
            <h2 id={titleId} className="text-title font-bold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-callout text-ink-2">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="關閉"
            onClick={onClose}
            className={`-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2 hover:text-ink ${FOCUS_RING}`}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 gap-2 border-t border-line px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
        {!footer && <div className="h-[env(safe-area-inset-bottom)] shrink-0" />}
      </section>
    </div>,
    document.body,
  );
}

/** 說明段落（Sheet 裡的內文） */
export function HelpBody({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-3 text-body leading-relaxed text-ink-2">
      {paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </div>
  );
}

/** ⓘ 按鈕：點了打開說明面板 */
export function HelpButton({ help }: { help: HelpText }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        aria-label={`說明：${help.title}`}
        onClick={() => setOpen(true)}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition hover:bg-accent/10 hover:text-accent-ink ${FOCUS_RING}`}
      >
        <InfoIcon className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <Sheet
          title={help.title}
          description={help.short}
          onClose={close}
          footer={
            <Button variant="primary" block onClick={close}>
              我知道了
            </Button>
          }
        >
          <HelpBody paragraphs={help.body} />
        </Sheet>
      )}
    </>
  );
}

/** 確認動作（取代瀏覽器內建的 confirm 視窗，外觀一致） */
export function ConfirmSheet({
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button block onClick={onClose}>
            取消
          </Button>
          <Button
            block
            variant={destructive ? 'destructive' : 'primary'}
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
      <p className="text-body leading-relaxed text-ink-2">{message}</p>
    </Sheet>
  );
}
