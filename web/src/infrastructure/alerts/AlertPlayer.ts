/**
 * 【基礎設施層】發出警示：Web Audio 嗶聲、震動、中文語音。
 *
 * 瀏覽器規定：聲音必須在使用者點擊後才能播放，所以在「連線 / 測試警示」時呼叫 unlock()。
 * 不支援的功能（例如 iPhone 沒有震動）會自動略過，不會出錯。
 */
export interface ToneOptions {
  frequency: number;
  durationMs: number;
  volume: number; // 0 ~ 1
}

export class AlertPlayer {
  private context: AudioContext | null = null;

  /** 在使用者點擊時呼叫一次，之後才能自動播放聲音 */
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      this.context = null; // 不支援 Web Audio
    }
  }

  tone({ frequency, durationMs, volume }: ToneOptions, delayMs = 0): void {
    const ctx = this.context;
    if (!ctx || volume <= 0) return;
    const start = ctx.currentTime + delayMs / 1000;
    const end = start + durationMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    // 前後各 10 ms 淡入淡出，避免「啪」聲
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume * 0.3, start + 0.01);
    gain.gain.setValueAtTime(volume * 0.3, Math.max(start + 0.01, end - 0.01));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  vibrate(pattern: number | number[]): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Chrome 規定使用者點過畫面後才能震動
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  }

  /** 用中文語音播報；找不到中文語音就不念（避免用英文念出奇怪的聲音） */
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const voices = speechSynthesis.getVoices();
    const voice =
      voices.find((v) => v.lang === 'zh-TW') ?? voices.find((v) => v.lang.startsWith('zh')) ?? null;
    if (!voice && voices.length > 0) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = voice?.lang ?? 'zh-TW';
    if (voice) utterance.voice = voice;
    utterance.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  stop(): void {
    this.vibrate(0);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }
}
