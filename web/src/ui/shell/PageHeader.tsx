/**
 * 【UI 層】頁首：手機是大標題＋右上角的連線狀態；捲過大標題後，上方滑出縮小的頁首（標題＋連線狀態）。
 * 電腦版標題比較小、加一行說明，連線狀態在左欄。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverspeed, useRadar } from '../../application/container';
import { Badge, cx } from '../kit';
import { ConnectionChip } from './Connection';

/** 全站都要看得到的狀態：超速、記錄中 */
function StatusBadges() {
  const over = useOverspeed((o) => o.active);
  const recording = useRadar((r) => r.recording.active);
  return (
    <>
      {over && <Badge tone="bad">超速</Badge>}
      {recording && (
        <Badge tone="bad">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bad motion-safe:animate-pulse" />
          記錄中
        </Badge>
      )}
    </>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry?.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header className="flex items-end justify-between gap-3 pt-2 pb-4 lg:pt-0 lg:pb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="large-title truncate text-ink lg:text-[28px]">{title}</h1>
            <span className="inline-flex items-center gap-1.5">
              <StatusBadges />
            </span>
          </div>
          {description && <p className="mt-1 hidden text-subhead text-muted lg:block">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {actions}
          <span className="lg:hidden">
            <ConnectionChip />
          </span>
        </div>
      </header>
      <div ref={sentinel} aria-hidden className="h-px" />
      {createPortal(
        <div
          data-hidden={collapsed ? undefined : ''}
          aria-hidden={!collapsed}
          className="compact-header pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden"
        >
          <div className="chrome pointer-events-auto flex h-12 w-full max-w-xl items-center justify-between gap-2 rounded-full pr-1.5 pl-5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-headline font-semibold text-ink">{title}</span>
              <StatusBadges />
            </span>
            <span className={cx(!collapsed && 'invisible')}>
              <ConnectionChip compact />
            </span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
