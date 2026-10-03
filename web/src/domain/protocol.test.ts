import { describe, expect, it } from 'vitest';
import { buildCommand, diffConfig, parseLine } from './protocol';
import type { DeviceConfig } from './types';

describe('parseLine：遙測', () => {
  it('解析完整的一行（與韌體輸出相同）', () => {
    const r = parseLine('R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35 VS=2 RR=6.11');
    expect(r.kind).toBe('telemetry');
    if (r.kind !== 'telemetry') return;
    expect(r.telemetry).toEqual({
      radarOnline: true,
      warning: true,
      level: 2,
      distanceM: 8.42,
      closingMps: 6.2,
      ttcS: 1.4,
      rawTargets: 1,
      rawRangeM: 8.5,
      rawSpeedMps: -6.31,
      energy: 52000,
      uptimeS: 35,
      ownSpeedKmh: null,
      velocitySource: 'doppler',
      rangeRateMps: 6.11,
    });
  });

  it('速度交叉核對欄位：VS 對照、RR 可省略、舊韌體沒有 VS', () => {
    const codes = ['none', 'checking', 'doppler', 'unfolded', 'rangeRate', 'signFlip'] as const;
    codes.forEach((code, i) => {
      const r = parseLine(`R=1 L=0 D=-1 VS=${i}`);
      if (r.kind !== 'telemetry') throw new Error('not telemetry');
      expect(r.telemetry.velocitySource).toBe(code);
      expect(r.telemetry.rangeRateMps).toBeNull();
    });
    const old = parseLine('R=1 W=0 L=0 D=-1.00 V=0.00 TTC=-1.0 N=0 RD=-1.00 RV=0.00 E=0 T=7');
    if (old.kind !== 'telemetry') throw new Error('not telemetry');
    expect(old.telemetry.velocitySource).toBeNull();
    const bad = parseLine('R=1 L=0 VS=9 RR=-3.5');
    if (bad.kind !== 'telemetry') throw new Error('not telemetry');
    expect(bad.telemetry.velocitySource).toBeNull();
    expect(bad.telemetry.rangeRateMps).toBe(-3.5);
  });

  it('沒有目標時 -1 變成 null', () => {
    const r = parseLine('R=0 W=0 L=0 D=-1.00 V=0.00 TTC=-1.0 N=0 RD=-1.00 RV=0.00 E=0 T=7');
    if (r.kind !== 'telemetry') throw new Error('not telemetry');
    expect(r.telemetry.radarOnline).toBe(false);
    expect(r.telemetry.distanceM).toBeNull();
    expect(r.telemetry.closingMps).toBeNull();
    expect(r.telemetry.ttcS).toBeNull();
    expect(r.telemetry.rawRangeM).toBeNull();
    expect(r.telemetry.rawSpeedMps).toBeNull();
  });

  it('鍵的順序不拘、未知鍵忽略、缺少的鍵不會壞', () => {
    const r = parseLine('T=9 FOO=bar L=1 R=1 S=18.5 junk D=12');
    if (r.kind !== 'telemetry') throw new Error('not telemetry');
    expect(r.telemetry.level).toBe(1);
    expect(r.telemetry.warning).toBe(true);
    expect(r.telemetry.distanceM).toBe(12);
    expect(r.telemetry.ownSpeedKmh).toBe(18.5);
    expect(r.telemetry.energy).toBe(0);
  });

  it('數字格式錯誤的欄位視為缺少', () => {
    const r = parseLine('R=1 L=abc W=1 D=x');
    if (r.kind !== 'telemetry') throw new Error('not telemetry');
    expect(r.telemetry.level).toBe(1); // L 壞掉時由 W 推得
    expect(r.telemetry.distanceM).toBeNull();
  });

  it('兩行被黏在一起（藍牙分段遺失）時整行丟掉，不顯示錯的數字', () => {
    expect(parseLine('R=1 W=1 L=2 D=8.42 V=6.R=1 W=0 L=0 D=-1.00 V=0.00 TTC=-1.0').kind).toBe('unknown');
  });

  it('雜訊與空白行回傳 unknown', () => {
    expect(parseLine('hello world').kind).toBe('unknown');
    expect(parseLine('   ').kind).toBe('unknown');
    expect(parseLine('sensorStart').kind).toBe('unknown');
  });
});

