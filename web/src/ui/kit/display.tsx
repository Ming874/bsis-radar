/**
 * 【設計系統】顯示元件：狀態點、標籤、訊號格、統計數字、鍵值表、提示、空狀態。
 */
import type { ComponentType, ReactNode } from 'react';
import type { Tone } from '../../application/selectors';
import { cx } from './base';
import { AlertIcon, InfoIcon, type IconProps } from './icons';
import { TONE_BG } from './tones';

export function StatusDot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2 w-2 shrink-0 rounded-full', TONE_BG[tone], tone === 'busy' && 'motion-safe:animate-pulse', className)} />;
}

/** 狀態點 + 文字 */
export function StatusLabel({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-subhead font-medium text-ink', className)}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export type BadgeTone = 'neutral' | 'tint' | 'ok' | 'warn' | 'bad';

const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  tint: 'bg-tint-soft text-tint',
  ok: 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok',
  warn: 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-warn',
  bad: 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] text-bad',
};

/** 小標籤（示範資料、超速、記錄中…） */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption font-semibold whitespace-nowrap', BADGE[tone], className)}>{children}</span>;
}

/** 訊號品質：最近 20 筆資料框中可用量測的比例，四格顯示 */
export function SignalBars({ pct, showLabel = true }: { pct: number; showLabel?: boolean }) {
  const level = pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : pct > 0 ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-2 text-footnote text-muted" title={`最近 20 筆資料框中 ${pct}% 可用`}>
      <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('w-[3px] rounded-[1px]', i <= level ? 'bg-ink' : 'bg-line-strong')} style={{ height: `${25 * i}%` }} />
        ))}
      </span>
      {showLabel && <span className="num">訊號 {pct}%</span>}
    </span>
  );
}

/** 一個統計數字：標籤在上、數值與單位在下 */
export function Stat({
  label,
  value,
  unit,
  sub,
  muted = false,
  tone,
  size = 'md',
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  muted?: boolean;
  tone?: 'bad' | 'warn';
  size?: 'sm' | 'md';
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-footnote text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={cx(
            'num font-semibold tracking-tight',
            size === 'sm' ? 'text-headline' : 'text-stat',
            tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : muted ? 'text-faint' : 'text-ink',
          )}
        >
          {value}
        </span>
        {unit && <span className="text-footnote text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-caption text-muted">{sub}</div>}
    </div>
  );
}

export interface KeyValueRow {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
}

/** 兩欄的鍵值表：左邊名稱、右邊等寬數字（原始資料、裝置資訊） */
export function KeyValue({ rows, dense = false }: { rows: KeyValueRow[]; dense?: boolean }) {
  return (
    <dl className="[&>*+*]:border-t [&>*+*]:border-line">
      {rows.map((r, i) => (
        <div key={i} className={cx('flex items-baseline justify-between gap-4 px-4', dense ? 'py-2.5' : 'py-3')}>
          <dt className="min-w-0 text-subhead text-muted">
            {r.label}
            {r.hint && <span className="ml-1.5 text-caption text-faint">{r.hint}</span>}
          </dt>
          <dd className="num shrink-0 text-right font-mono text-subhead text-ink">
            {r.value}
            {r.unit && <span className="ml-1 font-sans text-footnote text-muted">{r.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const NOTICE_BG = {
  info: 'bg-surface',
  warn: 'bg-[color-mix(in_srgb,var(--warn)_10%,var(--surface))]',
  bad: 'bg-[color-mix(in_srgb,var(--bad)_9%,var(--surface))]',
};

/** 提示：說明目前狀態與下一步（放在頁面上方或卡片裡） */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  icon,
  flat = false,
}: {
  tone?: 'info' | 'warn' | 'bad';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ComponentType<IconProps>;
  /** 放在卡片裡：不要卡片的外框與圓角陰影 */
  flat?: boolean;
}) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-tint';
  const Icon = icon ?? (tone === 'info' ? InfoIcon : AlertIcon);
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={cx('flex gap-3 rounded-2xl px-4 py-3.5', flat ? (tone === 'info' ? 'bg-surface-2' : NOTICE_BG[tone]) : cx('card', NOTICE_BG[tone]))}>
      <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', color)} />
      <div className="min-w-0 flex-1">
        <p className="text-subhead font-semibold text-ink">{title}</p>
        {children && <div className="mt-0.5 text-footnote text-muted">{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: ComponentType<IconProps>; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon && (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-faint">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-headline font-semibold text-ink">{title}</p>
      {children && <div className="max-w-xs text-footnote text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
