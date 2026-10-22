import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvRecorder } from '../infrastructure/storage/csv';
import { Emitter, type TransportState } from '../infrastructure/transport/RadarTransport';
import { createCalibrationStore } from './calibrationStore';
import { ALERT_COOLDOWN_MS, createOverspeedStore } from './overspeedStore';
import { createRadarStore, type BluetoothTransport } from './radarStore';
import { createTripStore } from './tripStore';

class FakeTransport implements BluetoothTransport {
  readonly sent: string[] = [];
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<TransportState>();
  onLine(l: (line: string) => void) {
    return this.lines.on(l);
  }
  onState(l: (s: TransportState) => void) {
    return this.states.on(l);
  }
  async connect() {
    this.states.emit({ status: 'connected', deviceName: 'BSIS-Speed' });
  }
  async reconnectKnownDevice() {
    await this.connect();
    return true;
  }
  async disconnect() {
    this.states.emit({ status: 'idle' });
  }
  async send(line: string) {
    this.sent.push(line);
  }
  emit(line: string) {
    this.lines.emit(line);
  }
}

const CFG = 'CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=10.0 RMIN=0.62 RMAX=2.15 FW=3.0.0';
const line = (frame: number, dr: number, extra = '') =>
  `R=1 ST=3 V=5.00 SD=0.10 Q=95 WD=0 FN=${frame} N=1 RD=0.99 RV=3.54 E=1000 G=5.00 FV=0 DR=${dr.toFixed(1)} W=5.00 DW=${dr.toFixed(1)} T=100${extra}`;

describe('radarStore', () => {
  let now = 1_000_000;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const transport = new FakeTransport();
    const downloads: Array<{ name: string; content: string }> = [];
    const store = createRadarStore({
      createBluetooth: () => transport,
      recorder: new CsvRecorder(),
      download: (name, content) => downloads.push({ name, content }),
      now: () => now,
    });
    return { store, transport, downloads };
  };

  it('連線後讀設定、收遙測、心跳不算新的資料框', async () => {
    const { store, transport } = setup();
    await store.getState().connectBluetooth();
    expect(store.getState().connection.status).toBe('connected');
    expect(transport.sent).toEqual(['GET']);

    transport.emit(CFG);
    expect(store.getState().config?.calibration).toBe(1);

    for (let k = 1; k <= 5; k++) {
      now += 100;
      transport.emit(line(k, k * 0.5));
    }
    now += 100;
    transport.emit(line(5, 2.5)); // 心跳：FN 不變
    const s = store.getState();
    expect(s.telemetry?.speedMps).toBe(5);
    expect(s.frames).toHaveLength(5);
    expect(s.speedHistory).toHaveLength(6);
    expect(s.console.some((c) => c.text.startsWith('R='))).toBe(false); // 遙測不進主控台
  });

  it('舊版韌體的 CFG：標記為過舊', async () => {
    const { store, transport } = setup();
    await store.getState().connectBluetooth();
    transport.emit('CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 FW=2.4.0');
    expect(store.getState().legacyFirmware).toBe('2.4.0');
    expect(store.getState().config).toBeNull();
  });

  it('套用設定只送有變的指令', async () => {
    const { store, transport } = setup();
    await store.getState().connectBluetooth();
    transport.emit(CFG);
    const config = store.getState().config;
    if (!config) throw new Error('沒有設定');
    await store.getState().applyConfig({ ...config, angleDeg: 40, calibration: 1.05 });
    expect(transport.sent).toEqual(['GET', 'ANGLE 40', 'CAL 1.05']);
  });

  it('CSV：每一筆資料框一列（心跳不重複記錄），停止時下載', async () => {
    const { store, transport, downloads } = setup();
    await store.getState().connectBluetooth();
    store.getState().startRecording();
    transport.emit(line(1, 0.5));
    transport.emit(line(1, 0.5));
    transport.emit(line(2, 1.0));
    expect(store.getState().recording.rows).toBe(2);
    store.getState().stopRecording();
    expect(downloads).toHaveLength(1);
    const csv = downloads[0]?.content.split('\n') ?? [];
    expect(csv[0]).toContain('speed_mps');
    expect(csv).toHaveLength(3);
  });

  it('超過 1.5 秒沒有資料：資料中斷', async () => {
    const { store, transport } = setup();
    await store.getState().connectBluetooth();
    transport.emit(line(1, 0));
    now += 2000;
    vi.advanceTimersByTime(300);
    expect(store.getState().stale).toBe(true);
  });
});

