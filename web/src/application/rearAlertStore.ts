/**
 * 【應用層】後方來車提示：依每一行 REAR 決定要不要響（聲音、震動、語音由 container.ts 注入）。
 * 等級由韌體判斷；提示的頻率規則在領域層 rear.ts。
 */
import { createStore } from 'zustand/vanilla';
import { NO_REAR_CUE, stepRearCue, type RearCue, type RearCueState } from '../domain/rear';
import type { RearTelemetry } from '../domain/types';

export interface RearAlertStore {
  /** 最後一次提示（畫面可用來閃一下） */
  lastCue: { cue: RearCue; at: number } | null;
  onRear: (rear: RearTelemetry) => void;
  /** 關閉警示、斷線、資料中斷時呼叫 */
  reset: () => void;
}

export interface RearAlertStoreDeps {
  cue: (cue: RearCue, rear: RearTelemetry) => void;
}

export function createRearAlertStore(deps: RearAlertStoreDeps) {
  let state: RearCueState = NO_REAR_CUE;
  return createStore<RearAlertStore>()((set) => ({
    lastCue: null,
    onRear: (rear) => {
      const step = stepRearCue(state, rear, rear.receivedAt);
      state = step.state;
      if (step.cue) {
        set({ lastCue: { cue: step.cue, at: rear.receivedAt } });
        deps.cue(step.cue, rear);
      }
    },
    reset: () => {
      state = NO_REAR_CUE;
    },
  }));
}
