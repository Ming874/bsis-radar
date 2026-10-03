/**
 * 【應用層】雷達狀態與操作（單一資料來源）。
 *
 * 負責：藍牙連線、解析每一行資料、維護歷史與事件、送指令、記錄 CSV、偵測資料中斷。
 * 只依賴領域層與「介面」，具體實作由 container.ts 注入，所以可以替換或測試。
 */
import { createStore } from 'zustand/vanilla';
import { EventTracker } from '../domain/eventTracker';
import { buildCommand, diffConfig, parseLine } from '../domain/protocol';
import type { ApproachEvent, DeviceCommand, DeviceConfig, HistoryPoint, Telemetry } from '../domain/types';
import { fileStamp } from '../domain/units';
import type { RadarTransport, TransportState } from '../infrastructure/transport/RadarTransport';
import { eventsToCsv, type CsvRecorder } from '../infrastructure/storage/csv';
import { describeConnectionError, describeSendError } from './messages';

export const HISTORY_WINDOW_MS = 60_000;
export const STALE_AFTER_MS = 1500;
const MAX_EVENTS = 200;
const MAX_CONSOLE = 100;

export interface ConsoleEntry {
  id: number;
  at: number;
  dir: 'in' | 'out' | 'info';
  text: string;
}

export interface RadarState {
  connection: TransportState;
  everConnected: boolean; // 這次連線曾經成功過（用來判斷「意外斷線」）
  telemetry: Telemetry | null;
  stale: boolean; // 已連線但超過 1.5 s 沒收到資料
  config: DeviceConfig | null;
  history: HistoryPoint[];
  events: ApproachEvent[];
  console: ConsoleEntry[];
  lastAck: { ok: boolean; message: string; at: number } | null;
  recording: { active: boolean; startedAt: number | null; rows: number };
  error: string | null;
}

export interface RadarActions {
  connectBluetooth: () => Promise<void>;
  reconnectKnownDevice: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sendCommand: (cmd: DeviceCommand) => Promise<boolean>;
  sendRaw: (text: string) => Promise<boolean>;
  applyConfig: (next: DeviceConfig) => Promise<boolean>;
  clearEvents: () => void;
  exportEvents: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearError: () => void;
}

export type RadarStore = RadarState & RadarActions;

export interface BluetoothTransport extends RadarTransport {
  reconnectKnownDevice(): Promise<boolean>;
}

export interface RadarStoreDeps {
  createBluetooth: () => BluetoothTransport;
  recorder: CsvRecorder;
  download: (filename: string, content: string) => void;
  loadEvents: () => ApproachEvent[];
  saveEvents: (events: ApproachEvent[]) => void;
  now: () => number;
}

const INITIAL: RadarState = {
  connection: { status: 'idle' },
  everConnected: false,
  telemetry: null,
  stale: false,
  config: null,
  history: [],
  events: [],
  console: [],
  lastAck: null,
  recording: { active: false, startedAt: null, rows: 0 },
  error: null,
};

