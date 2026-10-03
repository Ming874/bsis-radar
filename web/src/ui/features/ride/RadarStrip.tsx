/**
 * 【騎乘】直立雷達條（類似 Garmin Varia）：最上方是你，來車是一個發光的點，越接近越往上爬。
 * C4001 只有距離、沒有方位角，所以用一條直線表示比扇形更直覺、也更誠實。
 * 全部用 currentColor 繪製，放在任何顏色的警示卡上都清楚。
 */
import { useId } from 'react';
import type { HistoryPoint } from '../../../domain/types';

const W = 72;
const H = 260;
const TOP = 46;
const BOTTOM = 8;
const MAX_M = 20;
const X = 44; // 軌道中心
const TRACK_W = 16;
const TICKS = [5, 10, 15, 20];

const y = (m: number) => TOP + (Math.min(Math.max(m, 0), MAX_M) / MAX_M) * (H - TOP - BOTTOM);

export function RadarStrip({
  distanceM,
  warnRangeM,
  dangerDistM,
  trail,
  pulse = false,
}: {
  distanceM: number | null;
  warnRangeM: number;
  dangerDistM: number;
  trail: HistoryPoint[];
  /** 危險時，來車的點外圈擴散 */
  pulse?: boolean;
}) {
  const glowId = useId();
  const left = X - TRACK_W / 2;
  const lastT = trail.at(-1)?.t ?? 0;
  const zone = (meters: number) => y(meters) - TOP;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-[4.5rem] shrink-0 lg:w-24" aria-hidden>
      <defs>
        <filter id={glowId} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation={5} />
        </filter>
      </defs>

      {/* 騎士：圓形底 + 腳踏車 */}
      <circle cx={X} cy={19} r={17} fill="currentColor" fillOpacity={0.2} />
      <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={X - 6.5} cy={22} r={4.5} />
        <circle cx={X + 6.5} cy={22} r={4.5} />
        <path d={`M${X - 6.5} 22 L${X - 1.5} 15 L${X + 3.5} 22 M${X - 1.5} 15 L${X + 3} 15`} />
      </g>

      {/* 軌道（膠囊）：越上面越接近你，危險區 > 警示區 > 偵測範圍，顏色由淡到濃 */}
      <rect x={left} y={TOP} width={TRACK_W} height={H - TOP - BOTTOM} rx={TRACK_W / 2} fill="currentColor" fillOpacity={0.14} />
      <rect x={left} y={TOP} width={TRACK_W} height={zone(warnRangeM)} rx={TRACK_W / 2} fill="currentColor" fillOpacity={0.16} />
      <rect
        x={left}
        y={TOP}
        width={TRACK_W}
        height={zone(Math.min(dangerDistM, warnRangeM))}
        rx={TRACK_W / 2}
        fill="currentColor"
        fillOpacity={0.24}
      />
      {TICKS.map((m) => (
        <text key={m} x={left - 7} y={y(m) + 3.5} textAnchor="end" fontSize={10} fontWeight={600} fill="currentColor" opacity={0.7}>
          {m}
        </text>
      ))}

      {/* 最近 2 秒的軌跡 */}
      {trail.map((p) =>
        p.distanceM === null ? null : (
          <circle key={p.t} cx={X} cy={y(p.distanceM)} r={3} fill="currentColor" opacity={Math.max(0.12, 0.5 - (lastT - p.t) / 4500)} />
        ),
      )}

      {/* 來車：柔光 + 實心點；危險時外圈擴散 */}
      {distanceM !== null && (
        <g>
          <circle cx={X} cy={y(distanceM)} r={13} fill="currentColor" opacity={0.55} filter={`url(#${glowId})`} />
          {pulse && (
            <circle
              cx={X}
              cy={y(distanceM)}
              r={11}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="origin-center [transform-box:fill-box] motion-safe:animate-ping"
            />
          )}
          <circle cx={X} cy={y(distanceM)} r={9} fill="currentColor" />
        </g>
      )}
    </svg>
  );
}
