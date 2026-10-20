/**
 * 【領域層】ESP32 ⇄ 網頁的文字協定（與韌體 3.0 的 src/comm/Telemetry、CommandParser 對應，見 docs/PROTOCOL.md）。
 *
 * ESP32 → 網頁（每行以 '\n' 結尾）：
 *   R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.5 W=5.51 DW=1240.2 T=812
 *   CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=3.28 RMIN=0.62 RMAX=2.15 FW=3.0.0
 *   OK saved / ERR <原因>
 * 網頁 → ESP32：GET、ANGLE、HEIGHT、DIR、MODEL、CAL、RTHR、WHEEL、VMAX、DEFAULTS、REBOOT
 */
import type { DeviceCommand, EditableConfig, FrameVerdict, ParsedLine, SpeedModel, SpeedState } from './types';

/** 各參數允許範圍（與韌體 SpeedConfig.h 的 limits 相同） */
export const LIMITS = {
  angleDeg: { min: 15, max: 75 },
  heightM: { min: 0.15, max: 1.5 },
  calibration: { min: 0.5, max: 2 },
  radarThreshold: { min: 1, max: 50 },
  wheelMm: { min: 1000, max: 3000 },
  radialLimitMps: { min: 2, max: 20 },
} as const;

/** 韌體預設值（SpeedConfig::defaults） */
export const DEFAULT_CONFIG: EditableConfig = {
  angleDeg: 45,
  heightM: 0.7,
  direction: 1,
  model: 'fixedAngle',
  calibration: 1,
  radarThreshold: 5,
  wheelMm: 2105,
  radialLimitMps: 3.28,
};

/** 這個網頁對應的韌體主版本 */
export const FIRMWARE_MAJOR = 3;

const STATES: readonly SpeedState[] = ['noRadar', 'stopped', 'acquiring', 'tracking', 'holding', 'lost', 'overRange'];
const VERDICTS: readonly FrameVerdict[] = [
  'accepted',
  'noTarget',
  'repeated',
  'outOfGate',
  'wrongDirection',
  'static',
  'atLimit',
  'outlier',
  'acquiring',
  'unfolded',
];
const MODELS: readonly SpeedModel[] = ['fixedAngle', 'rangeGeometry'];

/**
 * 把 "A=1 B=2" 拆成 Map（鍵一律轉大寫，順序不拘，格式不對的片段略過）。
 * 同一個鍵出現兩次代表兩行被黏在一起（藍牙分段遺失），整行不採用，回傳 null。
 */
function parsePairs(text: string): Map<string, string> | null {
  const pairs = new Map<string, string>();
  for (const token of text.trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0 || eq === token.length - 1) continue;
    const key = token.slice(0, eq).toUpperCase();
    if (pairs.has(key)) return null;
    pairs.set(key, token.slice(eq + 1));
  }
  return pairs;
}

