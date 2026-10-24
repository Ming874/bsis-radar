/**
 * 【UI 層】行程的速度曲線（行程頁、行程詳情）：橫軸是開始後的時間，沒有資料的那段斷開。
 * 手指（或滑鼠）在圖上移動時顯示那個時間點的速度；有速限時畫紅色虛線，速限以上的那一段改成紅色。
 */
import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tracePoints, type TripTrace } from '../../domain/trace';
import { formatDuration, speedUnitLabel, toUnit, type SpeedUnit } from '../../domain/units';
import { useElementWidth } from '../hooks/useElementWidth';

const PAD = { left: 34, right: 10, top: 10, bottom: 22 };

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** 橫軸刻度（秒）：1、2、5、10、15、30 分鐘… */
function timeStep(totalS: number): number {
  const candidates = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  return candidates.find((c) => totalS / c <= 5) ?? 7200;
}

export function TraceChart({
  trace,
  unit,
  limitMps = null,
  height = 180,
  avgMps = null,
}: {
  trace: TripTrace;
  unit: SpeedUnit;
  limitMps?: number | null;
  height?: number;
  avgMps?: number | null;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(340);
  const clipId = `trace-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const points = useMemo(() => tracePoints(trace), [trace]);
  const [cursor, setCursor] = useState<number | null>(null);

  const totalS = Math.max(trace.stepS, points.length * trace.stepS);
  let max = unit === 'kmh' ? 10 : 3;
  for (const p of points) if (p.mps !== null) max = Math.max(max, toUnit(p.mps, unit));
  if (limitMps !== null) max = Math.max(max, toUnit(limitMps, unit));
  const step = niceStep(max * 1.1, 4);
  const yMax = Math.ceil((max * 1.1) / step) * step;

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (s: number) => PAD.left + (s / totalS) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  let d = '';
  let pen = false;
  for (const p of points) {
    if (p.mps === null) {
      pen = false;
      continue;
    }
    // 點畫在格子的中間
    d += `${pen ? 'L' : 'M'}${x(p.s + trace.stepS / 2).toFixed(1)},${y(toUnit(p.mps, unit)).toFixed(1)}`;
    pen = true;
  }

  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);
  const tStep = timeStep(totalS);
  const xTicks: number[] = [];
  for (let s = 0; s <= totalS + 1e-9; s += tStep) xTicks.push(s);
  const limitY = limitMps === null ? null : y(toUnit(limitMps, unit));

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor(((px - PAD.left) / innerW) * points.length);
    setCursor(i >= 0 && i < points.length ? i : null);
  };
  const picked = cursor === null ? null : points[cursor];

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="這次行程的速度變化"
        className="block h-auto touch-pan-y"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setCursor(null)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--faint)" className="num">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={x(s)} y={height - 6} textAnchor={s === 0 ? 'start' : 'middle'} fontSize={11} fill="var(--faint)" className="num">
            {s === 0 ? '0' : tStep < 60 ? `${s} 秒` : `${Math.round(s / 60)} 分`}
          </text>
        ))}
        {avgMps !== null && (
          <line x1={PAD.left} x2={width - PAD.right} y1={y(toUnit(avgMps, unit))} y2={y(toUnit(avgMps, unit))} stroke="var(--ref)" strokeDasharray="2 4" />
        )}
        {limitY !== null && (
          <>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={width} height={limitY} />
            </clipPath>
            <line x1={PAD.left} x2={width - PAD.right} y1={limitY} y2={limitY} stroke="var(--bad)" strokeDasharray="3 3" />
          </>
        )}
        <path d={d} fill="none" stroke="var(--tint)" strokeWidth={1.75} strokeLinejoin="round" />
        {limitY !== null && <path d={d} fill="none" stroke="var(--bad)" strokeWidth={1.75} strokeLinejoin="round" clipPath={`url(#${clipId})`} />}
        {picked && cursor !== null && (
          <g>
            <line x1={x(picked.s + trace.stepS / 2)} x2={x(picked.s + trace.stepS / 2)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-strong)" />
            {picked.mps !== null && <circle cx={x(picked.s + trace.stepS / 2)} cy={y(toUnit(picked.mps, unit))} r={3.5} fill="var(--tint)" />}
          </g>
        )}
      </svg>
      <div className="mt-1 flex min-h-5 items-center justify-between gap-3 pl-[34px] text-caption text-muted">
        {picked ? (
          <span className="num font-semibold text-ink">
            {formatDuration(picked.s)} · {picked.mps === null ? '沒有資料' : `${toUnit(picked.mps, unit).toFixed(unit === 'kmh' ? 1 : 2)} ${speedUnitLabel(unit)}`}
          </span>
        ) : (
          <span className="flex gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 bg-tint" />
              速度
            </span>
            {avgMps !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-4 border-t border-dotted border-ref" />
                平均
              </span>
            )}
            {limitMps !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-4 border-t border-dashed border-bad" />
                速限
              </span>
            )}
          </span>
        )}
        <span className="pr-2 text-faint">{speedUnitLabel(unit)}</span>
      </div>
    </div>
  );
}
