/**
 * 【應用層】裝置狀態與操作（單一資料來源）。
 *
 * 負責：藍牙連線、解析每一行資料、維護速度圖與資料框緩衝、送指令、記錄 CSV、偵測資料中斷。
 * 只依賴領域層與「介面」，具體實作由 container.ts 注入，所以可以替換或測試。
 */
import { createStore } from 'zustand/vanilla';
import { buildCommand, diffConfig, parseLine } from '../domain/protocol';
import type { DeviceCommand, DeviceConfig, EditableConfig, FrameSample, SpeedPoint, Telemetry } from '../domain/types';
import { fileStamp } from '../domain/units';
import type { CsvRecorder } from '../infrastructure/storage/csv';
import type { RadarTransport, TransportState } from '../infrastructure/transport/RadarTransport';
import { describeConnectionError, describeSendError } from './messages';

export const SPEED_WINDOW_MS = 120_000; // 速度圖顯示最近 2 分鐘
export const FRAME_WINDOW = 300; // 資料框緩衝：約 30 秒
export const STALE_AFTER_MS = 1500;
const MAX_CONSOLE = 150;

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
  legacyFirmware: string | null; // 連上的是 3.0 以前（後方來車偵測版）的韌體
  speedHistory: SpeedPoint[];
  frames: FrameSample[];
  frameRateHz: number | null; // 最近 2 秒的資料框頻率
  console: ConsoleEntry[];
  lastAck: { ok: boolean; message: string; at: number } | null;
  applying: boolean; // 正在送出設定
  recording: { active: boolean; startedAt: number | null; rows: number };
  error: string | null;
}

export interface RadarActions {
  connectBluetooth: () => Promise<void>;
  reconnectKnownDevice: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sendCommand: (cmd: DeviceCommand) => Promise<boolean>;
  sendRaw: (text: string) => Promise<boolean>;
  applyConfig: (next: EditableConfig) => Promise<boolean>;
  startRecording: () => void;
  stopRecording: () => void;
  clearConsole: () => void;
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
  now: () => number;
}

const INITIAL: RadarState = {
  connection: { status: 'idle' },
  everConnected: false,
  telemetry: null,
  stale: false,
  config: null,
  legacyFirmware: null,
  speedHistory: [],
  frames: [],
  frameRateHz: null,
  console: [],
  lastAck: null,
  applying: false,
  recording: { active: false, startedAt: null, rows: 0 },
  error: null,
};

/** 最近 2 秒內的資料框數 ÷ 時間 */
function measureFrameRate(frames: FrameSample[], now: number): number | null {
  let n = 0;
  let first = now;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (!f || f.t < now - 2000) break;
    n++;
    first = f.t;
  }
  if (n < 3 || now - first < 500) return null;
  return ((n - 1) * 1000) / (now - first);
}

export function createRadarStore(deps: RadarStoreDeps) {
  let transport: RadarTransport | null = null;
  let unsubscribe: Array<() => void> = [];
  let connectedAt = 0;
  let consoleId = 0;

  const store = createStore<RadarStore>()((set, get) => {
    const log = (dir: ConsoleEntry['dir'], text: string) => {
      const entry: ConsoleEntry = { id: ++consoleId, at: deps.now(), dir, text };
      set((s) => ({ console: [...s.console.slice(-(MAX_CONSOLE - 1)), entry] }));
    };

    const handleTelemetry = (data: Omit<Telemetry, 'receivedAt'>) => {
      const t: Telemetry = { ...data, receivedAt: deps.now() };
      const prev = get();
      const cutoff = t.receivedAt - SPEED_WINDOW_MS;
      const speedHistory = [
        ...prev.speedHistory.filter((p) => p.t >= cutoff),
        { t: t.receivedAt, speedMps: t.speedMps, wheelMps: t.wheelMps, state: t.state },
      ];
      // 心跳行（FN 不變）不是新的資料框
      const isNewFrame = t.radarOnline && t.frame !== prev.telemetry?.frame;
      const frames = isNewFrame
        ? [
            ...prev.frames.slice(-(FRAME_WINDOW - 1)),
            { t: t.receivedAt, frame: t.frame, rangeM: t.rangeM, radialMps: t.radialMps, groundMps: t.groundMps, verdict: t.verdict },
          ]
        : prev.frames;
      let recording = prev.recording;
      if (recording.active && deps.recorder.append(t)) recording = { ...recording, rows: deps.recorder.rowCount };
      set({
        telemetry: t,
        stale: false,
        speedHistory,
        frames,
        frameRateHz: isNewFrame ? measureFrameRate(frames, t.receivedAt) : prev.frameRateHz,
        recording,
      });
    };

    const handleLine = (line: string) => {
      const parsed = parseLine(line);
      switch (parsed.kind) {
        case 'telemetry':
          handleTelemetry(parsed.telemetry);
          return; // 遙測每秒 10 行，不放進主控台
        case 'config':
          set({ config: parsed.config, legacyFirmware: null });
          break;
        case 'legacyConfig':
          set({ config: null, legacyFirmware: parsed.firmware });
          break;
        case 'ack':
          set({ lastAck: { ok: parsed.ok, message: parsed.message, at: deps.now() } });
          break;
        case 'unknown':
          break;
      }
      log('in', line);
    };

    const handleState = (state: TransportState) => {
      set({ connection: state });
      if (state.status === 'connected') {
        connectedAt = deps.now();
        set({ everConnected: true, stale: false, error: null });
        log('info', `已連線：${state.deviceName ?? ''}`);
        void get().sendCommand({ type: 'get' }); // 每次（重新）連線都讀一次設定
      } else if (state.status === 'reconnecting') {
        log('info', `連線中斷，重新連線中（第 ${state.attempt ?? 1} 次）`);
      } else if (state.status === 'disconnected') {
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
      set({
        everConnected: false,
        telemetry: null,
        config: null,
        legacyFirmware: null,
        speedHistory: [],
        frames: [],
        frameRateHz: null,
        error: null,
        stale: false,
      });
      try {
        await connect();
      } catch (e) {
        detach();
        const text = describeConnectionError(e); // 使用者關掉選擇視窗時為 null，不需要提示
        set({ connection: text ? { status: 'disconnected', error: text } : { status: 'idle' }, error: text });
      }
    };

    return {
      ...INITIAL,

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
        set({ applying: true });
        try {
          for (const cmd of diffConfig(current, next)) {
            if (!(await get().sendCommand(cmd))) return false;
          }
          return true;
        } finally {
          set({ applying: false });
        }
      },

      startRecording: () => {
        deps.recorder.clear();
        set({ recording: { active: true, startedAt: deps.now(), rows: 0 } });
      },

      stopRecording: () => {
        const { recording } = get();
        if (recording.active && recording.startedAt !== null && deps.recorder.rowCount > 0) {
          deps.download(`bsis-speed_${fileStamp(recording.startedAt)}.csv`, deps.recorder.toCsv());
        }
        set({ recording: { active: false, startedAt: null, rows: 0 } });
      },

      clearConsole: () => set({ console: [] }),
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
