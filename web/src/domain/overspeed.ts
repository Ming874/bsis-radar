/**
 * 【領域層】超速判斷：對地速度持續達到速限才進入超速，降到「速限 − 遲滯」以下一段時間才解除，
 * 速度在速限附近抖動時不會一直切換。依據與參數見 docs/SPEED_ALERT.md。
 *
 * 只用雷達的估計值（輪速感測器只是參考值）。量不到速度時不判斷超速，畫面另外顯示訊號狀態。
 */
import type { Telemetry } from './types';

/** 解除的遲滯：降到速限 − 1 km/h 以下才算回到速限內 */
export const OVERSPEED_HYSTERESIS_MPS = 1 / 3.6;
/** 進入：持續達到速限 0.5 秒（約 5 筆資料框） */
export const OVERSPEED_ENTER_MS = 500;
/** 解除：持續低於速限 − 遲滯 1 秒 */
export const OVERSPEED_EXIT_MS = 1000;
/** 速限允許範圍（km/h） */
export const SPEED_LIMIT_KMH = { min: 5, max: 60 } as const;

export interface OverspeedState {
  active: boolean;
  since: number | null; // 這次超速開始的時間（進入條件開始成立的時刻）
  pendingSince: number | null; // 進入或解除條件開始成立的時間
}

export const NO_OVERSPEED: OverspeedState = { active: false, since: null, pendingSince: null };

/**
 * 一筆遙測對超速判斷的意義：
 * over 達到速限、under 低於速限 − 遲滯、hold 維持現狀（遲滯帶內、保持中）、unknown 量不到速度（立即解除）
 */
export type OverspeedEvidence = 'over' | 'under' | 'hold' | 'unknown';

/**
 * @param unambiguousMps 雷達不折疊的最高對地速度；「超出測速上限」只有在它不低於速限時才代表一定超速
 */
export function overspeedEvidence(
  t: Pick<Telemetry, 'state' | 'speedMps'>,
  limitMps: number,
  unambiguousMps: number | null,
): OverspeedEvidence {
  switch (t.state) {
    case 'tracking':
      if (t.speedMps === null) return 'unknown';
      if (t.speedMps >= limitMps) return 'over';
      return t.speedMps < limitMps - OVERSPEED_HYSTERESIS_MPS ? 'under' : 'hold';
    case 'holding':
      return 'hold'; // 韌體沿用估計值最多 2 秒：已在超速就維持，但不據此進入
    case 'overRange':
      return unambiguousMps !== null && unambiguousMps >= limitMps ? 'over' : 'unknown';
    case 'stopped':
    case 'acquiring':
    case 'lost':
    case 'noRadar':
      return 'unknown';
  }
}

/** 依時間推進一步（at 為這筆遙測收到的時間，ms） */
export function stepOverspeed(prev: OverspeedState, evidence: OverspeedEvidence, at: number): OverspeedState {
  if (evidence === 'unknown') return NO_OVERSPEED;
  const wantsChange = prev.active ? evidence === 'under' : evidence === 'over';
  if (!wantsChange) return prev.pendingSince === null ? prev : { ...prev, pendingSince: null };

  const pendingSince = prev.pendingSince ?? at;
  const dwell = prev.active ? OVERSPEED_EXIT_MS : OVERSPEED_ENTER_MS;
  if (at - pendingSince < dwell) return prev.pendingSince === pendingSince ? prev : { ...prev, pendingSince };
  return prev.active ? NO_OVERSPEED : { active: true, since: pendingSince, pendingSince: null };
}
