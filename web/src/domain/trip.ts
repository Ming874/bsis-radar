/**
 * 【領域層】行程統計：里程、移動時間、平均與最高速度。
 *
 * 里程用韌體的雷達里程（DR）差值累加：韌體以 10 Hz 積分，藍牙斷線期間也照算，
 * 比網頁自己用 5～10 Hz 的速度積分準確。韌體重新開機（開機秒數或 DR 變小）時重新對齊，不會出現負的距離。
 * 超速時間與次數依呼叫端傳入的超速狀態累計（判斷見 overspeed.ts）。
 */
import { isTrace, type TripTrace } from './trace';
import type { Telemetry } from './types';

/** 速度高於這個值才算「在移動」（移動時間、平均速度用） */
export const MOVING_MPS = 0.5;
/** 兩筆遙測間隔超過這個值（藍牙中斷）不計入移動時間 */
const MAX_GAP_S = 2;

export interface TripSnapshot {
  startedAt: number;
  distanceM: number;
  movingS: number;
  maxMps: number;
  wheelDistanceM: number | null;
  overspeedS: number; // 超過速限的累計時間
  overspeedCount: number; // 進入超速的次數
}

/** 存在行程紀錄裡的一筆（網頁 2.1 以前沒有超速欄位，3.0 以前沒有速度曲線與速限） */
export type SavedTrip = Omit<TripSnapshot, 'overspeedS' | 'overspeedCount'> &
  Partial<Pick<TripSnapshot, 'overspeedS' | 'overspeedCount'>> & {
    id: string;
    endedAt: number;
    trace?: TripTrace;
    /** 結束時的速限（km/h）；沒開超速警示時 null */
    limitKmh?: number | null;
  };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 讀回來（localStorage、匯入的備份）的一筆行程是否合理；缺的選用欄位當作沒有 */
export function isSavedTrip(value: unknown): value is SavedTrip {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    finite(t.startedAt) &&
    finite(t.endedAt) &&
    finite(t.distanceM) &&
    t.distanceM >= 0 &&
    finite(t.movingS) &&
    t.movingS >= 0 &&
    finite(t.maxMps) &&
    (t.wheelDistanceM === null || t.wheelDistanceM === undefined || finite(t.wheelDistanceM)) &&
    (t.overspeedS === undefined || finite(t.overspeedS)) &&
    (t.overspeedCount === undefined || finite(t.overspeedCount)) &&
    (t.trace === undefined || isTrace(t.trace)) &&
    (t.limitKmh === undefined || t.limitKmh === null || finite(t.limitKmh))
  );
}

/** 存檔用：統計加上對齊的基準值（重新整理頁面後接續，韌體沒重開機時中間騎的距離也算得到） */
export interface TripMeterState extends TripSnapshot {
  lastDr: number | null;
  lastDw: number | null;
  lastUptime: number;
}

export class TripMeter {
  private startedAt: number;
  private distanceM = 0;
  private movingS = 0;
  private maxMps = 0;
  private wheelDistanceM: number | null = null;
  private overspeedS = 0;
  private overspeedCount = 0;
  private lastOverspeed = false;
  private lastDr: number | null = null;
  private lastDw: number | null = null;
  private lastUptime = -1;
  private lastAt: number | null = null;

  constructor(now: number) {
    this.startedAt = now;
  }

  reset(now: number): void {
    this.startedAt = now;
    this.distanceM = 0;
    this.movingS = 0;
    this.maxMps = 0;
    this.wheelDistanceM = null;
    this.overspeedS = 0;
    this.overspeedCount = 0;
    this.lastOverspeed = false; // 重設時正在超速：算進新行程的第一次
    // 基準值保留：重設後從下一筆的差值開始累加
    this.lastAt = null;
  }

  /** 接續存檔的行程；移動時間從下一筆遙測開始算 */
  restore(s: TripMeterState): void {
    this.startedAt = s.startedAt;
    this.distanceM = s.distanceM;
    this.movingS = s.movingS;
    this.maxMps = s.maxMps;
    this.wheelDistanceM = s.wheelDistanceM;
    this.overspeedS = s.overspeedS;
    this.overspeedCount = s.overspeedCount;
    this.lastOverspeed = false;
    this.lastDr = s.lastDr;
    this.lastDw = s.lastDw;
    this.lastUptime = s.lastUptime;
    this.lastAt = null;
  }

  save(): TripMeterState {
    return { ...this.snapshot(), lastDr: this.lastDr, lastDw: this.lastDw, lastUptime: this.lastUptime };
  }

  update(t: Telemetry, overspeed = false): void {
    const restarted = t.uptimeS < this.lastUptime;
    if (this.lastDr !== null && !restarted && t.radarDistanceM >= this.lastDr) {
      this.distanceM += t.radarDistanceM - this.lastDr;
    }
    this.lastDr = t.radarDistanceM;

    if (t.wheelDistanceM !== null) {
      if (this.lastDw !== null && !restarted && t.wheelDistanceM >= this.lastDw) {
        this.wheelDistanceM = (this.wheelDistanceM ?? 0) + (t.wheelDistanceM - this.lastDw);
      } else if (this.wheelDistanceM === null) {
        this.wheelDistanceM = 0;
      }
      this.lastDw = t.wheelDistanceM;
    }
    this.lastUptime = t.uptimeS;

    const speed = t.speedMps ?? 0;
    if (this.lastAt !== null) {
      const dt = (t.receivedAt - this.lastAt) / 1000;
      if (dt > 0 && dt <= MAX_GAP_S && speed >= MOVING_MPS) this.movingS += dt;
      if (dt > 0 && dt <= MAX_GAP_S && overspeed && this.lastOverspeed) this.overspeedS += dt;
    }
    if (overspeed && !this.lastOverspeed) this.overspeedCount++;
    this.lastOverspeed = overspeed;
    this.lastAt = t.receivedAt;
    if (t.state === 'tracking' && speed > this.maxMps) this.maxMps = speed;
  }

  snapshot(): TripSnapshot {
    return {
      startedAt: this.startedAt,
      distanceM: this.distanceM,
      movingS: this.movingS,
      maxMps: this.maxMps,
      wheelDistanceM: this.wheelDistanceM,
      overspeedS: this.overspeedS,
      overspeedCount: this.overspeedCount,
    };
  }
}

/** 平均移動速度（m/s）：里程 ÷ 移動時間；還沒移動時 null */
export function averageMps(trip: Pick<TripSnapshot, 'distanceM' | 'movingS'>): number | null {
  return trip.movingS >= 1 ? trip.distanceM / trip.movingS : null;
}

export interface TripTotals {
  count: number;
  distanceM: number;
  movingS: number;
  maxMps: number;
  longestM: number;
  /** 全部行程的平均移動速度（總里程 ÷ 總移動時間） */
  avgMps: number | null;
}

/** 行程紀錄的累計（「行程」頁上方） */
export function summarizeTrips(trips: Array<Pick<TripSnapshot, 'distanceM' | 'movingS' | 'maxMps'>>): TripTotals {
  let distanceM = 0;
  let movingS = 0;
  let maxMps = 0;
  let longestM = 0;
  for (const t of trips) {
    distanceM += t.distanceM;
    movingS += t.movingS;
    maxMps = Math.max(maxMps, t.maxMps);
    longestM = Math.max(longestM, t.distanceM);
  }
  return { count: trips.length, distanceM, movingS, maxMps, longestM, avgMps: averageMps({ distanceM, movingS }) };
}
