import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, buildCommand, diffConfig, firmwareMajor, groundWindow, parseLine, unambiguousGroundMps } from './protocol';

describe('parseLine：遙測', () => {
  it('追蹤中的一行（含輪速）', () => {
    const p = parseLine('R=1 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=1 RD=0.86 RV=3.84 E=52000 G=5.40 FV=0 DR=1234.5 W=5.51 DW=1240.2 T=812');
    expect(p.kind).toBe('telemetry');
    if (p.kind !== 'telemetry') return;
    expect(p.telemetry).toEqual({
      radarOnline: true,
      state: 'tracking',
      speedMps: 5.43,
      sigmaMps: 0.12,
      qualityPct: 95,
      wrongDirPct: 0,
      frame: 1234,
      targets: 1,
      rangeM: 0.86,
      radialMps: 3.84,
      energy: 52000,
      groundMps: 5.4,
      verdict: 'accepted',
      radarDistanceM: 1234.5,
      wheelMps: 5.51,
      wheelDistanceM: 1240.2,
      uptimeS: 812,
    });
  });

  it('沒有目標、速度未知、沒接輪速感測器', () => {
    const p = parseLine('R=1 ST=5 V=-1.00 SD=0.00 Q=0 WD=0 FN=7 N=0 RD=-1.00 RV=0.00 E=0 G=-1.00 FV=1 DR=10.0 T=3');
    if (p.kind !== 'telemetry') throw new Error('應該是遙測');
    expect(p.telemetry.state).toBe('lost');
    expect(p.telemetry.speedMps).toBeNull();
    expect(p.telemetry.rangeM).toBeNull();
    expect(p.telemetry.radialMps).toBeNull();
    expect(p.telemetry.groundMps).toBeNull();
    expect(p.telemetry.verdict).toBe('noTarget');
    expect(p.telemetry.wheelMps).toBeNull();
    expect(p.telemetry.wheelDistanceM).toBeNull();
  });

  it('狀態與判斷碼', () => {
    const states = ['noRadar', 'stopped', 'acquiring', 'tracking', 'holding', 'lost', 'overRange'];
    const u = parseLine('R=1 ST=3 V=5 FV=9');
    expect(u.kind === 'telemetry' && u.telemetry.verdict).toBe('unfolded');
    states.forEach((s, i) => {
      const p = parseLine(`R=1 ST=${i} V=0 FV=${i}`);
      expect(p.kind === 'telemetry' && p.telemetry.state).toBe(s);
    });
    const p = parseLine('R=1 ST=99 V=0 FV=99');
    expect(p.kind === 'telemetry' && p.telemetry.state).toBe('noRadar');
    expect(p.kind === 'telemetry' && p.telemetry.verdict).toBe('noTarget');
    const v = parseLine('R=1 ST=3 V=1 FV=4');
    expect(v.kind === 'telemetry' && v.telemetry.verdict).toBe('wrongDirection');
  });

  it('壞資料：重複的鍵（兩行黏在一起）、缺必要欄位', () => {
    expect(parseLine('R=1 ST=3 V=5 R=1 ST=3').kind).toBe('unknown');
    expect(parseLine('R=1 V=5').kind).toBe('unknown');
    expect(parseLine('hello').kind).toBe('unknown');
    expect(parseLine('').kind).toBe('unknown');
  });

  it('數值夾在合理範圍', () => {
    const p = parseLine('R=1 ST=3 V=5 Q=180 WD=-3 E=-5 W=-1 DW=4');
    if (p.kind !== 'telemetry') throw new Error('應該是遙測');
    expect(p.telemetry.qualityPct).toBe(100);
    expect(p.telemetry.wrongDirPct).toBe(0);
    expect(p.telemetry.energy).toBe(0);
    expect(p.telemetry.wheelMps).toBe(0);
  });
});

