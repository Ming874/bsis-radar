/**
 * 【領域層】校正與驗證的計算（純函式，docs/ALGORITHM.md §7、§8）。
 *
 * 校正係數 CAL 讓「雷達量到的距離」等於「真實距離」：CAL_new = CAL_old × 真實 ÷ 雷達。
 * 用距離比而不是速度比：距離是速度的積分，雷達與參考值的時間落後、瞬間雜訊都會抵消。
 */
import { LIMITS } from './protocol';

/** 校正一趟的最短距離（m）：太短時起停誤差占比太大 */
export const MIN_CALIBRATION_M = 30;
/** 合理的校正變化：超過 ±40% 多半是設定或量測出錯（例如 DIR、ANGLE 不對） */
export const MAX_CAL_CHANGE = 0.4;

export interface CalibrationRun {
  id: string;
  method: 'distance' | 'wheel';
  at: number;
  radarM: number; // 這一趟雷達量到的距離（以當時的 CAL）
  referenceM: number; // 真實距離（捲尺量）或輪速感測器的距離
  calibrationUsed: number; // 這一趟期間的 CAL
}

export interface CalibrationResult {
  errorPct: number; // 雷達相對參考值的誤差（%）
  newCalibration: number;
}

export function evaluateRun(run: Pick<CalibrationRun, 'radarM' | 'referenceM' | 'calibrationUsed'>): CalibrationResult | null {
  if (!(run.radarM > 0) || !(run.referenceM > 0)) return null;
  return {
    errorPct: ((run.radarM - run.referenceM) / run.referenceM) * 100,
    newCalibration: (run.calibrationUsed * run.referenceM) / run.radarM,
  };
}

export interface CombinedCalibration {
  calibration: number; // 建議的新 CAL（各趟的距離加權平均）
  spreadPct: number | null; // 各趟結果的標準差（%），只有一趟時 null
  runs: number;
}

/**
 * 多趟合併：每一趟換算成「CAL = 1 時的雷達距離」再加總，等同依距離加權；
 * 不同趟用了不同的 CAL 也能合併。
 */
export function combineRuns(runs: Array<Pick<CalibrationRun, 'radarM' | 'referenceM' | 'calibrationUsed'>>): CombinedCalibration | null {
  const valid = runs.filter((r) => r.radarM > 0 && r.referenceM > 0 && r.calibrationUsed > 0);
  if (valid.length === 0) return null;
  const rawRadar = valid.reduce((sum, r) => sum + r.radarM / r.calibrationUsed, 0);
  const reference = valid.reduce((sum, r) => sum + r.referenceM, 0);
  const calibration = reference / rawRadar;
  let spreadPct: number | null = null;
  if (valid.length >= 2) {
    const each = valid.map((r) => (r.calibrationUsed * r.referenceM) / r.radarM);
    const mean = each.reduce((a, b) => a + b, 0) / each.length;
    const variance = each.reduce((s, c) => s + (c - mean) ** 2, 0) / (each.length - 1);
    spreadPct = (Math.sqrt(variance) / mean) * 100;
  }
  return { calibration, spreadPct, runs: valid.length };
}

export type CalibrationIssue = 'outOfRange' | 'largeChange' | null;

/** 新係數能不能直接套用：超出韌體範圍不行；變化太大要使用者確認 */
export function checkCalibration(current: number, next: number): CalibrationIssue {
  if (!Number.isFinite(next) || next < LIMITS.calibration.min || next > LIMITS.calibration.max) return 'outOfRange';
  if (Math.abs(next / current - 1) > MAX_CAL_CHANGE) return 'largeChange';
  return null;
}

/** 校正係數四捨五入到韌體保存的精度（4 位小數） */
export const roundCalibration = (cal: number): number => Number(cal.toFixed(4));

/**
 * 雷達 vs 輪速感測器的即時比對。
 * - 距離比（ΔDW / ΔDR）：不受時間落後影響，是準確度的主要指標
 * - 速度差：只在兩者都穩定（輪速 ≥ 2 m/s、雷達追蹤中）時取樣，含雜訊與落後
 */
export const AGREEMENT_MIN_MPS = 2;

export interface AgreementSample {
  radarMps: number;
  wheelMps: number;
}

export interface AgreementStats {
  samples: number;
  meanDiffMps: number | null; // 雷達 − 輪速
  rmsDiffMps: number | null;
  meanDiffPct: number | null;
  distanceErrorPct: number | null; // (ΔDR − ΔDW) / ΔDW
  radarDistanceM: number;
  wheelDistanceM: number;
}

export class AgreementTracker {
  private n = 0;
  private sumDiff = 0;
  private sumSq = 0;
  private sumPct = 0;
  private dr0: number | null = null;
  private dw0: number | null = null;
  private dr = 0;
  private dw = 0;

  reset(): void {
    this.n = this.sumDiff = this.sumSq = this.sumPct = 0;
    this.dr0 = this.dw0 = null;
    this.dr = this.dw = 0;
  }

  /** 每一筆遙測；radarMps 只在「追蹤中」時給 */
  update(radarMps: number | null, wheelMps: number | null, radarDistanceM: number, wheelDistanceM: number | null): void {
    if (wheelDistanceM === null) return;
    if (this.dr0 === null || this.dw0 === null || radarDistanceM < this.dr0 || wheelDistanceM < this.dw0) {
      this.dr0 = radarDistanceM; // 第一筆或韌體重開機：重新對齊
      this.dw0 = wheelDistanceM;
    }
    this.dr = radarDistanceM - this.dr0;
    this.dw = wheelDistanceM - this.dw0;
    if (radarMps === null || wheelMps === null || wheelMps < AGREEMENT_MIN_MPS) return;
    const diff = radarMps - wheelMps;
    this.n += 1;
    this.sumDiff += diff;
    this.sumSq += diff * diff;
    this.sumPct += (diff / wheelMps) * 100;
  }

  stats(): AgreementStats {
    const n = this.n;
    return {
      samples: n,
      meanDiffMps: n ? this.sumDiff / n : null,
      rmsDiffMps: n ? Math.sqrt(this.sumSq / n) : null,
      meanDiffPct: n ? this.sumPct / n : null,
      distanceErrorPct: this.dw >= 10 ? ((this.dr - this.dw) / this.dw) * 100 : null,
      radarDistanceM: this.dr,
      wheelDistanceM: this.dw,
    };
  }
}
