/**
 * 【基礎設施層】保持螢幕常亮（Screen Wake Lock API）。
 * 騎車時手機裝在龍頭上，螢幕關掉網頁就會被瀏覽器暫停，所以連線期間要保持常亮。
 * 切到背景時瀏覽器會自動釋放，回到前景再重新取得。
 */
export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
      });
    }
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  setEnabled(enabled: boolean): void {
    this.wanted = enabled;
    if (enabled) void this.acquire();
    else void this.release();
  }

  private async acquire(): Promise<void> {
    if (!this.supported || this.sentinel || document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      this.sentinel = null; // 省電模式等情況會被拒絕，不影響其他功能
    }
  }

  private async release(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    await s?.release().catch(() => undefined);
  }
}
