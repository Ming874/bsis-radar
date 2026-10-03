/**
 * 【領域層】從遙測串流整理出「來車事件」。
 *
 * 等級 ≥ 1 時事件開始；等級回到 0 並持續 endHoldMs 才算結束
 * （避免同一台車因短暫掉資料被拆成兩筆）。
 */
import type { AlertLevel, ApproachEvent, Telemetry } from './types';

interface Draft {
  startedAt: number;
  lastWarnAt: number;
  minDistanceM: number | null;
  maxClosingMps: number | null;
  minTtcS: number | null;
  maxLevel: AlertLevel;
}

const minOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const maxOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

export class EventTracker {
  private draft: Draft | null = null;

  constructor(private readonly endHoldMs = 1500) {}

  get active(): boolean {
    return this.draft !== null;
  }

  /** 餵入一筆遙測；若剛好有事件結束就回傳它 */
  update(t: Telemetry): ApproachEvent | null {
    if (t.level > 0) {
      const d = this.draft ?? {
        startedAt: t.receivedAt,
        lastWarnAt: t.receivedAt,
        minDistanceM: null,
        maxClosingMps: null,
        minTtcS: null,
        maxLevel: 0 as AlertLevel,
      };
      d.lastWarnAt = t.receivedAt;
      d.minDistanceM = minOrNull(d.minDistanceM, t.distanceM);
      d.maxClosingMps = maxOrNull(d.maxClosingMps, t.closingMps);
      d.minTtcS = minOrNull(d.minTtcS, t.ttcS);
      if (t.level > d.maxLevel) d.maxLevel = t.level;
      this.draft = d;
      return null;
    }
    if (this.draft && t.receivedAt - this.draft.lastWarnAt >= this.endHoldMs) return this.finish();
    return null;
  }

  /** 強制結束進行中的事件（例如斷線時） */
  flush(): ApproachEvent | null {
    return this.draft ? this.finish() : null;
  }

  private finish(): ApproachEvent {
    const d = this.draft as Draft;
    this.draft = null;
    return {
      id: `${d.startedAt}`,
      startedAt: d.startedAt,
      endedAt: d.lastWarnAt,
      durationS: Math.max(0, (d.lastWarnAt - d.startedAt) / 1000),
      minDistanceM: d.minDistanceM,
      maxClosingMps: d.maxClosingMps,
      minTtcS: d.minTtcS,
      maxLevel: d.maxLevel,
    };
  }
}
