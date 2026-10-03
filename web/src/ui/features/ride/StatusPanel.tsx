/**
 * 【騎乘】警示卡（iOS 小工具風格）：整張卡的顏色 = 警示等級，大數字 = 來車距離，右側是雷達條。
 * 騎車時看一眼就懂；危險時卡片外圈會呼吸發光。
 */
import type { ComponentType } from 'react';
import type { SafetyTone, SafetyView } from '../../../application/selectors';
import type { HistoryPoint, Telemetry } from '../../../domain/types';
import { formatSeconds, formatSpeed, speedUnitLabel, type SpeedUnit } from '../../../domain/units';
import { AlertIcon, ClockIcon, LoaderIcon, ShieldCheckIcon, SignalOffIcon } from '../../kit';
import { RadarStrip } from './RadarStrip';

/** 卡片底色（漸層 + 同色系陰影）、文字顏色、毛玻璃小方塊 */
const LOOK: Record<SafetyTone, { card: string; glass: string }> = {
  safe: {
    card: 'from-alert-safe to-alert-safe-deep text-white shadow-alert-safe-deep/30',
    glass: 'bg-white/16 ring-white/20',
  },
  caution: {
    card: 'from-alert-caution to-alert-caution-deep text-alert-caution-ink shadow-alert-caution-deep/35',
    glass: 'bg-white/35 ring-black/5',
  },
  danger: {
    card: 'from-alert-danger to-alert-danger-deep text-white shadow-alert-danger-deep/40',
    glass: 'bg-white/16 ring-white/20',
  },
  offline: { card: 'from-alert-neutral to-alert-neutral-deep text-white shadow-black/15', glass: 'bg-white/14 ring-white/15' },
  stale: { card: 'from-alert-neutral to-alert-neutral-deep text-white shadow-black/15', glass: 'bg-white/14 ring-white/15' },
  idle: { card: 'from-alert-neutral to-alert-neutral-deep text-white shadow-black/15', glass: 'bg-white/14 ring-white/15' },
  connecting: { card: 'from-alert-brand to-alert-brand-deep text-white shadow-alert-brand-deep/30', glass: 'bg-white/16 ring-white/20' },
};

const ICON: Record<SafetyTone, ComponentType<{ className?: string }>> = {
  safe: ShieldCheckIcon,
  caution: AlertIcon,
  danger: AlertIcon,
  offline: SignalOffIcon,
  stale: ClockIcon,
  connecting: LoaderIcon,
  idle: SignalOffIcon,
};

/** 數字下方的一句話：告訴騎士現在該怎麼做 */
function caption(view: SafetyView, tracking: boolean): string {
  switch (view.tone) {
    case 'danger':
      return '即將到達，請保持直線、不要變換車道';
    case 'caution':
      return '後方有車接近，變換車道前請先注意';
    case 'safe':
      return tracking ? '有車在警示範圍外接近中' : '後方淨空';
    default:
      return view.detail;
  }
}

/** 毛玻璃小方塊：標籤 + 圓體數字 + 單位 */
function GlassMetric({ label, value, unit, glass }: { label: string; value: string; unit: string; glass: string }) {
  return (
    <div className={`min-w-0 rounded-[14px] px-3.5 py-2.5 ring-1 ring-inset ${glass}`}>
      <div className="truncate text-caption font-semibold opacity-80">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`tabular truncate font-rounded text-[1.625rem] leading-8 font-semibold tracking-tight ${value === '—' ? 'opacity-50' : ''}`}>
          {value}
        </span>
        <span className="shrink-0 text-callout font-medium opacity-80">{unit}</span>
      </div>
    </div>
  );
}

export function StatusPanel({
  view,
  telemetry,
  unit,
  warnRangeM,
  dangerDistM,
  trail,
}: {
  view: SafetyView;
  /** 只有資料可信（已連線、雷達在線、沒中斷）時才傳入 */
  telemetry: Telemetry | null;
  unit: SpeedUnit;
  warnRangeM: number;
  dangerDistM: number;
  trail: HistoryPoint[];
}) {
  const Icon = ICON[view.tone];
  const look = LOOK[view.tone];
  const distance = telemetry?.distanceM ?? null;
  const tracking = distance !== null;
  const danger = view.tone === 'danger';

  return (
    <section aria-live="assertive" aria-atomic="true" className="relative">
      {danger && <div aria-hidden className="pointer-events-none absolute inset-0 rounded-panel motion-safe:animate-alert-breathe" />}
      <div
        className={`relative flex flex-col overflow-hidden rounded-panel bg-linear-to-b p-5 shadow-xl transition-[color,background-color,box-shadow] duration-500 lg:min-h-[27rem] lg:p-7 ${look.card}`}
      >
        {/* 上半部的柔和高光，讓卡片有 iOS 小工具的立體感 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2/3 bg-linear-to-b from-white/20 to-transparent" />

        <div className="relative flex flex-1 gap-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${look.glass}`}>
                <Icon className={`h-5 w-5 ${view.tone === 'connecting' ? 'motion-safe:animate-spin' : ''}`} />
              </span>
              <p className="truncate text-title font-semibold">{view.title}</p>
            </div>

            <p className="mt-6 text-callout font-medium opacity-80">來車距離</p>
            <p className="flex items-baseline gap-1">
              <span
                className={`tabular font-rounded text-[clamp(3.5rem,19vw,4.75rem)] leading-[1.02] font-semibold tracking-tight lg:text-[6.5rem] ${
                  tracking ? '' : 'opacity-45'
                }`}
              >
                {tracking ? distance.toFixed(1) : '—'}
              </span>
              {tracking && <span className="font-rounded text-2xl font-semibold opacity-80 lg:text-3xl">m</span>}
            </p>
            <p className="mt-1.5 min-h-5 text-callout font-medium opacity-90">{caption(view, tracking)}</p>

            <div className="mt-auto grid grid-cols-2 gap-2.5 pt-5">
              <GlassMetric
                glass={look.glass}
                label="接近速度"
                value={formatSpeed(telemetry?.closingMps ?? null, unit)}
                unit={speedUnitLabel(unit)}
              />
              <GlassMetric glass={look.glass} label="到達時間" value={formatSeconds(telemetry?.ttcS ?? null)} unit="秒" />
            </div>
          </div>

          <RadarStrip distanceM={distance} warnRangeM={warnRangeM} dangerDistM={dangerDistM} trail={trail} pulse={danger} />
        </div>
      </div>
    </section>
  );
}