describe('parseLine：設定與回覆', () => {
  it('CFG', () => {
    const p = parseLine('CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=1 CAL=1.0425 RTHR=5 WHEEL=2105 VMAX=3.2 RMIN=0.62 RMAX=2.15 FW=3.0.0');
    expect(p).toEqual({
      kind: 'config',
      config: {
        angleDeg: 45,
        heightM: 0.7,
        direction: 1,
        model: 'rangeGeometry',
        calibration: 1.0425,
        radarThreshold: 5,
        wheelMm: 2105,
        radialLimitMps: 3.2,
        gateMinM: 0.62,
        gateMaxM: 2.15,
        firmware: '3.0.0',
      },
    });
  });

  it('舊版（後方來車偵測）韌體的 CFG', () => {
    const p = parseLine('CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1 DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 RTHR=5 WHEEL=2105 FW=2.4.0');
    expect(p).toEqual({ kind: 'legacyConfig', firmware: '2.4.0' });
  });

  it('不完整的 CFG', () => {
    expect(parseLine('CFG ANGLE=45 HEIGHT=0.7 DIR=0 CAL=1').kind).toBe('unknown');
    expect(parseLine('CFG ANGLE=45 DIR=1 CAL=1').kind).toBe('unknown');
  });

  it('OK / ERR', () => {
    expect(parseLine('OK saved')).toEqual({ kind: 'ack', ok: true, message: 'saved' });
    expect(parseLine('ERR ANGLE must be 15-75 (deg)')).toEqual({ kind: 'ack', ok: false, message: 'ANGLE must be 15-75 (deg)' });
  });

  it('韌體主版本', () => {
    expect(firmwareMajor('3.0.0')).toBe(3);
    expect(firmwareMajor('2.4.0')).toBe(2);
    expect(firmwareMajor('?')).toBeNull();
  });
});

describe('buildCommand', () => {
  it('產生指令文字', () => {
    expect(buildCommand({ type: 'get' })).toBe('GET');
    expect(buildCommand({ type: 'angle', deg: 42.5 })).toBe('ANGLE 42.5');
    expect(buildCommand({ type: 'height', m: 0.706 })).toBe('HEIGHT 0.71');
    expect(buildCommand({ type: 'direction', dir: -1 })).toBe('DIR -1');
    expect(buildCommand({ type: 'model', model: 'rangeGeometry' })).toBe('MODEL 1');
    expect(buildCommand({ type: 'model', model: 'fixedAngle' })).toBe('MODEL 0');
    expect(buildCommand({ type: 'calibration', factor: 1.04251 })).toBe('CAL 1.0425');
    expect(buildCommand({ type: 'radarThreshold', value: 8 })).toBe('RTHR 8');
    expect(buildCommand({ type: 'wheel', mm: 2096 })).toBe('WHEEL 2096');
    expect(buildCommand({ type: 'radialLimit', mps: 3.28 })).toBe('VMAX 3.28');
    expect(buildCommand({ type: 'radialLimit', mps: 10 })).toBe('VMAX 10');
    expect(buildCommand({ type: 'defaults' })).toBe('DEFAULTS');
    expect(buildCommand({ type: 'reboot' })).toBe('REBOOT');
  });

  it('超出範圍或不是整數：丟出中文錯誤', () => {
    expect(() => buildCommand({ type: 'angle', deg: 80 })).toThrow(/安裝角度/);
    expect(() => buildCommand({ type: 'height', m: 0.1 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'calibration', factor: 2.5 })).toThrow(/校正係數/);
    expect(() => buildCommand({ type: 'radarThreshold', value: 5.5 })).toThrow(/整數/);
    expect(() => buildCommand({ type: 'wheel', mm: Number.NaN })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'radialLimit', mps: 1 })).toThrow(/測速上限/);
  });
});

describe('diffConfig', () => {
  it('只送有變的參數（以送出的精度比較）', () => {
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG })).toEqual([]);
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, heightM: 0.70004 })).toEqual([]);
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, angleDeg: 40, direction: -1, calibration: 1.1 })).toEqual([
      { type: 'angle', deg: 40 },
      { type: 'direction', dir: -1 },
      { type: 'calibration', factor: 1.1 },
    ]);
  });
});

describe('unambiguousGroundMps', () => {
  it('VMAX 3.28、俯角 45° → 約 16.7 km/h', () => {
    expect(unambiguousGroundMps(3.28, 45) * 3.6).toBeCloseTo(16.7, 1);
    expect(unambiguousGroundMps(10, 45) * 3.6).toBeCloseTo(50.9, 1);
  });
});

describe('groundWindow（與韌體相同）', () => {
  it('45°、0.70 m', () => {
    const w = groundWindow(45, 0.7);
    expect(w.minM).toBeCloseTo(0.7 / Math.sin((75 * Math.PI) / 180) - 0.1, 3);
    expect(w.maxM).toBeCloseTo(0.7 / Math.sin((20 * Math.PI) / 180) + 0.1, 3);
    expect(w.boresightM).toBeCloseTo(0.99, 2);
  });

  it('很低的安裝：最近距離不小於 0.3 m', () => {
    expect(groundWindow(30, 0.15).minM).toBeGreaterThanOrEqual(0.3);
  });
});
