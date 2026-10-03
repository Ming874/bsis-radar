/**
 * 【應用層】把狀態整理成畫面要的樣子（純函式，可單元測試）。
 */
import type { RadarState } from './radarStore';

export type SafetyTone = 'idle' | 'connecting' | 'offline' | 'stale' | 'safe' | 'caution' | 'danger';

export interface SafetyView {
  tone: SafetyTone;
  title: string;
  detail: string;
}

export function selectSafety(s: Pick<RadarState, 'connection' | 'stale' | 'telemetry'>): SafetyView {
  const { status, attempt, error } = s.connection;
  if (status === 'idle') return { tone: 'idle', title: '未連線', detail: '按「連線雷達」開始' };
  if (status === 'disconnected') return { tone: 'idle', title: '已中斷', detail: error ?? '請重新連線' };
  if (status === 'connecting') {
    return { tone: 'connecting', title: '連線中…', detail: '請在跳出的視窗選擇 RadarA-ESP32' };
  }
  if (status === 'reconnecting') {
    return { tone: 'offline', title: '重新連線中', detail: `第 ${attempt ?? 1} 次嘗試，請確認 ESP32 有電且在附近` };
  }

  if (s.stale) return { tone: 'stale', title: '資料中斷', detail: '超過 1.5 秒沒有收到 ESP32 的資料' };
  const t = s.telemetry;
  if (!t) return { tone: 'connecting', title: '等待資料…', detail: '已連線，等待第一筆雷達資料' };
  if (!t.radarOnline) return { tone: 'offline', title: '雷達離線', detail: 'ESP32 正在重新初始化雷達，請檢查接線' };

  const where = t.distanceM === null ? '' : `距離 ${t.distanceM.toFixed(1)} m`;
  const when = t.ttcS === null ? '' : `，約 ${t.ttcS.toFixed(1)} 秒後到達`;
  if (t.level === 2) return { tone: 'danger', title: '危險：快速接近', detail: `${where}${when}` };
  if (t.level === 1) return { tone: 'caution', title: '注意：後方來車', detail: `${where}${when}` };
  return {
    tone: 'safe',
    title: '安全',
    detail: t.distanceM === null ? '後方沒有接近中的車輛' : `有目標在 ${t.distanceM.toFixed(0)} m 外接近，尚未進入警示範圍`,
  };
}

/** 最近 windowMs 內的最大反射能量（校正用） */
export function selectEnergyPeak(s: Pick<RadarState, 'history' | 'telemetry'>, windowMs = 10_000): number {
  const end = s.telemetry?.receivedAt;
  if (end === undefined) return 0;
  return s.history.reduce((max, p) => (p.t >= end - windowMs && p.energy > max ? p.energy : max), 0);
}
