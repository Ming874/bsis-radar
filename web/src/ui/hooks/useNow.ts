/**
 * 【UI 層】每秒更新一次的「現在時間」，給記錄時間等需要跳秒的顯示使用。
 * 用 useSyncExternalStore 共用同一個計時器，所有元件同步更新。
 */
import { useSyncExternalStore } from 'react';

let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}
