/**
 * 【外框】頂端列：品牌 + 連線狀態膠囊（點了打開連線面板）。電腦版橫跨整個畫面，下方接左側導覽列。
 */
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRadar } from '../../application/container';
import { FOCUS_RING, RadarIcon, StatusDot, type DotState } from '../kit';
import { ConnectionSheet } from './ConnectionSheet';

export function TopBar() {
  const { status, stale } = useRadar(useShallow((s) => ({ status: s.connection.status, stale: s.stale })));
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const [dot, label]: [DotState, string] =
    status === 'connected'
      ? stale
        ? ['error', '資料中斷']
        : ['ok', '已連線']
      : status === 'connecting'
        ? ['busy', '連線中']
        : status === 'reconnecting'
          ? ['busy', '重新連線']
          : ['off', '未連線'];

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-3 px-4 lg:max-w-none lg:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-control bg-accent text-white shadow-sm">
            <span aria-hidden className="absolute inset-0 bg-linear-to-b from-white/25 to-transparent" />
            <RadarIcon className="relative h-5 w-5" />
          </span>
          <span className="truncate text-title font-bold tracking-tight text-ink">Radar A</span>
          <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />
          <span className="hidden truncate text-callout text-ink-2 lg:block">後方來車警示</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`連線狀態：${label}，點一下管理連線`}
          className={`flex h-9 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-callout font-semibold text-ink shadow-sm transition hover:bg-fill ${FOCUS_RING}`}
        >
          <StatusDot state={dot} />
          {label}
        </button>
      </div>
      {open && <ConnectionSheet onClose={close} />}
    </header>
  );
}