function num(pairs: Map<string, string>, key: string): number | undefined {
  const raw = pairs.get(key);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** 韌體用負數表示「沒有」（例如 V=-1、RD=-1、G=-1） */
function nonNegative(value: number | undefined): number | null {
  return value !== undefined && value >= 0 ? value : null;
}

function pick<T>(list: readonly T[], index: number | undefined, fallback: T): T {
  if (index === undefined || !Number.isInteger(index)) return fallback;
  return list[index] ?? fallback;
}

function parseTelemetry(text: string): ParsedLine {
  const p = parsePairs(text);
  if (!p || !p.has('R') || !p.has('ST') || !p.has('V')) return { kind: 'unknown', text };

  const targets = Math.max(0, Math.round(num(p, 'N') ?? 0));
  const wheelMps = num(p, 'W');
  return {
    kind: 'telemetry',
    telemetry: {
      radarOnline: num(p, 'R') === 1,
      state: pick(STATES, num(p, 'ST'), 'noRadar'),
      speedMps: nonNegative(num(p, 'V')),
      sigmaMps: Math.max(0, num(p, 'SD') ?? 0),
      qualityPct: Math.min(100, Math.max(0, num(p, 'Q') ?? 0)),
      wrongDirPct: Math.min(100, Math.max(0, num(p, 'WD') ?? 0)),
      frame: Math.max(0, num(p, 'FN') ?? 0),
      targets,
      rangeM: targets > 0 ? nonNegative(num(p, 'RD')) : null,
      radialMps: targets > 0 ? (num(p, 'RV') ?? null) : null,
      energy: Math.max(0, num(p, 'E') ?? 0),
      groundMps: nonNegative(num(p, 'G')),
      verdict: pick(VERDICTS, num(p, 'FV'), 'noTarget'),
      radarDistanceM: Math.max(0, num(p, 'DR') ?? 0),
      wheelMps: wheelMps === undefined ? null : Math.max(0, wheelMps),
      wheelDistanceM: wheelMps === undefined ? null : Math.max(0, num(p, 'DW') ?? 0),
      uptimeS: Math.max(0, num(p, 'T') ?? 0),
    },
  };
}

function parseConfig(text: string): ParsedLine {
  const p = parsePairs(text.slice(3));
  if (!p) return { kind: 'unknown', text };
  const firmware = p.get('FW') ?? '?';
  // 3.0 以前的韌體是後方來車偵測版（TEST、MINSPD…），協定不相容
  if (p.has('TEST') || p.has('MINSPD')) return { kind: 'legacyConfig', firmware };

  const angle = num(p, 'ANGLE');
  const height = num(p, 'HEIGHT');
  const dir = num(p, 'DIR');
  const model = num(p, 'MODEL');
  const cal = num(p, 'CAL');
  if (angle === undefined || height === undefined || cal === undefined || (dir !== 1 && dir !== -1)) {
    return { kind: 'unknown', text };
  }
  const d = DEFAULT_CONFIG;
  return {
    kind: 'config',
    config: {
      angleDeg: angle,
      heightM: height,
      direction: dir,
      model: pick(MODELS, model, d.model),
      calibration: cal,
      radarThreshold: num(p, 'RTHR') ?? d.radarThreshold,
      wheelMm: num(p, 'WHEEL') ?? d.wheelMm,
      radialLimitMps: num(p, 'VMAX') ?? d.radialLimitMps,
      gateMinM: num(p, 'RMIN') ?? 0,
      gateMaxM: num(p, 'RMAX') ?? 0,
      firmware,
    },
  };
}

/** 解析一行 ESP32 送來的文字 */
export function parseLine(line: string): ParsedLine {
  const text = line.trim();
  if (text === '') return { kind: 'unknown', text };

  const head = text.split(/\s+/, 1)[0]?.toUpperCase() ?? '';
  if (head === 'CFG') return parseConfig(text);
  if (head === 'OK' || head === 'ERR') {
    return { kind: 'ack', ok: head === 'OK', message: text.slice(head.length).trim() };
  }
  return parseTelemetry(text);
}

/** 韌體版本字串的主版本（"3.0.1" → 3；看不懂時 null） */
export function firmwareMajor(version: string): number | null {
  const m = /^(\d+)\./.exec(version);
  return m?.[1] ? Number(m[1]) : null;
}

function assertRange(value: number, limits: { min: number; max: number }, name: string): void {
  if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
    throw new RangeError(`${name}必須介於 ${limits.min} 到 ${limits.max}`);
  }
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new RangeError(`${name}必須是整數`);
}