export function createRadarStore(deps: RadarStoreDeps) {
  let transport: RadarTransport | null = null;
  let unsubscribe: Array<() => void> = [];
  let connectedAt = 0;
  let consoleId = 0;
  const tracker = new EventTracker();

  const store = createStore<RadarStore>()((set, get) => {
    const log = (dir: ConsoleEntry['dir'], text: string) => {
      const entry: ConsoleEntry = { id: ++consoleId, at: deps.now(), dir, text };
      set((s) => ({ console: [...s.console.slice(-(MAX_CONSOLE - 1)), entry] }));
    };

    const addEvent = (event: ApproachEvent | null) => {
      if (!event) return;
      const events = [event, ...get().events].slice(0, MAX_EVENTS);
      deps.saveEvents(events);
      set({ events });
    };

    const handleTelemetry = (data: Omit<Telemetry, 'receivedAt'>) => {
      const t: Telemetry = { ...data, receivedAt: deps.now() };
      addEvent(tracker.update(t));
      const cutoff = t.receivedAt - HISTORY_WINDOW_MS;
      const history = [...get().history.filter((p) => p.t >= cutoff), { t: t.receivedAt, distanceM: t.distanceM, level: t.level, energy: t.energy }];
      const { recording } = get();
      if (recording.active) deps.recorder.append(t);
      set({
        telemetry: t,
        stale: false,
        history,
        recording: recording.active ? { ...recording, rows: deps.recorder.rowCount } : recording,
      });
    };

    const handleLine = (line: string) => {
      const parsed = parseLine(line);
      if (parsed.kind === 'telemetry') {
        handleTelemetry(parsed.telemetry);
        log('in', line);
      } else if (parsed.kind === 'config') {
        set({ config: parsed.config });
        log('in', line);
      } else if (parsed.kind === 'ack') {
        set({ lastAck: { ok: parsed.ok, message: parsed.message, at: deps.now() } });
        log('in', line);
      } else {
        log('in', line);
      }
    };

    const handleState = (state: TransportState) => {
      set({ connection: state });
      if (state.status === 'connected') {
        connectedAt = deps.now();
        set({ everConnected: true, stale: false, error: null });
        log('info', `已連線：${state.deviceName ?? ''}`);
        void get().sendCommand({ type: 'get' }); // 每次（重新）連線都讀一次設定
      } else if (state.status === 'reconnecting') {
        addEvent(tracker.flush());
        log('info', `連線中斷，重新連線中（第 ${state.attempt ?? 1} 次）`);
      } else if (state.status === 'disconnected') {
        addEvent(tracker.flush());
        log('info', state.error ?? '已中斷');
      }
    };

    const attach = (t: RadarTransport) => {
      detach();
      transport = t;
      unsubscribe = [t.onLine(handleLine), t.onState(handleState)];
    };

    const detach = () => {
      unsubscribe.forEach((u) => u());
      unsubscribe = [];
      transport = null;
    };

    const startWith = async (t: RadarTransport, connect: () => Promise<unknown>) => {
      if (transport) await get().disconnect();
      attach(t);
      set({ everConnected: false, telemetry: null, config: null, history: [], error: null, stale: false });
      try {
        await connect();
      } catch (e) {
        detach();
        const text = describeConnectionError(e); // 使用者關掉選擇視窗時為 null，不需要提示
        set({
          connection: text ? { status: 'disconnected', error: text } : { status: 'idle' },
          error: text,
        });
      }
    };

    return {
      ...INITIAL,
      events: deps.loadEvents(),

      connectBluetooth: async () => {
        const t = deps.createBluetooth();
        await startWith(t, () => t.connect());
      },

      reconnectKnownDevice: async () => {
        const t = deps.createBluetooth();
        let ok = false;
        await startWith(t, async () => {
          ok = await t.reconnectKnownDevice();
          if (!ok) throw new DOMException('no known device', 'NotFoundError');
        });
        return ok;
      },


      disconnect: async () => {
        addEvent(tracker.flush());
        const t = transport;
        detach();
        set({ connection: { status: 'idle' }, stale: false });
        await t?.disconnect().catch(() => undefined);
        log('info', '已手動中斷連線');
      },

      sendRaw: async (text) => {
        const t = transport;
        if (!t || get().connection.status !== 'connected') {
          set({ error: '尚未連線，指令沒有送出' });
          return false;
        }
        log('out', text);
        try {
          await t.send(text);
          return true;
        } catch (e) {
          set({ error: describeSendError(e) });
          return false;
        }
      },

      sendCommand: async (cmd) => {
        let text: string;
        try {
          text = buildCommand(cmd);
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) }); // buildCommand 的錯誤訊息已是中文
          return false;
        }
        return get().sendRaw(text);
      },

      applyConfig: async (next) => {
        const current = get().config;
        if (!current) return false;
        for (const cmd of diffConfig(current, next)) {
          if (!(await get().sendCommand(cmd))) return false;
        }
        return true;
      },

      clearEvents: () => {
        deps.saveEvents([]);
        set({ events: [] });
      },

      exportEvents: () => {
        deps.download(`radarA_events_${fileStamp(deps.now())}.csv`, eventsToCsv(get().events));
      },

      startRecording: () => {
        deps.recorder.clear();
        set({ recording: { active: true, startedAt: deps.now(), rows: 0 } });
      },

      stopRecording: () => {
        const { recording } = get();
        if (recording.active && recording.startedAt !== null && deps.recorder.rowCount > 0) {
          deps.download(`radarA_${fileStamp(recording.startedAt)}.csv`, deps.recorder.toCsv());
        }
        set({ recording: { active: false, startedAt: null, rows: 0 } });
      },

      clearError: () => set({ error: null }),
    };
  });

  // 資料中斷偵測：已連線但超過 1.5 s 沒有遙測
  setInterval(() => {
    const s = store.getState();
    if (s.connection.status !== 'connected') return;
    const last = s.telemetry?.receivedAt ?? connectedAt;
    const stale = deps.now() - last > STALE_AFTER_MS;
    if (stale !== s.stale) store.setState({ stale });
  }, 250);

  return store;
}
