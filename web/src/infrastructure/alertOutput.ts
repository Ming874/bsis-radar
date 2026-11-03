/**
 * 【基礎設施層】警示輸出：提示音（Web Audio）、震動（Vibration API）、語音（Web Speech）。
 *
 * 瀏覽器只允許在使用者操作（點擊、按鍵）之後發出聲音，所以在第一次操作時建立 AudioContext，之後才能自動響。
 * 連線一定要按「連線」，騎車前就已經解鎖。震動只有 Android Chrome 支援（iOS 沒有 Vibration API）。
 *
 * 三種提示聽起來不一樣，不看螢幕也分得出來：
 *   超速       2 kHz 方波兩聲
 *   後方注意   1.4 kHz 正弦兩聲（柔和）
 *   後方危險   2.8 kHz 方波四聲急促（最刺耳，最高優先）
 */
type AudioContextClass = typeof AudioContext;

interface TonePattern {
  hz: number;
  beeps: number;
  beepS: number;
  gapS: number;
  wave: OscillatorType;
  gain: number;
}

// 人耳最敏感的 2～5 kHz，手機喇叭在這一段的效率也高；風切聲集中在低頻
const OVERSPEED: TonePattern = { hz: 2000, beeps: 2, beepS: 0.15, gapS: 0.1, wave: 'square', gain: 0.3 };
const REAR_CAUTION: TonePattern = { hz: 1400, beeps: 2, beepS: 0.12, gapS: 0.08, wave: 'sine', gain: 0.45 };
const REAR_DANGER: TonePattern = { hz: 2800, beeps: 4, beepS: 0.08, gapS: 0.05, wave: 'square', gain: 0.32 };
const VIBRATION_MS = [200, 100, 200];
const REAR_CAUTION_VIBRATION_MS = [120];
const REAR_DANGER_VIBRATION_MS = [300, 80, 300, 80, 300];

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

  private play(p: TonePattern): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    for (let i = 0; i < p.beeps; i++) {
      const at = t0 + i * (p.beepS + p.gapS);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = p.wave;
      osc.frequency.value = p.hz;
      // 前後 10 ms 的斜坡，避免爆音
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(p.gain, at + 0.01);
      gain.gain.setValueAtTime(p.gain, at + p.beepS - 0.01);
      gain.gain.linearRampToValueAtTime(0, at + p.beepS);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + p.beepS);
    }
  }

  /** 超速：兩聲短嗶；還沒解鎖時不響 */
  chime(): void {
    this.play(OVERSPEED);
  }

  /** 後方來車：注意（柔和兩聲）或危險（急促四聲） */
  rearChime(level: 'caution' | 'danger'): void {
    this.play(level === 'danger' ? REAR_DANGER : REAR_CAUTION);
  }

  vibrate(): void {
    if (this.vibrateSupported) navigator.vibrate(VIBRATION_MS);
  }

  rearVibrate(level: 'caution' | 'danger'): void {
    if (this.vibrateSupported) navigator.vibrate(level === 'danger' ? REAR_DANGER_VIBRATION_MS : REAR_CAUTION_VIBRATION_MS);
  }

  readonly speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

  /** 語音提示（繁體中文）；上一句還沒講完就取消，避免越積越多 */
  speak(text: string): void {
    if (!this.speechSupported) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-TW';
      u.rate = 1.2;
      u.volume = 1;
      synth.speak(u);
    } catch {
      // 瀏覽器拒絕時就不講，畫面上的警示不受影響
    }
  }
}
