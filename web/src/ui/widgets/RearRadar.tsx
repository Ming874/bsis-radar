/**
 * 【UI 層】後方雷達畫面：
 * - RearRadarView：俯視圖（卡片用）。腳踏車在上方（前進方向朝上），後方的車從下面往上接近；
 *   橫向位置 = 距離 × sin（角度），只當示意（LD2451 角度解析度 1°）。
 * - RearStrip：騎乘模式邊上的直條，只畫距離：一眼看出「後面有沒有車、多近」。
 * 主要來車用警示色（注意黃、危險紅），其他靠近的目標用重點藍，遠離的只畫外框。
 */
import { REAR_DANGER_DIST_M } from '../../domain/protocol';
import { lateralM, leadTarget } from '../../domain/rear';
import type { RearLevel, RearTarget } from '../../domain/types';
import { cx } from '../kit';

export interface RearRadarData {
  level: RearLevel;
  distanceM: number | null; // 主要來車（韌體濾波後）
  targets: RearTarget[];
}

const LEVEL_FILL: Record<RearLevel, string> = { safe: 'var(--tint)', caution: 'var(--warn)', danger: 'var(--bad)' };

const W = 160;
const H = 250;
const Y0 = 30; // 0 m（腳踏車的位置）
const Y1 = H - 10; // 偵測距離
const LAT_M = 6; // 左右各畫 6 m（約兩個車道）

export function RearRadarView({
  data,
  rangeM,
  detectRangeM,
  mirror,
  message,
  className = '',
}: {
  /** 沒有可以相信的即時資料時 null（只畫格線） */
  data: RearRadarData | null;
  rangeM: number;
  detectRangeM: number;
  mirror: boolean;
  /** data 為 null 時畫在中間的說明 */
  message?: string;
  className?: string;
}) {
  const yOf = (d: number) => Y0 + (Math.min(Math.max(d, 0), detectRangeM) / detectRangeM) * (Y1 - Y0);
  const xOf = (lat: number) => W / 2 + (Math.max(-LAT_M, Math.min(LAT_M, lat)) / LAT_M) * (W / 2 - 14);
  const grid: number[] = [];
  for (let d = 5; d <= detectRangeM; d += 5) grid.push(d);
  const lead = data ? leadTarget(data) : null;
  const leadFill = data ? LEVEL_FILL[data.level] : 'var(--tint)';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={data ? describe(data) : (message ?? '後方雷達')} className={cx('h-full w-full', className)}>
      {/* 危險區（5 m 內）與車道示意 */}
      <rect x={4} y={Y0} width={W - 8} height={yOf(REAR_DANGER_DIST_M) - Y0} rx={6} fill="var(--bad)" fillOpacity={0.08} />
      {[-1.75, 1.75].map((lat) => (
        <line key={lat} x1={xOf(lat)} x2={xOf(lat)} y1={Y0} y2={Y1} stroke="var(--line-strong)" strokeDasharray="4 5" />
      ))}
      {/* 距離格線，警示距離用黃色虛線 */}
      {grid.map((d) => (
        <g key={d}>
          <line x1={4} x2={W - 4} y1={yOf(d)} y2={yOf(d)} stroke={d === rangeM ? 'var(--warn)' : 'var(--line)'} strokeDasharray={d === rangeM ? '6 4' : undefined} strokeWidth={d === rangeM ? 1.5 : 1} />
          <text x={6} y={yOf(d) - 3} fontSize={9} fill={d === rangeM ? 'var(--warn)' : 'var(--faint)'}>
            {d} m
          </text>
        </g>
      ))}
      {rangeM % 5 !== 0 && (
        <g>
          <line x1={4} x2={W - 4} y1={yOf(rangeM)} y2={yOf(rangeM)} stroke="var(--warn)" strokeDasharray="6 4" strokeWidth={1.5} />
          <text x={6} y={yOf(rangeM) - 3} fontSize={9} fill="var(--warn)">
            {rangeM} m
          </text>
        </g>
      )}

      {/* 腳踏車（前進方向朝上） */}
      <g transform={`translate(${W / 2}, ${Y0 - 14})`}>
        <rect x={-5} y={-9} width={10} height={20} rx={4} fill="var(--ink)" />
        <path d="M0 -15 L5 -10 L-5 -10 Z" fill="var(--ink)" />
      </g>

      {data ? (
        <>
          {data.targets.map((t, i) => {
            const approaching = t.speedKmh > 0;
            const isLead = t === lead;
            const x = xOf(lateralM(t, mirror));
            const y = yOf(t.distanceM);
            const beyond = t.distanceM > detectRangeM;
            return (
              <g key={i} style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 140ms linear' }} opacity={beyond ? 0.45 : 1}>
                <rect
                  x={-7}
                  y={-10}
                  width={14}
                  height={20}
                  rx={4}
                  fill={approaching ? (isLead ? leadFill : 'var(--tint)') : 'none'}
                  fillOpacity={approaching && !isLead ? 0.55 : 1}
                  stroke={approaching ? 'none' : 'var(--faint)'}
                  strokeWidth={1.5}
                />
                {isLead && (
                  <text x={x > W / 2 ? -12 : 12} y={4} fontSize={11} fontWeight={600} textAnchor={x > W / 2 ? 'end' : 'start'} fill={leadFill}>
                    {Math.round(t.distanceM)} m
                  </text>
                )}
              </g>
            );
          })}
          {data.targets.length === 0 && (
            <text x={W / 2} y={(Y0 + Y1) / 2} textAnchor="middle" fontSize={11} fill="var(--faint)">
              後方沒有來車
            </text>
          )}
        </>
      ) : (
        message && (
          <text x={W / 2} y={(Y0 + Y1) / 2} textAnchor="middle" fontSize={11} fill="var(--faint)">
            {message}
          </text>
        )
      )}
    </svg>
  );
}

