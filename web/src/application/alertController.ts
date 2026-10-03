/**
 * 【應用層】依目前狀態決定要不要「叫」：倒車雷達式嗶聲、震動、語音。
 *
 *   等級 0 → 1/2：嗶兩聲 + 震動 +「後方來車（12 公尺）」
 *   等級 ≥ 1    ：持續嗶聲，越近越快；危險時音調更高並每秒震動
 *   設定「只在危險時提醒」時，注意等級只在畫面顯示、不發聲
 *   雷達離線 / 資料中斷 / 意外斷線：長音 +「雷達離線」（每次事故只叫一次）
 */
import type { StoreApi } from 'zustand/vanilla';
import type { AlertPlayer } from '../infrastructure/alerts/AlertPlayer';
import type { RadarStore } from './radarStore';
import type { SettingsStore } from './settingsStore';

const TICK_MS = 50;
const CAUTION_TONE = 880;
const DANGER_TONE = 1400;

/** 嗶聲間隔：15 m 約 1 秒一聲，4 m 約 0.25 秒；危險時再快一些 */
export function beepIntervalMs(level: number, distanceM: number | null): number {
  const d = distanceM ?? 15;
  const ratio = Math.min(1, Math.max(0, (d - 4) / (15 - 4)));
  const base = 250 + ratio * 750;
  return level >= 2 ? Math.max(150, base * 0.6) : base;
}

export function playTestAlert(player: AlertPlayer, prefs: SettingsStore): void {
  player.unlock();
  const volume = prefs.sound ? prefs.volume : 0;
  player.tone({ frequency: CAUTION_TONE, durationMs: 120, volume });
  player.tone({ frequency: DANGER_TONE, durationMs: 120, volume }, 200);
  if (prefs.vibration) player.vibrate([150, 80, 150]);
  if (prefs.voice) player.speak('警示測試，後方來車');
}

export function startAlertController(
  radar: StoreApi<RadarStore>,
  settings: StoreApi<SettingsStore>,
  player: AlertPlayer,
): () => void {
  let prevLevel = 0;
  let nextBeepAt = 0;
  let lastVibrateAt = 0;
  let incidentActive = false;
  let radarWasOnline = false;

  const timer = setInterval(() => {
    const s = radar.getState();
    const prefs = settings.getState();
    const now = Date.now();
    const volume = prefs.sound ? prefs.volume : 0;
    const status = s.connection.status;
    const connected = status === 'connected';
    const t = s.telemetry;

    if (!connected) radarWasOnline = false;
    else if (t?.radarOnline) radarWasOnline = true;

    // ---- 系統異常：只有「本來好好的、後來壞掉」才叫，避免剛開機雷達還在初始化就亂叫
    const problem =
      (s.everConnected && (status === 'reconnecting' || status === 'disconnected')) ||
      (connected && s.stale) ||
      (connected && radarWasOnline && t?.radarOnline === false);
    if (problem && !incidentActive) {
      incidentActive = true;
      player.tone({ frequency: 440, durationMs: 600, volume });
      if (prefs.vibration) player.vibrate(400);
      if (prefs.voice) player.speak('雷達離線');
    } else if (!problem) {
      incidentActive = false;
    }

    // ---- 來車警示（依設定：注意就提醒，或只在危險時才發聲）
    const healthy = connected && !s.stale && t?.radarOnline === true;
    const threshold = prefs.alertMode === 'danger' ? 2 : 1;
    const level = healthy && t && t.level >= threshold ? t.level : 0;
    if (level > 0 && prevLevel === 0) {
      player.tone({ frequency: CAUTION_TONE, durationMs: 120, volume });
      player.tone({ frequency: CAUTION_TONE, durationMs: 120, volume }, 200);
      if (prefs.vibration) player.vibrate([150, 80, 150]);
      if (prefs.voice) {
        const distance = t?.distanceM;
        player.speak(prefs.speakDistance && distance != null ? `後方來車，${Math.round(distance)} 公尺` : '後方來車');
      }
      nextBeepAt = now + 400 + beepIntervalMs(level, t?.distanceM ?? null);
      lastVibrateAt = now;
    } else if (level > 0 && now >= nextBeepAt) {
      player.tone({ frequency: level >= 2 ? DANGER_TONE : CAUTION_TONE, durationMs: level >= 2 ? 90 : 110, volume });
      if (level >= 2 && prefs.vibration && now - lastVibrateAt >= 1000) {
        player.vibrate(200);
        lastVibrateAt = now;
      }
      nextBeepAt = now + beepIntervalMs(level, t?.distanceM ?? null);
    } else if (level === 0 && prevLevel > 0) {
      player.vibrate(0);
    }
    prevLevel = level;
  }, TICK_MS);

  return () => clearInterval(timer);
}