describe('parseLine：設定與回覆', () => {
  it('解析 CFG（全部 9 個參數）', () => {
    const r = parseLine('CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=2.0 DDIST=5.0 HOLD=1500 CONFIRM=2 FW=2.0.0');
    expect(r).toEqual({
      kind: 'config',
      config: {
        testMode: true,
        minSpeedMps: 1.5,
        minEnergy: 0,
        warnRangeM: 15,
        approachSign: -1,
        dangerTtcS: 2,
        dangerDistM: 5,
        holdMs: 1500,
        confirmHits: 2,
        firmware: '2.0.0',
      },
    });
  });

  it('較舊的 CFG 沒有新欄位時用預設值', () => {
    const r = parseLine('CFG TEST=0 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 FW=1.9');
    if (r.kind !== 'config') throw new Error('not config');
    expect(r.config).toMatchObject({ dangerTtcS: 1.5, dangerDistM: 4, holdMs: 1000, confirmHits: 3 });
  });

  it('CFG 缺欄位或 SIGN 不合法時不採用', () => {
    expect(parseLine('CFG TEST=1 MINSPD=1.5').kind).toBe('unknown');
    expect(parseLine('CFG TEST=1 MINSPD=1.5 MINE=0 RANGE=15 SIGN=5').kind).toBe('unknown');
  });

  it('解析 OK / ERR', () => {
    expect(parseLine('OK saved')).toEqual({ kind: 'ack', ok: true, message: 'saved' });
    expect(parseLine('ERR RANGE must be 1-20')).toEqual({ kind: 'ack', ok: false, message: 'RANGE must be 1-20' });
  });
});

describe('buildCommand', () => {
  it('產生與韌體相同的指令文字', () => {
    expect(buildCommand({ type: 'get' })).toBe('GET');
    expect(buildCommand({ type: 'testMode', enabled: false })).toBe('TEST 0');
    expect(buildCommand({ type: 'minSpeed', mps: 1.5 })).toBe('MINSPD 1.5');
    expect(buildCommand({ type: 'minEnergy', value: 50000 })).toBe('MINE 50000');
    expect(buildCommand({ type: 'warnRange', meters: 12.25 })).toBe('RANGE 12.3');
    expect(buildCommand({ type: 'approachSign', sign: -1 })).toBe('SIGN -1');
    expect(buildCommand({ type: 'defaults' })).toBe('DEFAULTS');
    expect(buildCommand({ type: 'reboot' })).toBe('REBOOT');
    expect(buildCommand({ type: 'dangerTtc', seconds: 2 })).toBe('DTTC 2');
    expect(buildCommand({ type: 'dangerDist', meters: 4.5 })).toBe('DDIST 4.5');
    expect(buildCommand({ type: 'hold', ms: 1500 })).toBe('HOLD 1500');
    expect(buildCommand({ type: 'confirm', hits: 2 })).toBe('CONFIRM 2');
  });

  it('數值超出範圍時丟出錯誤，不送出', () => {
    expect(() => buildCommand({ type: 'minSpeed', mps: 20 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'warnRange', meters: 0.5 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'minEnergy', value: 1.5 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'minEnergy', value: -1 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'minSpeed', mps: Number.NaN })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'dangerTtc', seconds: 9 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'hold', ms: 150.5 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'confirm', hits: 0 })).toThrow(RangeError);
  });

  it('每個指令都小於 20 bytes（BLE 一次寫入）', () => {
    expect(new TextEncoder().encode(`${buildCommand({ type: 'minEnergy', value: 100_000_000 })}\n`).length).toBeLessThan(20);
  });
});

describe('diffConfig', () => {
  const base: DeviceConfig = {
    testMode: true,
    minSpeedMps: 1.5,
    minEnergy: 0,
    warnRangeM: 15,
    approachSign: -1,
    dangerTtcS: 1.5,
    dangerDistM: 4,
    holdMs: 1000,
    confirmHits: 3,
    firmware: '2.0.0',
  };

  it('只送有改變的欄位', () => {
    expect(diffConfig(base, { ...base })).toEqual([]);
    expect(diffConfig(base, { ...base, testMode: false, minEnergy: 30000, holdMs: 2000 })).toEqual([
      { type: 'testMode', enabled: false },
      { type: 'minEnergy', value: 30000 },
      { type: 'hold', ms: 2000 },
    ]);
  });

});
