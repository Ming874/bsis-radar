/**
 * 【設計系統】卡片列表：Section 是一張白色卡片（標題列 + 列表 + 灰色註腳），每一列是 ListRow。
 * 整個網頁的設定、紀錄、裝置頁都用同一種卡片，看起來與操作方式一致。
 */
import type { ReactNode } from 'react';
import type { HelpText } from '../content/help';
import { FOCUS_RING } from './Button';
import { ChevronRightIcon } from './icons';
import { HelpButton } from './Sheet';

export type Tone = 'accent' | 'safe' | 'caution' | 'danger' | 'neutral';

const TILE: Record<Tone, string> = {
  accent: 'bg-accent/12 text-accent-ink',
  safe: 'bg-safe/12 text-safe',
  caution: 'bg-caution/15 text-caution',
  danger: 'bg-danger/12 text-danger',
  neutral: 'bg-fill text-ink-2',
};

/** 列左側的圖示方塊 */
export function IconTile({ tone = 'accent', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control [&_svg]:h-[18px] [&_svg]:w-[18px] ${TILE[tone]}`}>
      {children}
    </span>
  );
}

export function Section({
  title,
  action,
  footer,
  children,
}: {
  title?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {(title || action) && (
        <header className="flex min-h-12 items-center justify-between gap-2 border-b border-line py-2 pr-2 pl-4">
          {title && <h2 className="text-body font-semibold text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className="divide-y divide-line">{children}</div>
      {footer && <div className="border-t border-line bg-fill/60 px-4 py-2.5 text-caption leading-relaxed text-ink-2">{footer}</div>}
    </section>
  );
}

/**
 * 一列：圖示 + 標題（＋ⓘ）+ 說明，右側放數值或控制項。
 * 有 onClick 時整列可點（右邊自動出現 ›）。有 children 時，children 放在標題下方（例如滑桿）。
 */
export function ListRow({
  icon,
  tone = 'accent',
  title,
  description,
  help,
  value,
  accessory,
  onClick,
  disabled,
  destructive,
  children,
}: {
  icon?: ReactNode;
  tone?: Tone;
  title: ReactNode;
  description?: ReactNode;
  help?: HelpText;
  value?: ReactNode;
  accessory?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const head = (
    <>
      {icon && <IconTile tone={destructive ? 'danger' : tone}>{icon}</IconTile>}
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1 text-body font-medium ${destructive ? 'text-danger' : 'text-ink'}`}>
          {title}
        </span>
        {description && <span className="mt-0.5 block text-callout text-ink-2">{description}</span>}
      </span>
      {value !== undefined && <span className="tabular shrink-0 text-body text-ink-2">{value}</span>}
      {accessory}
      {onClick && accessory === undefined && <ChevronRightIcon className="h-4 w-4 shrink-0 text-ink-3" />}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-fill/60 active:bg-fill disabled:pointer-events-none disabled:opacity-40 ${FOCUS_RING} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        {head}
      </button>
    );
  }

  return (
    <div className={`px-4 py-3 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex min-h-8 items-center gap-3">
        {head}
        {help && <HelpButton help={help} />}
      </div>
      {children && <div className={icon ? 'mt-3 pl-11' : 'mt-3'}>{children}</div>}
    </div>
  );
}
