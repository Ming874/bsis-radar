/**
 * 【基礎設施層】示範模式（網址加上 ?demo）：不需要硬體，產生與韌體相同格式的遙測，給展示、截圖與開發用。
 *
 * 模擬一段城市騎乘（起步、巡航、變速、停等），每 0.1 秒一個 LD2451 資料框（1～3 個路面點）：路面散射點的俯角分散、
 * 偶爾沒有回波或雜散目標、輪速感測器參考值。速度輸出模擬校正後的韌體：約 0.2 秒落後、1σ 約 1.5%。
 * 後方來車：每 12～20 秒有一台車從 35 m 外以 10～45 km/h 的接近速度追上來（偶爾兩台），
 * 用和韌體 RearThreat 相同的規則分級（確認 2 筆、5 m 或到達時間 ≤ TTC 危險、RANGE 內注意、保持 1.5 秒）。
 */
import { NO_OVERSPEED, overspeedEvidence, stepOverspeed } from '../../domain/overspeed';
import { DEFAULT_CONFIG, DEFAULT_REAR_CONFIG, REAR_DANGER_DIST_M, REAR_HOLD_MS, groundWindow, rearDetectRange } from '../../domain/protocol';
import { TraceBuilder } from '../../domain/trace';
import type { SavedTrip } from '../../domain/trip';
import type { EditableConfig, EditableRearConfig } from '../../domain/types';
import { Emitter, type RadarTransport, type TransportState } from './RadarTransport';

export const DEMO_DEVICE_NAME = 'BSIS-Speed（示範）';
const PERIOD_S = 96;

/** 真實速度（m/s）：96 秒一輪 */
function profile(t: number): number {
  const s = t % PERIOD_S;
  if (s < 2) return 0;
  if (s < 7) return 1.3 * (s - 2);
  if (s < 40) return 6.5 + 0.9 * Math.sin((s - 7) * 0.25) + 0.4 * Math.sin((s - 7) * 0.9);
  if (s < 46) return Math.max(0, (6.5 + 0.9 * Math.sin(33 * 0.25) + 0.4 * Math.sin(33 * 0.9)) * (1 - (s - 40) / 6));
  if (s < 54) return 0;
  if (s < 60) return 1.4 * (s - 54);
  return 8.4 + 0.6 * Math.sin((s - 60) * 0.3);
}

