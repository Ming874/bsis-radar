/**
 * 【UI 層】距離 × 徑向速度散佈圖（最近 30 秒的資料框）。
 *
 * 平坦路面上，距離 r 的散射點徑向速度是 v·√(1 − h²/r²)：落在理論曲線附近的點就是路面回波。
 * 灰色帶是地面距離窗口；紅色虛線是雷達測速上限（VMAX）。
 */
import type { DeviceConfig, FrameSample, FrameVerdict } from '../../domain/types';
import { useElementWidth } from '../hooks/useElementWidth';

const PAD = { left: 38, right: 10, top: 10, bottom: 30 };

function color(v: FrameVerdict): string {
  switch (v) {
    case 'accepted':
    case 'unfolded':
    case 'acquiring':
      return 'var(--tint)';
    case 'outlier':
    case 'wrongDirection':
    case 'atLimit':
      return 'var(--warn)';
    default:
      return 'var(--faint)';
  }
}

export function ScatterPlot({
  frames,
  config,
  speedMps,
  height = 220,
}: {
  frames: FrameSample[];
  config: DeviceConfig | null;
  speedMps: number | null;
  height?: number;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(340);
  const dir = config?.direction ?? 1;
  const pts = frames.filter((f) => f.rangeM !== null && f.radialMps !== null);
  const h = config?.heightM ?? 0.7;

  const xMax = Math.max(2.5, (config?.gateMaxM ?? 2) + 0.4, ...pts.map((p) => p.rangeM ?? 0));
  let yMax = Math.max(2, (speedMps ?? 0) * 1.2);
  let yMin = -1;
  for (const p of pts) {
    const v = dir * (p.radialMps ?? 0);
    yMax = Math.max(yMax, v * 1.1);
    yMin = Math.min(yMin, v * 1.1);
  }
  if (config) yMax = Math.max(yMax, Math.min(config.radialLimitMps * 1.08, yMax * 1.5));

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (r: number) => PAD.left + (r / xMax) * innerW;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * innerH;

  // 理論曲線：目前速度下，平坦路面各距離的徑向速度
  let curve = '';
  if (speedMps !== null && speedMps > 0.3) {
    for (let i = 0; i <= 60; i++) {
      const r = h + ((xMax - h) * i) / 60;
      const v = speedMps * Math.sqrt(Math.max(0, 1 - (h * h) / (r * r)));
      curve += `${i === 0 ? 'M' : 'L'}${x(r).toFixed(1)},${y(v).toFixed(1)}`;
    }
  }

  const xTicks: number[] = [];
  for (let r = 0; r <= xMax + 1e-9; r += 0.5) xTicks.push(Number(r.toFixed(1)));
  const yStep = yMax - yMin > 12 ? 4 : yMax - yMin > 6 ? 2 : 1;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);

  return (
    <div ref={ref} className="w-full">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="雷達資料框的距離與徑向速度分布" className="block h-auto">
        {config && config.gateMaxM > config.gateMinM && (
          <rect x={x(config.gateMinM)} y={PAD.top} width={x(config.gateMaxM) - x(config.gateMinM)} height={innerH} fill="var(--surface-2)" />
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--line-strong)' : 'var(--line)'} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--faint)" className="num">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((r) => (
          <text key={r} x={x(r)} y={height - 14} textAnchor="middle" fontSize={11} fill="var(--faint)" className="num">
            {r}
          </text>
        ))}
        <text x={width - PAD.right} y={height - 1} textAnchor="end" fontSize={11} fill="var(--faint)">
          距離（m）
        </text>
        {config && config.radialLimitMps < yMax && (
          <line x1={PAD.left} x2={width - PAD.right} y1={y(config.radialLimitMps)} y2={y(config.radialLimitMps)} stroke="var(--bad)" strokeDasharray="4 3" />
        )}
        {curve && <path d={curve} fill="none" stroke="var(--ref)" strokeWidth={1.5} strokeDasharray="5 3" />}
        {pts.map((p) => (
          <circle key={p.frame} cx={x(p.rangeM ?? 0)} cy={y(dir * (p.radialMps ?? 0))} r={2.5} fill={color(p.verdict)} fillOpacity={0.85} />
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-[38px] text-caption text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-tint" />
          採用
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-warn" />
          剔除（離群、方向、上限）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-faint" />
          窗口外、靜止
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-[1.5px] border-dashed border-ref" />
          平坦路面理論值
        </span>
        <span className="text-faint">縱軸：徑向速度（m/s，已依朝向轉正）</span>
      </div>
    </div>
  );
}
