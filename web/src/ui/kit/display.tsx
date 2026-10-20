/**
 * 【設計系統】顯示元件：狀態點、統計數字、鍵值表、提示列、空狀態。
 */
import type { ReactNode } from 'react';
import type { Tone } from '../../application/selectors';
import { AlertIcon, InfoIcon } from './icons';
import { TONE_BG } from './tones';

export function StatusDot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_BG[tone]} ${tone === 'busy' ? 'motion-safe:animate-pulse' : ''} ${className}`}
    />
  );
}

/** 狀態點 + 文字 */
export function StatusLabel({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-body text-fg ${className}`}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** 一個統計數字：標籤在上、數值與單位在下 */
export function Stat({ label, value, unit, sub, muted = false }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-label text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`tabular text-stat font-semibold tracking-tight ${muted ? 'text-subtle' : 'text-fg'}`}>{value}</span>
        {unit && <span className="text-label text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-label text-subtle">{sub}</div>}
    </div>
  );
}

export interface KeyValueRow {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
}

/** 兩欄的鍵值表：左邊名稱、右邊等寬數字 */
export function KeyValue({ rows, dense = false }: { rows: KeyValueRow[]; dense?: boolean }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-4 px-4 ${dense ? 'py-1.5' : 'py-2.5'}`}>
          <dt className="min-w-0 text-body text-muted">
            {r.label}
            {r.hint && <span className="ml-1.5 text-label text-subtle">{r.hint}</span>}
          </dt>
          <dd className="tabular shrink-0 text-right font-mono text-body text-fg">
            {r.value}
            {r.unit && <span className="ml-1 font-sans text-label text-muted">{r.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 提示列：放在面板裡或頁面上方，說明目前狀態與下一步 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'bad';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-accent';
  const border = tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-warn/40' : 'border-line';
  const Icon = tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex gap-3 rounded-lg border bg-panel px-4 py-3 ${border}`}>
      <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-fg">{title}</p>
        {children && <div className="mt-0.5 text-body text-muted">{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-body font-medium text-muted">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-label text-subtle">{children}</p>}
    </div>
  );
}
