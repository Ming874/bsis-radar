/**
 * 【UI 層】安裝幾何示意圖：雷達高度 h、俯角 θ、視軸打在地面的位置與地面距離窗口，依目前參數即時繪製。
 */
import { groundWindow } from '../../domain/protocol';

const W = 360;
const H = 170;
const GROUND = 140;

export function MountDiagram({ angleDeg, heightM, direction }: { angleDeg: number; heightM: number; direction: 1 | -1 }) {
  const valid = Number.isFinite(angleDeg) && Number.isFinite(heightM) && angleDeg > 5 && angleDeg < 85 && heightM > 0;
  const a = valid ? angleDeg : 45;
  const hM = valid ? heightM : 0.7;
  const rad = (d: number) => (d * Math.PI) / 180;

  // 地面窗口的兩端俯角（與韌體相同：+30° / −25°）
  const steep = Math.min(85, a + 30);
  const shallow = Math.max(8, a - 25);
  const near = hM / Math.tan(rad(steep));
  const far = Math.min(hM / Math.tan(rad(shallow)), 4.5);
  const center = hM / Math.tan(rad(a));

  // 比例：高度與最遠距離都放得下
  const scale = Math.min(95 / hM, (W - 130) / far);
  const sign = -direction; // 朝後（DIR = 1）時波束往左（後方）；畫面上車往右前進
  const rx = direction === 1 ? W - 110 : 110;
  const ry = GROUND - hM * scale;
  const gx = (m: number) => rx + sign * m * scale;
  const wheelR = Math.min(0.34 * scale, 42);
  const w = groundWindow(a, hM);

  // 俯角的弧
  const arcR = 34;
  const ax = rx + sign * arcR;
  const bx = rx + sign * arcR * Math.cos(rad(a));
  const by = ry + arcR * Math.sin(rad(a));
  const sweep = direction === 1 ? 0 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`安裝示意：高度 ${hM.toFixed(2)} m、俯角 ${a.toFixed(0)}°`} className="h-auto w-full">
      {/* 地面 */}
      <line x1={8} x2={W - 8} y1={GROUND} y2={GROUND} stroke="var(--line-strong)" strokeWidth={1.5} />
      {/* 車輪（示意）：讓朝向一目了然 */}
      <circle cx={rx - sign * (wheelR + 12)} cy={GROUND - wheelR} r={wheelR} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} />
      {/* 波束（地面窗口） */}
      <polygon points={`${rx},${ry} ${gx(near)},${GROUND} ${gx(far)},${GROUND}`} fill="var(--tint)" fillOpacity={0.12} stroke="var(--tint)" strokeOpacity={0.35} />
      <line x1={rx} y1={ry} x2={gx(center)} y2={GROUND} stroke="var(--tint)" strokeWidth={1.5} strokeDasharray="5 4" />
      {/* 雷達本體 */}
      <rect x={rx - 7} y={ry - 7} width={14} height={14} rx={2} fill="var(--surface)" stroke="var(--ink)" strokeWidth={1.5} />
      {/* 水平參考線與俯角弧 */}
      <line x1={rx} y1={ry} x2={rx + sign * (arcR + 14)} y2={ry} stroke="var(--faint)" strokeDasharray="2 3" />
      <path d={`M${ax},${ry} A${arcR},${arcR} 0 0 ${sweep} ${bx},${by}`} fill="none" stroke="var(--ink)" />
      <text x={rx + sign * (arcR + 18)} y={ry + 16} textAnchor={direction === 1 ? 'end' : 'start'} fontSize={12} fill="var(--ink)">
        θ = {a.toFixed(1)}°
      </text>
      {/* 高度：雷達正下方的鉛直線，標註放在波束這一側 */}
      <line x1={rx} y1={ry + 8} x2={rx} y2={GROUND} stroke="var(--faint)" strokeDasharray="2 3" />
      <text x={rx + sign * 8} y={ry + (GROUND - ry) * 0.62} textAnchor={direction === 1 ? 'end' : 'start'} fontSize={12} fill="var(--ink)">
        h = {hM.toFixed(2)} m
      </text>
      {/* 地面窗口標註 */}
      <text x={(gx(near) + gx(far)) / 2} y={GROUND + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
        斜距 {w.minM.toFixed(2)}～{w.maxM.toFixed(2)} m · 視軸 {w.boresightM.toFixed(2)} m
      </text>
      {/* 前進方向 */}
      <g fill="var(--faint)" fontSize={11}>
        <text x={W - 10} y={18} textAnchor="end">
          前進 →
        </text>
      </g>
    </svg>
  );
}
