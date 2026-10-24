/**
 * 【應用層】校正流程與精度驗證（docs/ALGORITHM.md §7、§8）。
 *
 * 一趟校正 = 記下開始時的雷達里程（與輪速里程）→ 騎一段 → 記下結束時的里程 → 和參考距離比較。
 * - 距離校正：參考距離是捲尺量好的直線距離（建議 50～100 m），起點與終點都停住，按鈕時機就不影響結果
 * - 輪速校正：參考距離是同一段時間輪速感測器的里程（建議 300 m 以上）
 * 多趟結果依距離加權合併，按「套用」才把新的 CAL 寫進 ESP32。
 */
import { createStore } from 'zustand/vanilla';
import {
  AgreementTracker,
  MIN_CALIBRATION_M,
  combineRuns,
  roundCalibration,
  type AgreementStats,
  type CalibrationRun,
  type CombinedCalibration,
} from '../domain/calibration';
import type { Telemetry } from '../domain/types';

export type CalibrationMethod = 'distance' | 'wheel';

export interface CalibrationSession {
  method: CalibrationMethod;
  startedAt: number;
  calibrationUsed: number;
  radarStartM: number;
  wheelStartM: number | null;
  radarM: number; // 開始到現在
  wheelM: number | null;
  invalid: string | null; // 期間韌體重開機、CAL 被改…
}

/** 結束後等使用者確認（距離校正要輸入實際距離） */
export interface PendingRun {
  method: CalibrationMethod;
  at: number;
  radarM: number;
  wheelM: number | null;
  calibrationUsed: number;
}

export interface CalibrationState {
  session: CalibrationSession | null;
  pending: PendingRun | null;
  runs: CalibrationRun[];
  combined: CombinedCalibration | null;
  lastApplied: { at: number; from: number; to: number; runs: number } | null;
  agreement: AgreementStats;
}

export interface CalibrationActions {
  onTelemetry: (t: Telemetry, calibration: number | null) => void;
  start: (method: CalibrationMethod, t: Telemetry, calibration: number) => void;
  stop: () => void;
  cancel: () => void;
  /** 距離校正：輸入實際距離後加入；輪速校正直接用輪速里程 */
  acceptPending: (referenceM?: number) => string | null;
  discardPending: () => void;
  removeRun: (id: string) => void;
  clearRuns: () => void;
  markApplied: (from: number, to: number) => void;
  resetAgreement: () => void;
  /** 匯入備份：校正紀錄依 id 合併，上次套用取比較新的；回傳新增幾趟 */
  importData: (data: Pick<CalibrationState, 'runs' | 'lastApplied'>) => number;
}

export type CalibrationStore = CalibrationState & CalibrationActions;

export interface CalibrationStoreDeps {
  now: () => number;
  load: () => Pick<CalibrationState, 'runs' | 'lastApplied'>;
  save: (data: Pick<CalibrationState, 'runs' | 'lastApplied'>) => void;
}

export function createCalibrationStore(deps: CalibrationStoreDeps) {
  const agreement = new AgreementTracker();
  let lastUptime = -1;
  let lastAgreementPublish = 0;
  const saved = deps.load();

  return createStore<CalibrationStore>()((set, get) => {
    const persist = () => {
      const { runs, lastApplied } = get();
      deps.save({ runs, lastApplied });
    };
    const setRuns = (runs: CalibrationRun[]) => {
      set({ runs, combined: combineRuns(runs) });
      persist();
    };

    return {
      session: null,
      pending: null,
      runs: saved.runs,
      combined: combineRuns(saved.runs),
      lastApplied: saved.lastApplied,
      agreement: agreement.stats(),

      onTelemetry: (t, calibration) => {
        const restarted = t.uptimeS < lastUptime;
        lastUptime = t.uptimeS;
        agreement.update(t.state === 'tracking' ? t.speedMps : null, t.wheelMps, t.radarDistanceM, t.wheelDistanceM);
        if (t.receivedAt - lastAgreementPublish >= 500) {
          lastAgreementPublish = t.receivedAt;
          set({ agreement: agreement.stats() });
        }

        const s = get().session;
        if (!s) return;
        let invalid = s.invalid;
        if (restarted || t.radarDistanceM < s.radarStartM) invalid = 'ESP32 重新開機，這一趟無效';
        else if (calibration !== null && Math.abs(calibration - s.calibrationUsed) > 1e-6) invalid = '期間校正係數被修改，這一趟無效';
        set({
          session: {
            ...s,
            invalid,
            radarM: Math.max(0, t.radarDistanceM - s.radarStartM),
            wheelM: s.wheelStartM !== null && t.wheelDistanceM !== null ? Math.max(0, t.wheelDistanceM - s.wheelStartM) : null,
          },
        });
      },

      start: (method, t, calibration) => {
        set({
          pending: null,
          session: {
            method,
            startedAt: deps.now(),
            calibrationUsed: calibration,
            radarStartM: t.radarDistanceM,
            wheelStartM: t.wheelDistanceM,
            radarM: 0,
            wheelM: t.wheelDistanceM === null ? null : 0,
            invalid: null,
          },
        });
      },

      stop: () => {
        const s = get().session;
        if (!s) return;
        set({
          session: null,
          pending: s.invalid
            ? null
            : { method: s.method, at: deps.now(), radarM: s.radarM, wheelM: s.wheelM, calibrationUsed: s.calibrationUsed },
        });
      },

      cancel: () => set({ session: null, pending: null }),

      acceptPending: (referenceM) => {
        const p = get().pending;
        if (!p) return '沒有待確認的校正';
        const reference = p.method === 'wheel' ? p.wheelM : referenceM;
        if (reference === undefined || reference === null || !Number.isFinite(reference)) return '請輸入實際距離';
        if (reference < MIN_CALIBRATION_M) return `參考距離至少 ${MIN_CALIBRATION_M} m`;
        if (p.radarM <= 0) return '雷達沒有量到距離：確認雷達朝向地面、DIR 設定正確';
        const run: CalibrationRun = {
          id: `${p.at}`,
          method: p.method,
          at: p.at,
          radarM: p.radarM,
          referenceM: reference,
          calibrationUsed: p.calibrationUsed,
        };
        set({ pending: null });
        setRuns([...get().runs, run]);
        return null;
      },

      discardPending: () => set({ pending: null }),

      removeRun: (id) => setRuns(get().runs.filter((r) => r.id !== id)),

      clearRuns: () => setRuns([]),

      markApplied: (from, to) => {
        set({ lastApplied: { at: deps.now(), from, to: roundCalibration(to), runs: get().runs.length } });
        setRuns([]); // 新係數生效後，舊的趟次是在舊係數下量的，清掉避免混用
      },

      resetAgreement: () => {
        agreement.reset();
        set({ agreement: agreement.stats() });
      },

      importData: (data) => {
        const ids = new Set(get().runs.map((r) => r.id));
        const fresh = data.runs.filter((r) => !ids.has(r.id));
        const current = get().lastApplied;
        if (data.lastApplied && (!current || data.lastApplied.at > current.at)) set({ lastApplied: data.lastApplied });
        if (fresh.length > 0) setRuns([...get().runs, ...fresh].sort((a, b) => a.at - b.at));
        else persist();
        return fresh.length;
      },
    };
  });
}
