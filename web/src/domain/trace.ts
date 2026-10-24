/**
 * 【領域層】行程的速度曲線：把 10 Hz 的遙測壓成固定間隔的平均速度，存進行程紀錄，給「行程」頁畫圖與匯出。
 *
 * - 每一格是那段時間內對地速度的平均（cm/s 整數，JSON 小）；那段時間沒有收到遙測（藍牙中斷）記 GAP，畫圖時斷開
 * - 點數到 MAX_TRACE_POINTS 時兩兩合併、間隔加倍：一小時的行程約 450～900 點，存 50 筆行程也不到 200 KB
 * - 量不到速度（訊號中斷）的那一筆不算進平均；整格都量不到也記 GAP
 */
import type { Telemetry } from './types';

/** 沒有資料的一格 */
export const GAP = -1;
/** 一開始的間隔（秒） */
export const TRACE_STEP_S = 1;
export const MAX_TRACE_POINTS = 900;

export interface TripTrace {
  stepS: number;
  /** 每一格的平均速度（cm/s），GAP 表示沒有資料 */
  v: number[];
}

/** 兩個平均合併（其中一個沒有資料就用另一個） */
function merge(a: number, b: number): number {
  if (a === GAP) return b;
  if (b === GAP) return a;
  return Math.round((a + b) / 2);
}

function halve(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.length; i += 2) out.push(merge(v[i] ?? GAP, v[i + 1] ?? GAP));
  return out;
}

export class TraceBuilder {
  private stepS = TRACE_STEP_S;
  private v: number[] = []; // 已經結束的格子
  private startAt: number | null = null;
  private bucket = -1; // 正在累計的格子（一定等於 v.length）
  private sum = 0;
  private n = 0;
  private carry = GAP; // 合併時這一格的前半已經算好的平均

  reset(): void {
    this.stepS = TRACE_STEP_S;
    this.v = [];
    this.startAt = null;
    this.bucket = -1;
    this.sum = 0;
    this.n = 0;
    this.carry = GAP;
  }

  /** 從存檔接續（重新整理頁面後）；之後的格子從 resumeAt 往後算 */
  restore(trace: TripTrace, resumeAt: number): void {
    this.reset();
    this.stepS = trace.stepS;
    this.v = [...trace.v];
    this.startAt = resumeAt - this.v.length * this.stepS * 1000;
  }

  update(t: Pick<Telemetry, 'receivedAt' | 'speedMps'>): void {
    this.startAt ??= t.receivedAt;
    const index = Math.floor((t.receivedAt - this.startAt) / (this.stepS * 1000));
    if (index < this.v.length) return; // 時間倒退（不會發生，保險）
    if (index !== this.bucket) {
      if (this.bucket >= 0) this.v.push(this.current());
      this.sum = 0;
      this.n = 0;
      this.carry = GAP;
      while (this.v.length < index) this.v.push(GAP); // 中間沒收到遙測的格子
      this.bucket = index;
      while (this.v.length >= MAX_TRACE_POINTS) this.halveAll();
    }
    if (t.speedMps !== null && Number.isFinite(t.speedMps)) {
      this.sum += t.speedMps;
      this.n += 1;
    }
  }

  /** 目前的曲線（含正在累計的這一格） */
  snapshot(): TripTrace {
    return { stepS: this.stepS, v: this.bucket >= 0 ? [...this.v, this.current()] : [...this.v] };
  }

  private current(): number {
    return merge(this.carry, this.n > 0 ? Math.round((this.sum / this.n) * 100) : GAP);
  }

  /** 已結束的格子兩兩合併；個數是奇數時，最後一格和正在累計的這一格合成一格 */
  private halveAll(): void {
    if (this.v.length % 2 === 1) this.carry = this.v.pop() ?? GAP;
    this.v = halve(this.v);
    this.stepS *= 2;
    this.bucket = this.v.length;
  }
}

/** 曲線轉成 { 秒, m/s }，GAP 為 null（畫圖、匯出用） */
export function tracePoints(trace: TripTrace): Array<{ s: number; mps: number | null }> {
  return trace.v.map((cm, i) => ({ s: i * trace.stepS, mps: cm === GAP ? null : cm / 100 }));
}

/** 存檔讀回來的曲線是否合理（壞掉的就不顯示） */
export function isTrace(value: unknown): value is TripTrace {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<TripTrace>;
  return typeof t.stepS === 'number' && t.stepS > 0 && Array.isArray(t.v) && t.v.every((x) => typeof x === 'number' && Number.isFinite(x));
}
