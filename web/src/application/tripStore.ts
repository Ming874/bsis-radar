/**
 * 【應用層】行程：本次行程的統計，以及存在這支手機上的行程紀錄。
 */
import { createStore } from 'zustand/vanilla';
import { TripMeter, type TripSnapshot } from '../domain/trip';
import type { Telemetry } from '../domain/types';

/** 存檔的行程至少要有這麼長，太短的（例如只是推車）不留 */
export const MIN_SAVED_TRIP_M = 50;
const MAX_TRIPS = 50;

export interface SavedTrip extends TripSnapshot {
  id: string;
  endedAt: number;
}

export interface TripState {
  current: TripSnapshot;
  trips: SavedTrip[];
}

export interface TripActions {
  onTelemetry: (t: Telemetry) => void;
  /** 結束本次行程：夠長就存進紀錄，然後從 0 開始 */
  finish: () => void;
  deleteTrip: (id: string) => void;
  clearTrips: () => void;
}

export type TripStore = TripState & TripActions;

export interface TripStoreDeps {
  now: () => number;
  loadTrips: () => SavedTrip[];
  saveTrips: (trips: SavedTrip[]) => void;
}

export function createTripStore(deps: TripStoreDeps) {
  const meter = new TripMeter(deps.now());
  let lastPublish = 0;

  return createStore<TripStore>()((set, get) => ({
    current: meter.snapshot(),
    trips: deps.loadTrips(),

    onTelemetry: (t) => {
      meter.update(t);
      // 畫面每 0.25 秒更新一次就夠了（遙測是 10 Hz）
      if (t.receivedAt - lastPublish >= 250) {
        lastPublish = t.receivedAt;
        set({ current: meter.snapshot() });
      }
    },

    finish: () => {
      const snap = meter.snapshot();
      const now = deps.now();
      if (snap.distanceM >= MIN_SAVED_TRIP_M) {
        const trip: SavedTrip = { ...snap, id: `${snap.startedAt}`, endedAt: now };
        const trips = [trip, ...get().trips].slice(0, MAX_TRIPS);
        deps.saveTrips(trips);
        set({ trips });
      }
      meter.reset(now);
      set({ current: meter.snapshot() });
    },

    deleteTrip: (id) => {
      const trips = get().trips.filter((t) => t.id !== id);
      deps.saveTrips(trips);
      set({ trips });
    },

    clearTrips: () => {
      deps.saveTrips([]);
      set({ trips: [] });
    },
  }));
}
