/**
 * 【基礎設施層】警示輸出：提示音（Web Audio）與震動（Vibration API）。
 *
 * 瀏覽器只允許在使用者操作（點擊、按鍵）之後發出聲音，所以在第一次操作時建立 AudioContext，之後才能自動響。
 * 連線一定要按「連線」，騎車前就已經解鎖。震動只有 Android Chrome 支援（iOS 沒有 Vibration API）。
 */
type AudioContextClass = typeof AudioContext;

const TONE_HZ = 2000; // 人耳最敏感的 2～5 kHz，手機喇叭在這一段的效率也高；風切聲集中在低頻
const BEEP_S = 0.15;
const BEEP_GAP_S = 0.1;
const PEAK_GAIN = 0.3;
const VIBRATION_MS = [200, 100, 200];

function audioContextClass(): AudioContextClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AlertOutput {
  private ctx: AudioContext | null = null;
  readonly soundSupported = audioContextClass() !== null;
  readonly vibrateSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  constructor() {
    if (typeof window !== 'undefined' && this.soundSupported) {
      const unlock = () => void this.unlock();
      window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
      window.addEventListener('keydown', unlock, { capture: true });
    }
  }

  /** 在使用者操作當下呼叫：建立或恢復 AudioContext（系統中斷音訊後也會變成暫停） */
  async unlock(): Promise<void> {
    const Ctx = audioContextClass();
    if (!Ctx) return;
    try {
      this.ctx ??= new Ctx();
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch {
      // 瀏覽器拒絕時就不響，畫面上的警示不受影響
    }
  }

  /** 兩聲短嗶；還沒解鎖時不響 */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    for (let i = 0; i < 2; i++) {
      const at = t0 + i * (BEEP_S + BEEP_GAP_S);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = TONE_HZ;
      // 前後 10 ms 的斜坡，避免爆音
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.01);
      gain.gain.setValueAtTime(PEAK_GAIN, at + BEEP_S - 0.01);
      gain.gain.linearRampToValueAtTime(0, at + BEEP_S);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + BEEP_S);
    }
  }

  vibrate(): void {
    if (this.vibrateSupported) navigator.vibrate(VIBRATION_MS);
  }
}
