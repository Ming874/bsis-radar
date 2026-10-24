/**
 * 【設計系統】共用的小工具：組 className、觸覺回饋、焦點框（元件以外的匯出放在這裡，熱更新才正常）。
 */

export const cx = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(' ');

/** 鍵盤操作時的焦點框（滑鼠、觸控點擊時不顯示） */
export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-tint focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
/** 整列寬的按鈕在 overflow-hidden 的卡片裡：焦點框畫在裡面才不會被切掉 */
export const FOCUS_RING_INSET = 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tint';

let hapticsEnabled = true;

/** 設定頁的「觸覺回饋」開關 */
export function setHaptics(enabled: boolean): void {
  hapticsEnabled = enabled;
}

/** 按鍵的觸覺回饋：Android 震一下（iPhone 的瀏覽器沒有震動功能） */
export function haptic(style: 'light' | 'medium' = 'light'): void {
  if (!hapticsEnabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(style === 'medium' ? 16 : 8);
  } catch {
    // 有些瀏覽器在還沒互動前會丟錯，略過
  }
}
