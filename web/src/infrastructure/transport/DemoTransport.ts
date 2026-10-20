/**
 * 【基礎設施層】示範模式（網址加上 ?demo）：不需要硬體，產生與韌體相同格式的遙測，給展示、截圖與開發用。
 *
 * 模擬一段城市騎乘（起步、巡航、變速、停等），每 0.1 秒一筆資料框：路面散射點的俯角分散、
 * 偶爾沒有回波或雜散目標、輪速感測器參考值。速度輸出模擬校正後的韌體：約 0.2 秒落後、1σ 約 1.5%。
 */
import { DEFAULT_CONFIG } from '../../domain/protocol';
import type { EditableConfig } from '../../domain/types';
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

export class DemoTransport implements RadarTransport {
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<TransportState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: EditableConfig = { ...DEFAULT_CONFIG, calibration: 1.1621 };
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
      case 'RTHR':
        c.radarThreshold = v;
        break;
      case 'WHEEL':
        c.wheelMm = v;
        break;
      case 'VMAX':
        c.radialLimitMps = v;
        break;
      case 'DEFAULTS':
        this.config = { ...DEFAULT_CONFIG };
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
    const rad = (d: number) => (d * Math.PI) / 180;
    const rmin = Math.max(0.3, c.heightM / Math.sin(rad(Math.min(85, c.angleDeg + 30))) - 0.1);
    const rmax = c.heightM / Math.sin(rad(Math.max(8, c.angleDeg - 25))) + 0.1;
    return `CFG ANGLE=${c.angleDeg.toFixed(1)} HEIGHT=${c.heightM.toFixed(2)} DIR=${c.direction} MODEL=${c.model === 'rangeGeometry' ? 1 : 0} CAL=${c.calibration.toFixed(4)} RTHR=${c.radarThreshold} WHEEL=${c.wheelMm} VMAX=${c.radialLimitMps.toFixed(2)} RMIN=${rmin.toFixed(2)} RMAX=${rmax.toFixed(2)} FW=3.0.0`;
  }

  private tick() {
    this.t += 0.1;
    this.frame += 1;
    const c = this.config;
    const rad = (d: number) => (d * Math.PI) / 180;
    const v = profile(this.t);
    const moving = v > 0.05;

    let n = 0;
    let rd = -1;
    let rv = 0;
    let e = 0;
    let g = -1;
    let fv = 1;
    if (moving && Math.random() < 0.92) {
      // 散射點偏向正下方（波束加權），CAL 把平均偏差校正回來
      const a = c.angleDeg + 7.5 + 7 * gauss();
      n = 1;
      rd = c.heightM / Math.sin(rad(a)) + 0.03 * gauss();
      rv = c.direction * (v * Math.cos(rad(a)) + 0.08 * gauss());
      e = Math.round(20000 + Math.random() * 400000);
      g = (c.calibration * Math.abs(rv)) / Math.cos(rad(c.angleDeg));
      fv = Math.abs(g - this.est) > 2.5 && this.est > 1 ? 7 : 0;
    } else if (Math.random() < 0.03) {
      n = 1;
      rd = 0.8 + Math.random();
      rv = -2 + Math.random() * 8;
      e = Math.round(5000 + Math.random() * 50000);
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

    this.lines.emit(
      `R=1 ST=${state} V=${speed.toFixed(2)} SD=${sd.toFixed(2)} Q=${q} WD=0 FN=${this.frame} N=${n} RD=${rd.toFixed(2)} RV=${rv.toFixed(2)} E=${e} G=${g.toFixed(2)} FV=${fv} DR=${this.dr.toFixed(1)} W=${wheel.toFixed(2)} DW=${this.dw.toFixed(1)} T=${Math.floor(300 + this.t)}`,
    );
  }
}
