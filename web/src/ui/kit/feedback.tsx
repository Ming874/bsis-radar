/**
 * 【設計系統】狀態與提示：橫幅、標籤、狀態圓點、空狀態、頁面標題。
 */
import type { ReactNode } from 'react';
import { AlertIcon, CheckCircleIcon, InfoIcon } from './icons';
import type { Tone } from './Section';

const BANNER: Record<'info' | 'warning' | 'danger' | 'success', { box: string; icon: string; Icon: typeof InfoIcon }> = {
  info: { box: 'bg-accent/8 border-accent/25', icon: 'text-accent-ink', Icon: InfoIcon },
  warning: { box: 'bg-caution/10 border-caution/30', icon: 'text-caution', Icon: AlertIcon },
  danger: { box: 'bg-danger/8 border-danger/25', icon: 'text-danger', Icon: AlertIcon },
  success: { box: 'bg-safe/8 border-safe/25', icon: 'text-safe', Icon: CheckCircleIcon },
};

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: keyof typeof BANNER;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const s = BANNER[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex gap-3 rounded-card border p-4 ${s.box}`}>
      <s.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.icon}`} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 text-callout leading-relaxed text-ink-2">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

const BADGE: Record<Tone, string> = {
  accent: 'bg-accent/12 text-accent-ink',
  safe: 'bg-safe/12 text-safe',
  caution: 'bg-caution/18 text-caution',
  danger: 'bg-danger/12 text-danger',
  neutral: 'bg-fill text-ink-2',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-bold ${BADGE[tone]}`}>{children}</span>;
}

export type DotState = 'ok' | 'busy' | 'off' | 'error';

const DOT: Record<DotState, string> = {
  ok: 'bg-safe',
  busy: 'bg-caution motion-safe:animate-pulse',
  off: 'bg-ink-3',
  error: 'bg-danger',
};

export function StatusDot({ state }: { state: DotState }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[state]}`} />;
}

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-accent [&_svg]:h-10 [&_svg]:w-10">
        {icon}
      </span>
      <h2 className="mt-5 text-headline font-bold text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-body leading-relaxed text-ink-2">{description}</p>}
      {children && <div className="mt-6 w-full max-w-sm">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-1 pt-2 pb-1">
      <div className="min-w-0">
        <h1 className="text-headline font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-callout text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
