/**
 * 【領域層】ESP32 ⇄ 網頁的文字協定（與韌體 src/comm/Telemetry、CommandParser 對應）。
 *
 * ESP32 → 網頁（每行以 '\n' 結尾）：
 *   R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35
 *   CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 FW=2.0.0
 *   OK saved / ERR <原因>
 * 網頁 → ESP32：GET、TEST、MINSPD、MINE、RANGE、SIGN、DTTC、DDIST、HOLD、CONFIRM、DEFAULTS、REBOOT
 */
import type { AlertLevel, DeviceCommand, DeviceConfig, ParsedLine, VelocitySource } from './types';

/** 各參數允許範圍（與韌體 DetectionConfig.h 的 limits 相同） */
export const COMMAND_LIMITS = {
  minSpeedMps: { min: 0.05, max: 10 },
  minEnergy: { min: 0, max: 100_000_000 },
  warnRangeM: { min: 1, max: 20 },
  dangerTtcS: { min: 0.5, max: 5 },
  dangerDistM: { min: 1, max: 10 },
  holdMs: { min: 200, max: 5000 },
  confirmHits: { min: 1, max: 6 },
} as const;

/** 韌體預設值（DetectionConfig::defaults） */
export const DEFAULT_DEVICE_CONFIG: Omit<DeviceConfig, 'firmware'> = {
  testMode: true,
  minSpeedMps: 1.5,
  minEnergy: 0,
  warnRangeM: 15,
  approachSign: -1,
  dangerTtcS: 1.5,
  dangerDistM: 4,
  holdMs: 1000,
  confirmHits: 3,
};

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

/** 韌體用負數表示「沒有」（例如 D=-1） */
function nonNegative(value: number | undefined): number | null {
  return value !== undefined && value >= 0 ? value : null;
}

const VELOCITY_SOURCES: readonly VelocitySource[] = ['none', 'checking', 'doppler', 'unfolded', 'rangeRate', 'signFlip'];

function toVelocitySource(value: number | undefined): VelocitySource | null {
  if (value === undefined || !Number.isInteger(value)) return null;
  return VELOCITY_SOURCES[value] ?? null;
}

function toLevel(value: number | undefined, warning: boolean): AlertLevel {
  if (value === 2) return 2;
  if (value === 1) return 1;
  if (value === 0) return 0;
  return warning ? 1 : 0;
}

function parseTelemetry(text: string): ParsedLine {
  const p = parsePairs(text);
  if (!p || (!p.has('R') && !p.has('L') && !p.has('D'))) return { kind: 'unknown', text };

  const warningFlag = num(p, 'W') === 1;
  const level = toLevel(num(p, 'L'), warningFlag);
  const distanceM = nonNegative(num(p, 'D'));
  const rawTargets = Math.max(0, Math.round(num(p, 'N') ?? 0));
  const closing = num(p, 'V');

  return {
    kind: 'telemetry',
    telemetry: {
      radarOnline: num(p, 'R') === 1,
      warning: warningFlag || level > 0,
      level,
      distanceM,
      closingMps: distanceM !== null && closing !== undefined ? closing : null,
      ttcS: nonNegative(num(p, 'TTC')),
      rawTargets,
      rawRangeM: rawTargets > 0 ? nonNegative(num(p, 'RD')) : null,
      rawSpeedMps: rawTargets > 0 ? (num(p, 'RV') ?? null) : null,
      energy: Math.max(0, num(p, 'E') ?? 0),
      uptimeS: Math.max(0, num(p, 'T') ?? 0),
      ownSpeedKmh: num(p, 'S') ?? null,
      velocitySource: toVelocitySource(num(p, 'VS')),
      rangeRateMps: num(p, 'RR') ?? null,
    },
  };
}

