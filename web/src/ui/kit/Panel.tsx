/**
 * 【設計系統】面板：頁面上所有內容都放在面板裡。標題列（標題 + 右側動作）＋ 內容 ＋ 選用的底部列。
 */
import { useId, type ReactNode } from 'react';

export function Panel({
  title,
  description,
  actions,
  footer,
  flush = false,
  className = '',
  bodyClassName = '',
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** 內容不留邊距（表格、圖表貼齊邊框） */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className={`flex min-w-0 flex-col rounded-lg border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0">
            {title && (
              <h2 id={id} className="text-heading font-semibold text-fg">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-label text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${flush ? '' : 'p-4'} ${bodyClassName}`}>{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
    </section>
  );
}

/** 頁面標題：只在電腦版顯示（手機版的分頁列已經告訴使用者在哪一頁） */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 hidden items-end justify-between gap-4 lg:flex">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-body text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
