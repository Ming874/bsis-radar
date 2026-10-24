/**
 * 【應用層】行程：本次行程的統計與速度曲線，以及存在這支手機上的行程紀錄。
 *
 * 本次行程每 5 秒存一份在這台裝置上：重新整理頁面、App 被系統關掉後再打開，2 小時內會接續
 * （ESP32 沒重開機時，中間騎的距離也算得到）；超過 2 小時就把它存進行程紀錄，從 0 開始。
 */
import { createStore } from 'zustand/vanilla';
import { mergeTrips } from '../domain/backup';
import { TraceBuilder, isTrace, type TripTrace } from '../domain/trace';
import { TripMeter, type SavedTrip, type TripMeterState, type TripSnapshot } from '../domain/trip';
import type { Telemetry } from '../domain/types';

export type { SavedTrip };

/** 存檔的行程至少要有這麼長，太短的（例如只是推車）不留 */
export const MIN_SAVED_TRIP_M = 50;
export const MAX_TRIPS = 200;
/** 這段時間內重新打開網頁就接續本次行程 */
export const RESUME_WINDOW_MS = 2 * 3600_000;
const SAVE_EVERY_MS = 5000;
const PUBLISH_EVERY_MS = 250;
const TRACE_EVERY_MS = 1000;

/** 存在這台裝置上的本次行程 */
export interface CurrentTripRecord {
  meter: TripMeterState;
  trace: TripTrace;
  savedAt: number;
}

export interface TripState {
  current: TripSnapshot;
  /** 本次行程的速度曲線（每秒更新） */
  trace: TripTrace;
  trips: SavedTrip[];
  /** 開啟時接續了上次沒結束的行程（顯示一次提示用） */
  resumed: boolean;
  /** 開啟時上次的行程已超過 2 小時，自動存進紀錄的那一筆 */
  autoSaved: SavedTrip | null;
}

export interface TripActions {
  /** @param overspeed 這一筆是否處於超速（由超速警示判斷） */
  onTelemetry: (t: Telemetry, overspeed?: boolean) => void;
  /** 結束本次行程：夠長就存進紀錄（回傳存下的那一筆），然後從 0 開始 */
  finish: () => SavedTrip | null;
  deleteTrip: (id: string) => void;
  clearTrips: () => void;
  /** 匯入備份：同一個 id 不重複；回傳新增幾筆 */
  importTrips: (trips: SavedTrip[]) => number;
  /** 馬上把本次行程存到這台裝置（網頁被關掉、切到背景時） */
  persist: () => void;
  acknowledgeResume: () => void;
}

export type TripStore = TripState & TripActions;

export interface TripStoreDeps {
  now: () => number;
  loadTrips: () => SavedTrip[];
  saveTrips: (trips: SavedTrip[]) => void;
  loadCurrent?: () => unknown;
  saveCurrent?: (record: CurrentTripRecord | null) => void;
  /** 結束行程時的速限（km/h）；沒開超速警示時 null */
  speedLimitKmh?: () => number | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 檢查存檔的本次行程（格式不對就當作沒有） */
export function parseCurrentRecord(value: unknown): CurrentTripRecord | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<CurrentTripRecord>;
  const m = r.meter as Partial<TripMeterState> | undefined;
  if (!m || !finite(r.savedAt) || !isTrace(r.trace)) return null;
  const ok =
    finite(m.startedAt) &&
    finite(m.distanceM) &&
    finite(m.movingS) &&
    finite(m.maxMps) &&
    finite(m.overspeedS) &&
    finite(m.overspeedCount) &&
    finite(m.lastUptime) &&
    (m.lastDr === null || finite(m.lastDr)) &&
    (m.lastDw === null || finite(m.lastDw)) &&
    (m.wheelDistanceM === null || finite(m.wheelDistanceM));
  return ok ? (r as CurrentTripRecord) : null;
}

const isEmpty = (s: Pick<TripSnapshot, 'distanceM' | 'movingS'>) => s.distanceM <= 0 && s.movingS <= 0;

export function createTripStore(deps: TripStoreDeps) {
  const meter = new TripMeter(deps.now());
  const trace = new TraceBuilder();
  let lastPublish = 0;
  let lastTrace = 0;
  let lastSave = 0;

  const toSaved = (snap: TripSnapshot, endedAt: number, curve: TripTrace): SavedTrip => ({
    ...snap,
    id: `${snap.startedAt}`,
    endedAt,
    trace: curve,
    limitKmh: deps.speedLimitKmh?.() ?? null,
  });

  // 上次沒結束的行程：2 小時內接續，太久就直接存進紀錄
  let trips = deps.loadTrips();
  let resumed = false;
  let autoSaved: SavedTrip | null = null;
  const saved = parseCurrentRecord(deps.loadCurrent?.());
  if (saved && !isEmpty(saved.meter)) {
    if (deps.now() - saved.savedAt <= RESUME_WINDOW_MS) {
      meter.restore(saved.meter);
      trace.restore(saved.trace, saved.savedAt);
      resumed = true;
    } else {
      if (saved.meter.distanceM >= MIN_SAVED_TRIP_M) {
        autoSaved = toSaved(saved.meter, saved.savedAt, saved.trace);
        trips = mergeTrips(trips, [autoSaved], MAX_TRIPS).trips;
        deps.saveTrips(trips);
      }
      deps.saveCurrent?.(null);
    }
  }

  const persist = () => {
    const state = meter.save();
    if (isEmpty(state)) return;
    deps.saveCurrent?.({ meter: state, trace: trace.snapshot(), savedAt: deps.now() });
  };

  return createStore<TripStore>()((set, get) => ({
    current: meter.snapshot(),
    trace: trace.snapshot(),
    trips,
    resumed,
    autoSaved,

    onTelemetry: (t, overspeed = false) => {
      meter.update(t, overspeed);
      trace.update(t);
      // 畫面每 0.25 秒更新一次就夠了（遙測是 10 Hz）；曲線每秒一次
      if (t.receivedAt - lastPublish >= PUBLISH_EVERY_MS) {
        lastPublish = t.receivedAt;
        const patch: Partial<TripState> = { current: meter.snapshot() };
        if (t.receivedAt - lastTrace >= TRACE_EVERY_MS) {
          lastTrace = t.receivedAt;
          patch.trace = trace.snapshot();
        }
        set(patch);
      }
      if (t.receivedAt - lastSave >= SAVE_EVERY_MS) {
        lastSave = t.receivedAt;
        persist();
      }
    },

    finish: () => {
      const snap = meter.snapshot();
      const now = deps.now();
      let result: SavedTrip | null = null;
      if (snap.distanceM >= MIN_SAVED_TRIP_M) {
        result = toSaved(snap, now, trace.snapshot());
        const next = [result, ...get().trips].slice(0, MAX_TRIPS);
        deps.saveTrips(next);
        set({ trips: next });
      }
      meter.reset(now);
      trace.reset();
      deps.saveCurrent?.(null);
      set({ current: meter.snapshot(), trace: trace.snapshot(), resumed: false });
      return result;
    },

    deleteTrip: (id) => {
      const next = get().trips.filter((t) => t.id !== id);
      deps.saveTrips(next);
      set({ trips: next });
    },

    clearTrips: () => {
      deps.saveTrips([]);
      set({ trips: [] });
    },

    importTrips: (incoming) => {
      const { trips: next, added } = mergeTrips(get().trips, incoming, MAX_TRIPS);
      if (added > 0) {
        deps.saveTrips(next);
        set({ trips: next });
      }
      return added;
    },

    persist,
    acknowledgeResume: () => set({ resumed: false, autoSaved: null }),
  }));
}