function describe(d: RearRadarData): string {
  const approaching = d.targets.filter((t) => t.speedKmh > 0).length;
  if (approaching === 0) return '後方雷達：沒有靠近的車';
  return `後方雷達：${approaching} 個靠近的目標${d.distanceM !== null ? `，最近 ${Math.round(d.distanceM)} 公尺` : ''}`;
}

/**
 * 騎乘模式的直條：上端是腳踏車，後方的車越近點越往上。
 * 注意／危險時直條本身變成警示底色（黃、紅），點改成白色。
 * onRed：整個畫面已經是紅色（超速）時，危險改成白底紅點，才不會和背景混在一起。
 */
export function RearStrip({
  data,
  rangeM,
  detectRangeM,
  live,
  onRed = false,
  className = '',
}: {
  data: RearRadarData | null;
  rangeM: number;
  detectRangeM: number;
  live: boolean;
  onRed?: boolean;
  className?: string;
}) {
  const pct = (d: number) => 6 + (Math.min(Math.max(d, 0), detectRangeM) / detectRangeM) * 90;
  const level = live && data ? data.level : 'safe';
  const inverted = onRed && level === 'danger';
  const solid = level !== 'safe' && !inverted;
  const lead = data ? leadTarget(data) : null;
  return (
    <div
      role="img"
      aria-label={live && data ? describe(data) : '後方雷達沒有資料'}
      className={cx(
        'relative h-full w-full overflow-hidden rounded-[18px]', // 警示色立刻切換，不做漸變
        inverted ? 'bg-white' : level === 'danger' ? 'bg-bad-solid' : level === 'caution' ? 'bg-warn' : 'bg-surface',
        !live && 'opacity-50',
        className,
      )}
    >
      {/* 腳踏車 */}
      <span className={cx('absolute top-2 left-1/2 h-5 w-2.5 -translate-x-1/2 rounded-[4px]', inverted ? 'bg-bad-solid' : solid ? 'bg-white' : 'bg-ink')} />
      {/* 危險區、警示距離 */}
      <span className={cx('absolute inset-x-1 rounded-md', solid ? 'bg-white/20' : 'bg-bad/10')} style={{ top: `${pct(0)}%`, height: `${pct(REAR_DANGER_DIST_M) - pct(0)}%` }} />
      <span className={cx('absolute inset-x-1 border-t-2 border-dashed', solid ? 'border-white/70' : inverted ? 'border-bad/60' : 'border-warn')} style={{ top: `${pct(rangeM)}%` }} />
      {live &&
        data?.targets
          .filter((t) => t.speedKmh > 0)
          .map((t, i) => (
            <span
              key={i}
              className={cx(
                'absolute left-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[top] duration-150 ease-linear',
                inverted
                  ? t === lead
                    ? 'bg-bad-solid'
                    : 'bg-bad/50'
                  : solid
                    ? t === lead
                      ? 'bg-white'
                      : 'bg-white/60'
                    : t === lead
                      ? 'bg-tint'
                      : 'bg-tint/50',
              )}
              style={{ top: `${pct(t.distanceM)}%` }}
            />
          ))}
    </div>
  );
}
