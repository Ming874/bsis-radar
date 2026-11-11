/**
 * 【領域層】後方來車：提示規則與顯示用的換算（純函式，可單元測試）。
 *
 * 等級（安全／注意／危險）由韌體判斷（src/core/RearThreat，依據見 docs/REAR_RADAR.md）；
 * 網頁只決定「什麼時候響、響幾次」，以及把雷達的相對量換算成騎士看得懂的數字：
 *   - 後車車速 ≈ 自己的對地速度（C4001）＋ 接近速度（LD2451）：兩顆雷達整合才算得出來
 *   - 左右位置 ≈ 距離 × sin（角度）：LD2451 的角度解析度 1°、準度有限，只當示意
 */
import type { RearLevel, RearTarget, RearTelemetry } from './types';

/** 超過這麼久沒收到 REAR 行：後方雷達的資料中斷（韌體離線時也每秒送一行 REAR ON=0） */
export const REAR_STALE_MS = 2500;
/** 危險持續、來車還在視野內時，每 1.5 秒再提示一次 */
export const DANGER_REPEAT_MS = 1500;
/** 注意在邊界反覆進出時，最多每 4 秒提示一次（畫面照常切換） */
export const CAUTION_COOLDOWN_MS = 4000;

const RANK: Record<RearLevel, number> = { safe: 0, caution: 1, danger: 2 };

export type RearCue = 'caution' | 'danger';

export interface RearCueState {
  level: RearLevel;
  lastCueAt: number;
  lastCautionAt: number;
}

export const NO_REAR_CUE: RearCueState = { level: 'safe', lastCueAt: -Infinity, lastCautionAt: -Infinity };

/**
 * 依一行後方狀態決定要不要提示：
 * - 等級升到危險 → 危險提示；危險持續、來車還在視野（不是保持中）→ 每 1.5 秒再一次
 * - 安全 → 注意 → 注意提示（4 秒內不重複）
 * - 等級下降、後方雷達離線 → 不提示
 */
export function stepRearCue(
  prev: RearCueState,
  rear: Pick<RearTelemetry, 'online' | 'level' | 'holding'>,
  at: number,
): { state: RearCueState; cue: RearCue | null } {
  if (!rear.online) return { state: NO_REAR_CUE, cue: null };
  const rising = RANK[rear.level] > RANK[prev.level];
  let cue: RearCue | null = null;
  if (rear.level === 'danger') {
    if (rising || (!rear.holding && at - prev.lastCueAt >= DANGER_REPEAT_MS)) cue = 'danger';
  } else if (rear.level === 'caution' && rising && at - prev.lastCautionAt >= CAUTION_COOLDOWN_MS) {
    cue = 'caution';
  }
  return {
    state: {
      level: rear.level,
      lastCueAt: cue ? at : prev.lastCueAt,
      lastCautionAt: cue === 'caution' ? at : prev.lastCautionAt,
    },
    cue,
  };
}

/** 語音提示的內容（短：騎車時聽得完） */
export function rearSpeech(cue: RearCue): string {
  return cue === 'danger' ? '後方來車，小心' : '後方有車';
}

/** 後車的對地速度（m/s）：自己的對地速度 + 接近速度；任一個不知道就 null */
export function vehicleSpeedMps(ownMps: number | null, closingMps: number | null): number | null {
  if (ownMps === null || closingMps === null) return null;
  return ownMps + closingMps;
}

/** 目標的左右位置（m，正 = 右邊）：距離 × sin（角度）；mirror 對調左右（LD2451 角度的正負要看安裝） */
export function lateralM(t: Pick<RearTarget, 'angleDeg' | 'distanceM'>, mirror: boolean): number {
  const x = t.distanceM * Math.sin((t.angleDeg * Math.PI) / 180);
  return mirror ? -x : x;
}

/** 主要來車對應的目標（距離最接近韌體濾波後距離的靠近目標）；沒有時 null */
export function leadTarget(rear: Pick<RearTelemetry, 'distanceM' | 'targets'>): RearTarget | null {
  if (rear.distanceM === null) return null;
  let best: RearTarget | null = null;
  for (const t of rear.targets) {
    if (t.speedKmh <= 0) continue;
    if (!best || Math.abs(t.distanceM - rear.distanceM) < Math.abs(best.distanceM - rear.distanceM)) best = t;
  }
  return best;
}

/** 警示次數的增量（ESP32 重新開機時計數歸零：當作從 0 開始） */
export function alertDelta(prev: number | null, next: number): number {
  if (prev === null) return 0;
  return next >= prev ? next - prev : next;
}