function gauss(): number {
  const u = Math.random() + 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

interface DemoVehicle {
  d: number; // 距離 m
  v: number; // 接近速度 m/s
  lat: number; // 左右 m（負 = 左邊：在台灣汽車從腳踏車左邊超車）
}

/**
 * 來車時刻表（與騎乘曲線同樣 96 秒一輪，截圖才拍得到固定的畫面）：
 * 19.5 秒左右一台慢車在警示距離內（注意）、29.5 秒左右兩台快車接近（危險）、75 秒（超速截圖）後方沒車
 */
const REAR_SCHEDULE: Array<{ t: number; kmh: number; lat: number; follow?: number }> = [
  { t: 12.5, kmh: 12, lat: -1.6 },
  { t: 27.0, kmh: 35, lat: -2.0, follow: 10 },
  { t: 45.0, kmh: 20, lat: -1.4 },
  { t: 63.0, kmh: 28, lat: -2.2 },
  { t: 84.0, kmh: 18, lat: -1.5 },
];

/** 後方來車的模擬（每 0.1 秒一步），輸出與韌體相同格式的 REAR 行 */
class DemoRear {
  private vehicles: DemoVehicle[] = [];
  private nextIndex = 0;
  private cycle = 0;
  private t = 0;
  private frame = 0;
  private evidence = 0;
  private lastCaution = -Infinity;
  private lastDanger = -Infinity;
  private level = 0;
  private alerts = 0;
  private lastSentS = -Infinity;

  /** 回傳要送的一行（不需要送時 null） */
  step(cfg: EditableRearConfig): string | null {
    this.t += 0.1;
    const detect = rearDetectRange(cfg.rangeM);
    const next = REAR_SCHEDULE[this.nextIndex];
    if (next && this.t >= this.cycle * PERIOD_S + next.t) {
      this.vehicles.push({ d: 35, v: next.kmh / 3.6, lat: next.lat });
      if (next.follow) this.vehicles.push({ d: 35 + next.follow, v: (next.kmh - 2) / 3.6, lat: next.lat - 0.6 });
      this.nextIndex++;
      if (this.nextIndex === REAR_SCHEDULE.length) {
        this.nextIndex = 0;
        this.cycle++;
      }
    }
    for (const c of this.vehicles) c.d -= c.v * 0.1;
    this.vehicles = this.vehicles.filter((c) => c.d > 2.2); // 到旁邊就離開視野

    // LD2451：偵測距離內、接近速度 ≥ RSPD 的才回報（整數）
    const reported = this.vehicles
      .filter((c) => c.d <= detect && c.v * 3.6 >= cfg.minSpeedKmh && Math.random() < 0.95)
      .map((c) => ({
        angle: Math.round((Math.atan2(c.lat, c.d) * 180) / Math.PI + gauss()),
        d: Math.max(0, Math.round(c.d + 0.4 * gauss())),
        kmh: Math.round(c.v * 3.6 + gauss()),
      }));
    const active = reported.length > 0;
    if (active || this.frame === 0 || Math.round(this.t * 10) % 14 === 0) this.frame++; // 沒有目標時約每 1.4 秒一個空資料框

    // 與韌體相同的分級
    let lead: { d: number; kmh: number } | null = null;
    let bestTtc = Infinity;
    for (const r of reported) {
      const ttc = r.kmh > 1.8 ? Math.max(r.d, 0.5) / (r.kmh / 3.6) : Infinity;
      if (ttc < bestTtc) {
        bestTtc = ttc;
        lead = r;
      }
    }
    this.evidence = lead ? Math.min(4, this.evidence + 1) : Math.max(0, this.evidence - 1);
    const confirmed = this.evidence >= 2 && lead !== null;
    let raw = 0;
    if (confirmed && lead) {
      if (lead.d <= REAR_DANGER_DIST_M || bestTtc <= cfg.ttcS) raw = 2;
      else if (lead.d <= cfg.rangeM) raw = 1;
    }
    if (raw >= 1) this.lastCaution = this.t;
    if (raw === 2) this.lastDanger = this.t;
    const hold = REAR_HOLD_MS / 1000;
    const level = this.t - this.lastDanger <= hold ? 2 : this.t - this.lastCaution <= hold ? 1 : 0;
    const changed = level !== this.level;
    if (this.level === 0 && level > 0) this.alerts++;
    this.level = level;

    const busy = active || level > 0;
    if (!changed && this.t - this.lastSentS < (busy ? 0.099 : 0.499)) return null;
    this.lastSentS = this.t;
    const leadOk = confirmed && lead !== null;
    const x = reported.length ? ` X=${reported.map((r) => `${r.angle}/${r.d}/${r.kmh}`).join(',')}` : '';
    return (
      `REAR ON=1 RO=0 LV=${level} D=${leadOk && lead ? lead.d.toFixed(1) : '-1.0'} V=${leadOk && lead ? (lead.kmh / 3.6).toFixed(2) : '0.00'} ` +
      `TTC=${leadOk && Number.isFinite(bestTtc) ? bestTtc.toFixed(1) : '-1.0'} HOLD=${level > 0 && raw === 0 ? 1 : 0} N=${reported.length} CNT=${this.alerts} FN=${this.frame}${x}`
    );
  }
}

export class DemoTransport implements RadarTransport {
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<TransportState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  // CAL：散射點平均偏向正下方 7.5° 時，30° 安裝的讀值偏低約 8.6%（韌體模擬報告的乾柏油校正結果）
  private config: EditableConfig = { ...DEFAULT_CONFIG, calibration: 1.0943 };
  private rearConfig: EditableRearConfig = { ...DEFAULT_REAR_CONFIG };
  private rear = new DemoRear();
  private t = 0;
  private frame = 0;
  private est = 0;
  private dr = 0;
  private dw = 0;
  private verdicts: number[] = [];

  onLine(listener: (line: string) => void) {
    return this.lines.on(listener);
  }

  onState(listener: (state: TransportState) => void) {
    return this.states.on(listener);
  }

  async connect(): Promise<void> {
    this.states.emit({ status: 'connecting', deviceName: DEMO_DEVICE_NAME });
    await new Promise((r) => setTimeout(r, 400));
    this.states.emit({ status: 'connected', deviceName: DEMO_DEVICE_NAME });
    this.timer = setInterval(() => this.tick(), 100);
  }

  async reconnectKnownDevice(): Promise<boolean> {
    await this.connect();
    return true;
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.states.emit({ status: 'idle' });
  }

  async send(line: string): Promise<void> {
    const [cmd = '', arg = ''] = line.trim().split(/\s+/);
    const v = Number(arg);
    const c = this.config;
    switch (cmd.toUpperCase()) {
      case 'GET':
        break;
      case 'ANGLE':
        c.angleDeg = v;
        break;
      case 'HEIGHT':
        c.heightM = v;
        break;
      case 'DIR':
        c.direction = v === -1 ? -1 : 1;
        break;
      case 'MODEL':
        c.model = v === 1 ? 'rangeGeometry' : 'fixedAngle';
        break;
      case 'CAL':
        c.calibration = v;
        break;
      case 'GSNR':
        c.radarSnr = v;
        break;
      case 'WHEEL':
        c.wheelMm = v;
        break;
      case 'RANGE':
        this.rearConfig.rangeM = v;
        break;
      case 'RSPD':
        this.rearConfig.minSpeedKmh = v;
        break;
      case 'TTC':
        this.rearConfig.ttcS = v;
        break;
      case 'RSNR':
        this.rearConfig.snr = v;
        break;
      case 'DEFAULTS':
        this.config = { ...DEFAULT_CONFIG };
        this.rearConfig = { ...DEFAULT_REAR_CONFIG };
        break;
      default:
        this.reply('OK demo');
        return;
    }
    if (cmd.toUpperCase() !== 'GET') this.reply('OK saved');
    this.reply(this.cfgLine());
  }

  private reply(text: string) {
    setTimeout(() => this.lines.emit(text), 60);
  }

  private cfgLine(): string {
    const c = this.config;
    const w = groundWindow(c.angleDeg, c.heightM);
    const r = this.rearConfig;
    return `CFG ANGLE=${c.angleDeg.toFixed(1)} HEIGHT=${c.heightM.toFixed(2)} DIR=${c.direction} MODEL=${c.model === 'rangeGeometry' ? 1 : 0} CAL=${c.calibration.toFixed(4)} GSNR=${c.radarSnr} WHEEL=${c.wheelMm} RMIN=${w.minM.toFixed(2)} RMAX=${w.maxM.toFixed(2)} RANGE=${r.rangeM} RSPD=${r.minSpeedKmh} TTC=${r.ttcS.toFixed(1)} RSNR=${r.snr} RDET=${rearDetectRange(r.rangeM)} FW=4.0.0`;
  }

  private tick() {
    this.t += 0.1;
    this.frame += 1;
    const c = this.config;
    const rad = (d: number) => (d * Math.PI) / 180;
    const v = profile(this.t);
    const moving = v > 0.05;

    let n = 0;
    let angle = 0;
    let rd = -1;
    let rv = 0;
    let snr = 0;
    let g = -1;
    let fv = 1;
    if (moving && Math.random() < 0.92) {
      // LD2451：每個資料框 1～3 個路面點（整數公尺、整數 km/h、整數度）。散射點偏向正下方（波束加權），
      // CAL 把平均偏差校正回來；韌體取換算後對地速度的中位數
      const points: { az: number; d: number; kmh: number; snr: number; g: number }[] = [];
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const el = c.angleDeg + 7.5 + 7 * gauss();
        const az = Math.round(8 * gauss());
        const kmh = Math.round(3.6 * (v * Math.cos(rad(az)) * Math.cos(rad(el)) + 0.08 * gauss()));
        if (kmh <= 0) continue;
        points.push({
          az,
          d: Math.round(c.heightM / (Math.cos(rad(az)) * Math.sin(rad(el)))),
          kmh,
          snr: Math.round(10 + Math.random() * 40),
          g: (c.calibration * kmh) / 3.6 / (Math.cos(rad(c.angleDeg)) * Math.cos(rad(az))),
        });
      }
      points.sort((p, q) => p.g - q.g);
      const mid = points[Math.floor(points.length / 2)];
      const lower = points[points.length / 2 - 1];
      if (mid) {
        n = points.length;
        angle = mid.az;
        rd = mid.d;
        rv = (c.direction * mid.kmh) / 3.6;
        snr = mid.snr;
        g = points.length % 2 === 0 && lower ? (lower.g + mid.g) / 2 : mid.g;
        fv = Math.abs(g - this.est) > 2.5 && this.est > 1 ? 7 : 0;
      }
    } else if (Math.random() < 0.03) {
      // 窗口外的雜散目標（10 m 外）
      n = 1;
      angle = Math.round(-20 + Math.random() * 40);
      rd = 10;
      rv = Math.round(-7 + Math.random() * 29) / 3.6;
      snr = Math.round(10 + Math.random() * 30);
      g = -1;
      fv = 3;
    }
    // 韌體輸出（卡爾曼濾波後）：真實速度落後約 0.2 秒、1σ 約 1.5%
    const lagged = profile(Math.max(0, this.t - 0.2));
    this.est = lagged > 0.05 ? lagged * (1 + 0.015 * gauss()) : 0;
    const state = this.est > 0.3 ? 3 : 1;
    const speed = state === 3 ? this.est : 0;
    this.dr += v * 1.004 * 0.1; // 韌體的里程用量測積分：沒有濾波落後，只剩校正殘差（約 0.4%）
    const wheel = v;
    this.dw += wheel * 0.1;
    this.verdicts = [...this.verdicts.slice(-19), fv];
    const q = Math.round((100 * this.verdicts.filter((x) => x === 0).length) / this.verdicts.length);
    const sd = state === 3 ? 0.12 + 0.03 * speed : 0;

    const rearLine = this.rear.step(this.rearConfig);
    if (rearLine) this.lines.emit(rearLine);
    this.lines.emit(
      `R=1 RO=0 ST=${state} V=${speed.toFixed(2)} SD=${sd.toFixed(2)} Q=${q} WD=0 FN=${this.frame} N=${n} A=${angle} RD=${rd} RV=${rv.toFixed(2)} S=${snr} G=${g.toFixed(2)} FV=${fv} DR=${this.dr.toFixed(1)} W=${wheel.toFixed(2)} DW=${this.dw.toFixed(1)} T=${Math.floor(300 + this.t)}`,
    );
  }
}

