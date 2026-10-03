/**
 * 【共用小工具】最近 60 秒的追蹤距離圖（紀錄頁、電腦版騎乘頁共用）。
 * 黃色虛線 = 警示距離；警示中的點用等級顏色標出。
 */
import type { AlertLevel, HistoryPoint } from '../../domain/types';
import { useElementWidth } from '../hooks/useElementWidth';

const LEVEL_FILL: Record<AlertLevel, string> = { 0: 'fill-safe', 1: 'fill-caution', 2: 'fill-danger' };

const PAD = { left: 34, right: 10, top: 10, bottom: 24 };
const WINDOW_MS = 60_000;
const MAX_M = 20;
const Y_TICKS = [0, 5, 10, 15, 20];

export function DistanceChart({ points, warnRangeM }: { points: HistoryPoint[]; warnRangeM: number }) {
  // 畫布寬度 = 實際寬度，文字才會維持 11px；寬螢幕時圖也稍微高一點
  const [ref, measured] = useElementWidth<HTMLDivElement>(320);
  const W = Math.max(240, measured);
  const H = W >= 480 ? 240 : 180;
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;
  const end = points.at(-1)?.t ?? 0;
  const x = (t: number) => PAD.left + ((t - (end - WINDOW_MS)) / WINDOW_MS) * PLOT_W;
  const y = (m: number) => PAD.top + (1 - Math.min(m, MAX_M) / MAX_M) * PLOT_H;

  // 沒有目標（null）的地方斷開線段
  let path = '';
  let penDown = false;
  for (const p of points) {
    if (p.distanceM === null) {
      penDown = false;
      continue;
    }
    path += `${penDown ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.distanceM).toFixed(1)} `;
    penDown = true;
  }
  const hasData = path !== '';

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="最近 60 秒的後方目標距離" className="block w-full">
        {Y_TICKS.map((m) => (
          <g key={m}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(m)} y2={y(m)} className="stroke-line" />
            <text x={PAD.left - 6} y={y(m) + 4} textAnchor="end" fontSize="11" className="fill-ink-3">
              {m}
            </text>
          </g>
        ))}
        <text x={4} y={PAD.top + 4} fontSize="11" className="fill-ink-3">
          m
        </text>
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(warnRangeM)}
          y2={y(warnRangeM)}
          className="stroke-caution"
          strokeDasharray="6 4"
          strokeWidth={1.5}
        />
        {[
          { t: end - WINDOW_MS, label: '−60 s', anchor: 'start' as const },
          { t: end - WINDOW_MS / 2, label: '−30 s', anchor: 'middle' as const },
          { t: end, label: '現在', anchor: 'end' as const },
        ].map((tick) => (
          <text key={tick.label} x={x(tick.t)} y={H - 6} textAnchor={tick.anchor} fontSize="11" className="fill-ink-3">
            {tick.label}
          </text>
        ))}

        {hasData ? (
          <>
            <path d={path} fill="none" strokeWidth={2} className="stroke-ink-2" />
            {points.map((p) =>
              p.distanceM !== null && p.level > 0 ? (
                <circle key={p.t} cx={x(p.t)} cy={y(p.distanceM)} r={3} className={LEVEL_FILL[p.level]} />
              ) : null,
            )}
          </>
        ) : (
          <text x={PAD.left + PLOT_W / 2} y={PAD.top + PLOT_H / 2} textAnchor="middle" fontSize="13" className="fill-ink-3">
            最近 60 秒沒有追蹤到接近中的目標
          </text>
        )}
      </svg>
    </div>
  );
}
