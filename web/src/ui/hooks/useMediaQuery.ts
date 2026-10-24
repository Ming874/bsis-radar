/**
 * 【UI 層】螢幕寬度等條件符合時為 true（跟著視窗縮放更新）。
 */
import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 電腦版版面（左欄＋多欄） */
export const DESKTOP = '(min-width: 1024px)';
