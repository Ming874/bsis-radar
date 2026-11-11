/**
 * 【應用層】超速警示：依每一筆遙測更新超速狀態，進入超速時發出提示（聲音、震動由 container.ts 注入）。
 * 判斷規則在領域層 overspeed.ts；這裡只負責狀態與提示的頻率。
 */
import { createStore } from 'zustand/vanilla';
import { NO_OVERSPEED, overspeedEvidence, stepOverspeed, type OverspeedState } from '../domain/overspeed';
import type { Telemetry } from '../domain/types';

/** 在速限附近反覆進出時，提示最多每 5 秒一次（畫面上的警示照常切換） */
export const ALERT_COOLDOWN_MS = 5000;

export interface OverspeedStore {
  active: boolean;
  since: number | null; // 這次超速開始的時間
  /** @param unambiguousMps 雷達不折疊的最高對地速度（沒有裝置設定時 null） */
  onTelemetry: (t: Telemetry, limitMps: number, unambiguousMps: number | null) => void;
  /** 關閉警示、改速限、斷線或資料中斷時呼叫 */
  reset: () => void;
}

export interface OverspeedStoreDeps {
  /** 進入超速時呼叫（已套用冷卻時間） */
  alert: () => void;
}

export function createOverspeedStore(deps: OverspeedStoreDeps) {
  let state: OverspeedState = NO_OVERSPEED;
  let lastAlertAt = -Infinity;

  return createStore<OverspeedStore>()((set, get) => ({
    active: false,
    since: null,

    onTelemetry: (t, limitMps, unambiguousMps) => {
      const next = stepOverspeed(state, overspeedEvidence(t, limitMps, unambiguousMps), t.receivedAt);
      const entered = next.active && !state.active;
      state = next;
      if (next.active !== get().active || next.since !== get().since) set({ active: next.active, since: next.since });
      if (entered && t.receivedAt - lastAlertAt >= ALERT_COOLDOWN_MS) {
        lastAlertAt = t.receivedAt;
        deps.alert();
      }
    },

    reset: () => {
      state = NO_OVERSPEED;
      if (get().active) set({ active: false, since: null });
    },
  }));
}