describe('tripStore 與 calibrationStore', () => {
  const tele = (at: number, dr: number, dw: number | null, uptimeS = 100) => ({
    radarOnline: true,
    state: 'tracking' as const,
    speedMps: 5,
    sigmaMps: 0.1,
    qualityPct: 100,
    wrongDirPct: 0,
    frame: at,
    targets: 1,
    rangeM: 0.99,
    radialMps: 3.5,
    energy: 1000,
    groundMps: 5,
    verdict: 'accepted' as const,
    radarDistanceM: dr,
    wheelMps: dw === null ? null : 5,
    wheelDistanceM: dw,
    uptimeS,
    receivedAt: at,
  });

  it('行程：結束時夠長才存檔', () => {
    let now = 0;
    const saved: unknown[] = [];
    const trip = createTripStore({ now: () => now, loadTrips: () => [], saveTrips: (t) => saved.push(t) });
    trip.getState().onTelemetry(tele(0, 0, null));
    trip.getState().onTelemetry(tele(300, 30, null));
    now = 400;
    trip.getState().finish();
    expect(trip.getState().trips).toHaveLength(0); // 30 m 不存
    trip.getState().onTelemetry(tele(700, 130, null));
    now = 800;
    trip.getState().finish();
    expect(trip.getState().trips).toHaveLength(1);
    expect(trip.getState().trips[0]?.distanceM).toBe(100);
    expect(trip.getState().current.distanceM).toBe(0);
  });

  it('距離校正：開始 → 結束 → 輸入實際距離 → 建議係數', () => {
    const persisted: unknown[] = [];
    const cal = createCalibrationStore({ now: () => 0, load: () => ({ runs: [], lastApplied: null }), save: (d) => persisted.push(d) });
    cal.getState().start('distance', tele(0, 1000, null), 1);
    cal.getState().onTelemetry(tele(100, 1047.5, null), 1);
    expect(cal.getState().session?.radarM).toBeCloseTo(47.5, 6);
    cal.getState().onTelemetry(tele(200, 1095, null), 1);
    cal.getState().stop();
    expect(cal.getState().pending?.radarM).toBeCloseTo(95, 6);
    expect(cal.getState().acceptPending(20)).toMatch(/至少/); // 參考距離太短
    expect(cal.getState().acceptPending(100)).toBeNull();
    expect(cal.getState().runs).toHaveLength(1);
    expect(cal.getState().combined?.calibration).toBeCloseTo(100 / 95, 6);
    expect(persisted.length).toBeGreaterThan(0);
    cal.getState().markApplied(1, 100 / 95);
    expect(cal.getState().runs).toHaveLength(0);
    expect(cal.getState().lastApplied?.to).toBeCloseTo(1.0526, 4);
  });

  it('輪速校正用輪速里程；期間韌體重開機則無效', () => {
    const cal = createCalibrationStore({ now: () => 0, load: () => ({ runs: [], lastApplied: null }), save: () => undefined });
    cal.getState().start('wheel', tele(0, 0, 10), 1.1);
    cal.getState().onTelemetry(tele(100, 300, 316), 1.1);
    cal.getState().stop();
    expect(cal.getState().acceptPending()).toBeNull();
    expect(cal.getState().runs[0]?.referenceM).toBeCloseTo(306, 6);

    cal.getState().start('wheel', tele(200, 300, 316, 100), 1.1);
    cal.getState().onTelemetry(tele(300, 5, 2, 3), 1.1); // 開機秒數變小
    expect(cal.getState().session?.invalid).toMatch(/重新開機/);
    cal.getState().stop();
    expect(cal.getState().pending).toBeNull();
  });
});

describe('overspeedStore', () => {
  const LIMIT = 25 / 3.6;
  const at = (ms: number, kmh: number, state: 'tracking' | 'lost' = 'tracking') => ({
    radarOnline: true,
    state,
    speedMps: kmh / 3.6,
    sigmaMps: 0.1,
    qualityPct: 100,
    wrongDirPct: 0,
    frame: ms / 100,
    targets: 1,
    rangeM: 0.99,
    radialMps: 3.5,
    energy: 1000,
    groundMps: kmh / 3.6,
    verdict: 'accepted' as const,
    radarDistanceM: 0,
    wheelMps: null,
    wheelDistanceM: null,
    uptimeS: 100,
    receivedAt: ms,
  });
  const ride = (store: ReturnType<typeof createOverspeedStore>, fromMs: number, toMs: number, kmh: number) => {
    for (let ms = fromMs; ms < toMs; ms += 100) store.getState().onTelemetry(at(ms, kmh), LIMIT, null);
  };

  it('進入超速時提示一次；在速限附近反覆進出時最多每 5 秒提示一次', () => {
    const alerts: number[] = [];
    let clock = 0;
    const store = createOverspeedStore({ alert: () => alerts.push(clock) });
    const step = (to: number, kmh: number) => {
      for (; clock < to; clock += 100) store.getState().onTelemetry(at(clock, kmh), LIMIT, null);
    };
    step(1000, 27);
    expect(store.getState().active).toBe(true);
    expect(store.getState().since).toBe(0);
    expect(alerts).toEqual([500]);
    step(3000, 27); // 持續超速不重複提示
    step(4500, 22); // 解除
    expect(store.getState().active).toBe(false);
    step(5500, 27); // 距離上次提示 4.5 秒又超速：畫面變紅，但不響
    expect(store.getState().active).toBe(true);
    expect(alerts).toHaveLength(1);
    step(7000, 22);
    step(8000, 27); // 超過 5 秒：再提示
    expect(alerts).toHaveLength(2);
    expect((alerts[1] ?? 0) - (alerts[0] ?? 0)).toBeGreaterThanOrEqual(ALERT_COOLDOWN_MS);
  });

  it('量不到速度、或呼叫 reset 時解除', () => {
    const store = createOverspeedStore({ alert: () => undefined });
    ride(store, 0, 1000, 30);
    expect(store.getState().active).toBe(true);
    store.getState().onTelemetry(at(1000, 30, 'lost'), LIMIT, null);
    expect(store.getState().active).toBe(false);
    ride(store, 2000, 3000, 30);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ active: false, since: null });
  });
});
