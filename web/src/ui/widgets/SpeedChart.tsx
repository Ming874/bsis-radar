/**
 * 【UI 層】速度趨勢圖：雷達對地速度（實線）與輪速感測器參考值（虛線），最近 2 分鐘。
 * 開啟超速警示時畫出速限（紅色虛線），速限以上的那一段雷達曲線改成紅色。
 */
import { useId } from 'react';
import type { SpeedPoint } from '../../domain/types';
import { toUnit, type SpeedUnit } from '../../domain/units';
import { useElementWidth } from '../hooks/useElementWidth';

const PAD = { left: 34, right: 10, top: 10, bottom: 22 };
const GAP_MS = 1000; // 中間斷超過 1 秒就斷線，不畫假的連線

/** 1、2、5 × 10ⁿ 的刻度間隔 */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function buildPath(points: SpeedPoint[], pick: (p: SpeedPoint) => number | null, x: (t: number) => number, y: (v: number) => number): string {
  let d = '';
  let lastT = -Infinity;
  for (const p of points) {
    const v = pick(p);
    if (v === null) {
      lastT = -Infinity;
      continue;
    }
    d += `${p.t - lastT > GAP_MS ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
    lastT = p.t;
  }
  return d;
}

export function SpeedChart({
  points,
  unit,
  windowMs,
  limitMps = null,
  height = 200,
}: {
  points: SpeedPoint[];
  unit: SpeedUnit;
  windowMs: number;
  limitMps?: number | null;
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(340);
  const clipId = `over-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const end = points[points.length - 1]?.t ?? 0; // 右邊界 = 最新一筆的時間
  const start = end - windowMs;

  const radar = (p: SpeedPoint) => (p.speedMps === null ? null : toUnit(p.speedMps, unit));
  const wheel = (p: SpeedPoint) => (p.wheelMps === null ? null : toUnit(p.wheelMps, unit));
  let max = unit === 'kmh' ? 10 : 3;
  for (const p of points) max = Math.max(max, radar(p) ?? 0, wheel(p) ?? 0);
  if (limitMps !== null) max = Math.max(max, toUnit(limitMps, unit)); // 速限一直在圖上，看得出離速限多遠
  const step = niceStep(max * 1.1, 4);
  const yMax = Math.ceil((max * 1.1) / step) * step;

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - start) / windowMs) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);
  const xTicks = [120, 90, 60, 30, 0].filter((s) => s * 1000 <= windowMs);
  const hasWheel = points.some((p) => p.wheelMps !== null);
  const last = [...points].reverse().find((p) => p.speedMps !== null);
  const radarPath = buildPath(points, radar, x, y);
  const limitY = limitMps === null ? null : y(toUnit(limitMps, unit));
  const lastOver = limitMps !== null && last?.speedMps != null && last.speedMps >= limitMps;

  return (
    <div ref={ref} className="w-full">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近 2 分鐘的速度變化" className="block h-auto">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--faint)" className="num">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={x(end - s * 1000)} y={height - 6} textAnchor={s === 0 ? 'end' : 'middle'} fontSize={11} fill="var(--faint)">
            {s === 0 ? '現在' : `−${s} s`}
          </text>
        ))}
        {hasWheel && (
          <path d={buildPath(points, wheel, x, y)} fill="none" stroke="var(--ref)" strokeWidth={1.5} strokeDasharray="4 3" />
        )}
        {limitY !== null && (
          <>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={width} height={limitY} />
            </clipPath>
            <line x1={PAD.left} x2={width - PAD.right} y1={limitY} y2={limitY} stroke="var(--bad)" strokeWidth={1} strokeDasharray="3 3" />
          </>
        )}
        <path d={radarPath} fill="none" stroke="var(--tint)" strokeWidth={1.75} strokeLinejoin="round" />
        {limitY !== null && <path d={radarPath} fill="none" stroke="var(--bad)" strokeWidth={1.75} strokeLinejoin="round" clipPath={`url(#${clipId})`} />}
        {last && last.speedMps !== null && (
          <circle cx={x(last.t)} cy={y(toUnit(last.speedMps, unit))} r={3} fill={lastOver ? 'var(--bad)' : 'var(--tint)'} />
        )}
      </svg>
      <div className="mt-1 flex gap-4 pl-[34px] text-caption text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-tint" />
          雷達
        </span>
        {hasWheel && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-dashed border-ref" />
            輪速（參考）
          </span>
        )}
        {limitMps !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 border-t border-dashed border-bad" />
            速限
          </span>
        )}
        <span className="ml-auto pr-2 text-faint">{unit === 'kmh' ? 'km/h' : 'm/s'}</span>
      </div>
    </div>
  );
}