function parseConfig(text: string): ParsedLine {
  const p = parsePairs(text.slice(3));
  if (!p) return { kind: 'unknown', text };
  const test = num(p, 'TEST');
  const minSpeed = num(p, 'MINSPD');
  const minEnergy = num(p, 'MINE');
  const range = num(p, 'RANGE');
  const sign = num(p, 'SIGN');
  if (test === undefined || minSpeed === undefined || minEnergy === undefined || range === undefined) {
    return { kind: 'unknown', text };
  }
  if (sign !== -1 && sign !== 0 && sign !== 1) return { kind: 'unknown', text };
  const d = DEFAULT_DEVICE_CONFIG;
  return {
    kind: 'config',
    config: {
      testMode: test === 1,
      minSpeedMps: minSpeed,
      minEnergy,
      warnRangeM: range,
      approachSign: sign,
      // 較舊的韌體沒有這四個欄位時用預設值
      dangerTtcS: num(p, 'DTTC') ?? d.dangerTtcS,
      dangerDistM: num(p, 'DDIST') ?? d.dangerDistM,
      holdMs: num(p, 'HOLD') ?? d.holdMs,
      confirmHits: num(p, 'CONFIRM') ?? d.confirmHits,
      firmware: p.get('FW') ?? '?',
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

function assertRange(value: number, limits: { min: number; max: number }, name: string): void {
  if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
    throw new RangeError(`${name} 必須介於 ${limits.min} 到 ${limits.max}`);
  }
}

function assertInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new RangeError(`${name} 必須是整數`);
}

/** 把小數多餘的 0 去掉：1.50 → "1.5" */
function compact(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** 產生要送給 ESP32 的指令文字（不含換行）；數值超出範圍會丟 RangeError */
export function buildCommand(cmd: DeviceCommand): string {
  const L = COMMAND_LIMITS;
  switch (cmd.type) {
    case 'get':
      return 'GET';
    case 'defaults':
      return 'DEFAULTS';
    case 'reboot':
      return 'REBOOT';
    case 'testMode':
      return `TEST ${cmd.enabled ? 1 : 0}`;
    case 'minSpeed':
      assertRange(cmd.mps, L.minSpeedMps, '接近速度門檻');
      return `MINSPD ${compact(cmd.mps, 2)}`;
    case 'minEnergy':
      assertRange(cmd.value, L.minEnergy, '能量門檻');
      assertInteger(cmd.value, '能量門檻');
      return `MINE ${cmd.value}`;
    case 'warnRange':
      assertRange(cmd.meters, L.warnRangeM, '警示距離');
      return `RANGE ${compact(cmd.meters, 1)}`;
    case 'approachSign':
      return `SIGN ${cmd.sign}`;
    case 'dangerTtc':
      assertRange(cmd.seconds, L.dangerTtcS, '危險到達時間');
      return `DTTC ${compact(cmd.seconds, 1)}`;
    case 'dangerDist':
      assertRange(cmd.meters, L.dangerDistM, '危險距離');
      return `DDIST ${compact(cmd.meters, 1)}`;
    case 'hold':
      assertRange(cmd.ms, L.holdMs, '警示保持時間');
      assertInteger(cmd.ms, '警示保持時間');
      return `HOLD ${cmd.ms}`;
    case 'confirm':
      assertRange(cmd.hits, L.confirmHits, '確認筆數');
      assertInteger(cmd.hits, '確認筆數');
      return `CONFIRM ${cmd.hits}`;
  }
}

/** 比較兩份設定，回傳需要送出的指令（只送有變的） */
export function diffConfig(current: DeviceConfig, next: DeviceConfig): DeviceCommand[] {
  const cmds: DeviceCommand[] = [];
  if (current.testMode !== next.testMode) cmds.push({ type: 'testMode', enabled: next.testMode });
  if (current.minSpeedMps !== next.minSpeedMps) cmds.push({ type: 'minSpeed', mps: next.minSpeedMps });
  if (current.minEnergy !== next.minEnergy) cmds.push({ type: 'minEnergy', value: next.minEnergy });
  if (current.warnRangeM !== next.warnRangeM) cmds.push({ type: 'warnRange', meters: next.warnRangeM });
  if (current.approachSign !== next.approachSign) cmds.push({ type: 'approachSign', sign: next.approachSign });
  if (current.dangerTtcS !== next.dangerTtcS) cmds.push({ type: 'dangerTtc', seconds: next.dangerTtcS });
  if (current.dangerDistM !== next.dangerDistM) cmds.push({ type: 'dangerDist', meters: next.dangerDistM });
  if (current.holdMs !== next.holdMs) cmds.push({ type: 'hold', ms: next.holdMs });
  if (current.confirmHits !== next.confirmHits) cmds.push({ type: 'confirm', hits: next.confirmHits });
  return cmds;
}