/** 把小數多餘的 0 去掉：1.50 → "1.5" */
function compact(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** 產生要送給 ESP32 的指令文字（不含換行）；數值超出範圍會丟 RangeError（訊息為中文） */
export function buildCommand(cmd: DeviceCommand): string {
  switch (cmd.type) {
    case 'get':
      return 'GET';
    case 'defaults':
      return 'DEFAULTS';
    case 'reboot':
      return 'REBOOT';
    case 'angle':
      assertRange(cmd.deg, LIMITS.angleDeg, '安裝角度');
      return `ANGLE ${compact(cmd.deg, 1)}`;
    case 'height':
      assertRange(cmd.m, LIMITS.heightM, '安裝高度');
      return `HEIGHT ${compact(cmd.m, 2)}`;
    case 'direction':
      return `DIR ${cmd.dir}`;
    case 'model':
      return `MODEL ${cmd.model === 'rangeGeometry' ? 1 : 0}`;
    case 'calibration':
      assertRange(cmd.factor, LIMITS.calibration, '校正係數');
      return `CAL ${compact(cmd.factor, 4)}`;
    case 'radarThreshold':
      assertRange(cmd.value, LIMITS.radarThreshold, '雷達門檻');
      assertInteger(cmd.value, '雷達門檻');
      return `RTHR ${cmd.value}`;
    case 'wheel':
      assertRange(cmd.mm, LIMITS.wheelMm, '輪周長');
      assertInteger(cmd.mm, '輪周長');
      return `WHEEL ${cmd.mm}`;
    case 'radialLimit':
      assertRange(cmd.mps, LIMITS.radialLimitMps, '雷達測速上限');
      return `VMAX ${compact(cmd.mps, 2)}`;
  }
}

/** 比較兩份設定，回傳需要送出的指令（只送有變的；數值以送出的精度比較） */
export function diffConfig(current: EditableConfig, next: EditableConfig): DeviceCommand[] {
  const same = (a: number, b: number, digits: number) => a.toFixed(digits) === b.toFixed(digits);
  const cmds: DeviceCommand[] = [];
  if (!same(current.angleDeg, next.angleDeg, 1)) cmds.push({ type: 'angle', deg: next.angleDeg });
  if (!same(current.heightM, next.heightM, 2)) cmds.push({ type: 'height', m: next.heightM });
  if (current.direction !== next.direction) cmds.push({ type: 'direction', dir: next.direction });
  if (current.model !== next.model) cmds.push({ type: 'model', model: next.model });
  if (!same(current.calibration, next.calibration, 4)) cmds.push({ type: 'calibration', factor: next.calibration });
  if (current.radarThreshold !== next.radarThreshold) cmds.push({ type: 'radarThreshold', value: next.radarThreshold });
  if (current.wheelMm !== next.wheelMm) cmds.push({ type: 'wheel', mm: next.wheelMm });
  if (!same(current.radialLimitMps, next.radialLimitMps, 2)) cmds.push({ type: 'radialLimit', mps: next.radialLimitMps });
  return cmds;
}

/**
 * 雷達「不模糊」的最高對地速度（m/s）：徑向速度 = 對地速度 × cos θ，超過 VMAX 之後 C4001 的讀值會折疊
 * （韌體靠連續追蹤還原，見 docs/ALGORITHM.md §2）。
 */
export function unambiguousGroundMps(radialLimitMps: number, angleDeg: number, calibration = 1): number {
  return (calibration * radialLimitMps) / Math.cos((angleDeg * Math.PI) / 180);
}

/** 由安裝角度與高度算出的地面距離窗口（與韌體 groundWindow 相同，網頁預覽用） */
export function groundWindow(angleDeg: number, heightM: number): { minM: number; maxM: number; boresightM: number } {
  const rad = (d: number) => (d * Math.PI) / 180;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const steep = clamp(angleDeg + 30, 8, 85);
  const shallow = clamp(angleDeg - 25, 8, 85);
  return {
    minM: Math.max(0.3, heightM / Math.sin(rad(steep)) - 0.1),
    maxM: Math.min(25, heightM / Math.sin(rad(shallow)) + 0.1),
    boresightM: heightM / Math.sin(rad(angleDeg)),
  };
}
