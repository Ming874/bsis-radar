/**
 * 【設計系統】底部面板（手機）／置中對話框（電腦）。連線詳情、行程詳情、安裝說明、確認動作都用它。
 *
 * - 手機：從下面滑上來；拖把手或標題列往下拉可以關，Android 的返回鍵也會關（不會離開網頁）
 * - 開著時鎖住後面的頁面捲動；Esc 關閉；關掉後焦點回到原本的按鈕
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './base';
import { Button, IconButton } from './Button';
import { XIcon } from './icons';
import { lockScroll, useBackToClose } from './layers';

const CLOSE_MS = 300;

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** 標題下方的一行說明 */
  description?: ReactNode;
  children: ReactNode;
  /** 固定在底部的按鈕列 */
  footer?: ReactNode;
  /** 電腦上寬一點（行程詳情、圖表） */
  wide?: boolean;
}

export function Sheet({ open, onClose, ...rest }: SheetProps) {
  // 關閉動畫播完才卸載
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  if (open && !mounted) setMounted(true);
  const shown = open && entered;

  useEffect(() => {
    if (open) {
      // 下一個畫格才加上「打開」的狀態，transition 才會播
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(raf);
    }
    const timer = setTimeout(() => {
      setMounted(false);
      setEntered(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useBackToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    const release = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      release();
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(<SheetFrame shown={shown} onClose={onClose} {...rest} />, document.body);
}

function SheetFrame({ shown, onClose, title, description, children, footer, wide = false }: Omit<SheetProps, 'open'> & { shown: boolean }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  // 打開時把焦點移進面板，關掉後回到原本的元素
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    panelRef.current?.setAttribute('data-dragging', '');
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    d.dy = Math.max(0, e.clientY - d.y);
    panel.style.transform = `translateY(${d.dy}px)`;
  };
  const endDrag = () => {
    const d = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!d || !panel) return;
    panel.removeAttribute('data-dragging');
    panel.style.transform = '';
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > 110 || (d.dy > 30 && velocity > 0.6)) onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className={cx('sheet-scrim absolute inset-0 bg-[var(--scrim)]', shown ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center sm:items-center sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          data-state={shown ? 'open' : 'closed'}
          className={cx(
            'sheet-panel pointer-events-auto relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-surface outline-none sm:max-h-[86dvh] sm:rounded-[28px]',
            'shadow-[var(--float-shadow)]',
            wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
          )}
        >
          <div className="shrink-0 touch-none select-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
              <span className="h-[5px] w-9 rounded-full bg-line-strong" />
            </div>
            {title && (
              <div className="flex items-start justify-between gap-3 px-5 pt-1.5 pb-3 sm:pt-5">
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="text-title font-bold tracking-tight text-ink">
                    {title}
                  </h2>
                  {description && <p className="mt-0.5 text-footnote text-muted">{description}</p>}
                </div>
                <IconButton icon={XIcon} label="關閉" variant="soft" size="sm" onClick={onClose} className="mt-0.5" />
              </div>
            )}
          </div>
          <div className={cx('thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5', footer ? 'pb-4' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]', !title && 'pt-2')}>
            {children}
          </div>
          {footer && <div className="shrink-0 border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/** 確認動作（取代瀏覽器內建的 confirm 視窗）：會刪除、重開、蓋掉資料的動作都要先確認 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col gap-3 pt-3 pb-1 text-center sm:pt-6">
        <h2 className="text-title font-bold text-ink">{title}</h2>
        <div className="text-subhead text-muted">{message}</div>
        <div className="mt-3 flex flex-col gap-2">
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="lg"
            block
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" size="lg" block onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