/** 固定種子的亂數（示範的行程每次都一樣，截圖才穩定） */
function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}

/**
 * 示範模式的行程紀錄：幾段通勤（巡航、紅燈停等、偶爾超過 25 km/h），每秒一筆模擬速度，
 * 用和實際一樣的 TraceBuilder 產生速度曲線。
 */
export function demoTrips(now: number): SavedTrip[] {
  const plans = [
    { agoMin: 190, minutes: 24, cruise: 5.6, seed: 7 },
    { agoMin: 60 * 24 - 35, minutes: 18, cruise: 5.2, seed: 11 },
    { agoMin: 60 * 26 + 10, minutes: 31, cruise: 5.8, seed: 23 },
    { agoMin: 60 * 72 + 50, minutes: 12, cruise: 4.8, seed: 5 },
    { agoMin: 60 * 98, minutes: 42, cruise: 5.5, seed: 31 },
  ];
  const limitMps = 25 / 3.6;
  return plans.map((p) => {
    const rand = seeded(p.seed);
    const startedAt = now - p.agoMin * 60_000;
    const total = p.minutes * 60;
    const trace = new TraceBuilder();
    let v = 0;
    let target = p.cruise;
    let stopUntil = -1;
    let distanceM = 0;
    let movingS = 0;
    let maxMps = 0;
    let overS = 0;
    let overCount = 0;
    let over = NO_OVERSPEED;
    for (let t = 0; t < total; t++) {
      if (t % 45 === 0) target = p.cruise + (rand() - 0.45) * 2.2; // 每 45 秒換一個巡航速度
      if (stopUntil < t && rand() < 0.006 && t > 60 && t < total - 60) stopUntil = t + 20 + Math.floor(rand() * 35); // 紅燈
      const goal = t < stopUntil || t > total - 8 ? 0 : target;
      v += Math.max(-1.6, Math.min(1.1, goal - v)) * 0.5 + (rand() - 0.5) * 0.15;
      v = Math.max(0, v);
      trace.update({ receivedAt: startedAt + t * 1000, speedMps: v });
      distanceM += v;
      if (v >= 0.5) movingS += 1;
      maxMps = Math.max(maxMps, v);
      // 和網頁一樣的超速判斷（持續 0.5 秒進入、低於速限 − 1 km/h 持續 1 秒解除）
      const next = stepOverspeed(over, overspeedEvidence({ state: 'tracking', speedMps: v }, limitMps), startedAt + t * 1000);
      if (next.active && !over.active) overCount += 1;
      if (next.active && over.active) overS += 1;
      over = next;
    }
    return {
      id: `demo-${p.seed}`,
      startedAt,
      endedAt: startedAt + total * 1000,
      distanceM,
      movingS,
      maxMps,
      wheelDistanceM: distanceM * (1 - 0.004 + rand() * 0.008),
      overspeedS: overS,
      overspeedCount: overCount,
      rearAlerts: Math.round(p.minutes * (0.4 + rand() * 0.6)),
      limitKmh: 25,
      trace: trace.snapshot(),
    };
  });
}
