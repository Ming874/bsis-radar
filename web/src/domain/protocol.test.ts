import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_REAR_CONFIG,
  buildCommand,
  diffConfig,
  diffRearConfig,
  firmwareMajor,
  groundWindow,
  parseLine,
  rearDetectRange,
} from './protocol';

describe('parseLine：遙測', () => {
  it('追蹤中的一行（含輪速）', () => {
    const p = parseLine('R=1 RO=0 ST=3 V=5.43 SD=0.12 Q=95 WD=0 FN=1234 N=3 A=-2 RD=2 RV=3.89 S=12 G=5.40 FV=0 DR=1234.5 W=5.51 DW=1240.2 T=812');
    expect(p.kind).toBe('telemetry');
    if (p.kind !== 'telemetry') return;
    expect(p.telemetry).toEqual({
      radarOnline: true,
      receiveOnly: false,
      state: 'tracking',
      speedMps: 5.43,
      sigmaMps: 0.12,
      qualityPct: 95,
      wrongDirPct: 0,
      frame: 1234,
      targets: 3,
      angleDeg: -2,
      rangeM: 2,
      radialMps: 3.89,
      snr: 12,
      groundMps: 5.4,
      verdict: 'accepted',
      radarDistanceM: 1234.5,
      wheelMps: 5.51,
      wheelDistanceM: 1240.2,
      uptimeS: 812,
    });
  });

  it('沒有目標、速度未知、沒接輪速感測器', () => {
    const p = parseLine('R=1 RO=0 ST=5 V=-1.00 SD=0.00 Q=0 WD=0 FN=7 N=0 A=0 RD=-1 RV=0.00 S=0 G=-1.00 FV=1 DR=10.0 T=3');
    if (p.kind !== 'telemetry') throw new Error('應該是遙測');
    expect(p.telemetry.state).toBe('lost');
    expect(p.telemetry.speedMps).toBeNull();
    expect(p.telemetry.angleDeg).toBeNull();
    expect(p.telemetry.rangeM).toBeNull();
    expect(p.telemetry.radialMps).toBeNull();
    expect(p.telemetry.snr).toBeNull();
    expect(p.telemetry.groundMps).toBeNull();
    expect(p.telemetry.verdict).toBe('noTarget');
    expect(p.telemetry.wheelMps).toBeNull();
    expect(p.telemetry.wheelDistanceM).toBeNull();
  });

  it('狀態與判斷碼', () => {
    const states = ['noRadar', 'stopped', 'acquiring', 'tracking', 'holding', 'lost'];
    states.forEach((s, i) => {
      const p = parseLine(`R=1 ST=${i} V=0`);
      expect(p.kind === 'telemetry' && p.telemetry.state).toBe(s);
    });
    const verdicts: Record<number, string> = { 0: 'accepted', 1: 'noTarget', 3: 'outOfGate', 4: 'wrongDirection', 5: 'static', 7: 'outlier', 8: 'acquiring' };
    for (const [code, verdict] of Object.entries(verdicts)) {
      const p = parseLine(`R=1 ST=3 V=1 FV=${code}`);
      expect(p.kind === 'telemetry' && p.telemetry.verdict).toBe(verdict);
    }
    // 3.x（C4001）才有的 ST 6、FV 2／6／9，以及看不懂的編號：當作「沒有」
    for (const line of ['R=1 ST=6 V=0 FV=2', 'R=1 ST=99 V=0 FV=6', 'R=1 ST=-1 V=0 FV=9']) {
      const p = parseLine(line);
      expect(p.kind === 'telemetry' && p.telemetry.state).toBe('noRadar');
      expect(p.kind === 'telemetry' && p.telemetry.verdict).toBe('noTarget');
    }
  });

  it('測速雷達只接收（RO=1）；雷達離線時不算', () => {
    const p = parseLine('R=1 RO=1 ST=1 V=0 N=0');
    expect(p.kind === 'telemetry' && p.telemetry.receiveOnly).toBe(true);
    const q = parseLine('R=0 RO=1 ST=0 V=-1 N=0');
    expect(q.kind === 'telemetry' && q.telemetry.receiveOnly).toBe(false);
    const old = parseLine('R=1 ST=1 V=0 N=0'); // 3.x 沒有 RO
    expect(old.kind === 'telemetry' && old.telemetry.receiveOnly).toBe(false);
  });

  it('代表目標：方向相反時徑向速度為負', () => {
    const p = parseLine('R=1 RO=0 ST=1 V=0 N=1 A=4 RD=5 RV=-5.00 S=33 G=5.77 FV=4');
    if (p.kind !== 'telemetry') throw new Error('應該是遙測');
    expect(p.telemetry.angleDeg).toBe(4);
    expect(p.telemetry.rangeM).toBe(5);
    expect(p.telemetry.radialMps).toBe(-5);
    expect(p.telemetry.snr).toBe(33);
    expect(p.telemetry.verdict).toBe('wrongDirection');
  });

  it('壞資料：重複的鍵（兩行黏在一起）、缺必要欄位', () => {
    expect(parseLine('R=1 ST=3 V=5 R=1 ST=3').kind).toBe('unknown');
    expect(parseLine('R=1 V=5').kind).toBe('unknown');
    expect(parseLine('hello').kind).toBe('unknown');
    expect(parseLine('').kind).toBe('unknown');
  });

  it('數值夾在合理範圍', () => {
    const p = parseLine('R=1 ST=3 V=5 Q=180 WD=-3 N=1 RD=2 S=-5 W=-1 DW=4');
    if (p.kind !== 'telemetry') throw new Error('應該是遙測');
    expect(p.telemetry.qualityPct).toBe(100);
    expect(p.telemetry.wrongDirPct).toBe(0);
    expect(p.telemetry.snr).toBeNull();
    expect(p.telemetry.wheelMps).toBe(0);
  });
});

describe('parseLine：設定與回覆', () => {
  it('CFG（4.0）', () => {
    const p = parseLine(
      'CFG ANGLE=30.0 HEIGHT=0.70 DIR=1 MODEL=1 CAL=1.0425 GSNR=5 WHEEL=2105 RMIN=0.71 RMAX=8.13 RANGE=15 RSPD=5 TTC=2.5 RSNR=4 RDET=25 FW=4.0.0',
    );
    expect(p).toEqual({
      kind: 'config',
      config: {
        angleDeg: 30,
        heightM: 0.7,
        direction: 1,
        model: 'rangeGeometry',
        calibration: 1.0425,
        radarSnr: 5,
        wheelMm: 2105,
        gateMinM: 0.71,
        gateMaxM: 8.13,
        rear: { rangeM: 15, minSpeedKmh: 5, ttcS: 2.5, snr: 4, detectRangeM: 25 },
        firmware: '4.0.0',
      },
    });
  });

  it('CFG（3.x：C4001 的 RTHR、VMAX 略過，沒有 GSNR 時用預設值；3.0 沒有後方來車參數）', () => {
    const p = parseLine(
      'CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=0 CAL=1.0000 RTHR=5 WHEEL=2105 VMAX=3.28 RMIN=0.62 RMAX=2.15 RANGE=15 RSPD=5 TTC=2.5 RSNR=4 RDET=25 FW=3.1.0',
    );
    expect(p.kind).toBe('config');
    if (p.kind !== 'config') return;
    expect(p.config.radarSnr).toBe(DEFAULT_CONFIG.radarSnr);
    expect(p.config).not.toHaveProperty('radarThreshold');
    expect(p.config.rear).toEqual({ rangeM: 15, minSpeedKmh: 5, ttcS: 2.5, snr: 4, detectRangeM: 25 });
    expect(p.config.firmware).toBe('3.1.0');
    const v30 = parseLine('CFG ANGLE=45.0 HEIGHT=0.70 DIR=1 MODEL=1 CAL=1.0425 RTHR=5 WHEEL=2105 VMAX=3.2 RMIN=0.62 RMAX=2.15 FW=3.0.0');
    expect(v30.kind === 'config' && v30.config.rear).toBeNull();
    // 缺 RDET 時由 RANGE 算
    const q = parseLine('CFG ANGLE=45 HEIGHT=0.7 DIR=1 CAL=1 RANGE=40 FW=3.1.1');
    expect(q.kind === 'config' && q.config.rear?.detectRangeM).toBe(50);
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

describe('parseLine：後方來車（REAR）', () => {
  it('有主要來車、兩個目標', () => {
    const p = parseLine('REAR ON=1 RO=1 LV=1 D=12.4 V=4.17 TTC=3.0 HOLD=0 N=2 CNT=3 FN=812 X=-3/12/15,6/31/-40');
    expect(p).toEqual({
      kind: 'rear',
      rear: {
        online: true,
        receiveOnly: true,
        level: 'caution',
        distanceM: 12.4,
        closingMps: 4.17,
        ttcS: 3,
        holding: false,
        targets: [
          { angleDeg: -3, distanceM: 12, speedKmh: 15 },
          { angleDeg: 6, distanceM: 31, speedKmh: -40 },
        ],
        alerts: 3,
        frame: 812,
      },
    });
  });

  it('沒有主要來車、保持中；離線', () => {
    const p = parseLine('REAR ON=1 RO=0 LV=2 D=-1.0 V=0.00 TTC=-1.0 HOLD=1 N=0 CNT=4 FN=900');
    expect(p.kind === 'rear' && p.rear).toMatchObject({ level: 'danger', holding: true, distanceM: null, closingMps: null, ttcS: null, targets: [] });
    const off = parseLine('REAR ON=0');
    expect(off.kind === 'rear' && off.rear).toMatchObject({ online: false, level: 'safe', distanceM: null, targets: [] });
  });

  it('格式不對的目標略過；缺 ON 不算', () => {
    const p = parseLine('REAR ON=1 LV=0 D=-1 X=1/2/3,abc,4/-5/6,7/8/9');
    expect(p.kind === 'rear' && p.rear.targets).toEqual([
      { angleDeg: 1, distanceM: 2, speedKmh: 3 },
      { angleDeg: 7, distanceM: 8, speedKmh: 9 },
    ]);
    expect(parseLine('REAR LV=2').kind).toBe('unknown');
    expect(parseLine('REAR ON=1 ON=1').kind).toBe('unknown'); // 兩行黏在一起
  });

  it('偵測距離 = RANGE + 10（10～100）', () => {
    expect(rearDetectRange(15)).toBe(25);
    expect(rearDetectRange(50)).toBe(60);
    expect(rearDetectRange(95)).toBe(100);
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
    expect(buildCommand({ type: 'radarSnr', value: 6 })).toBe('GSNR 6');
    expect(buildCommand({ type: 'wheel', mm: 2096 })).toBe('WHEEL 2096');
    expect(buildCommand({ type: 'angle', deg: 10 })).toBe('ANGLE 10');
    expect(buildCommand({ type: 'rearRange', m: 20 })).toBe('RANGE 20');
    expect(buildCommand({ type: 'rearMinSpeed', kmh: 8 })).toBe('RSPD 8');
    expect(buildCommand({ type: 'rearTtc', s: 2.54 })).toBe('TTC 2.5');
    expect(buildCommand({ type: 'rearSnr', value: 6 })).toBe('RSNR 6');
    expect(buildCommand({ type: 'defaults' })).toBe('DEFAULTS');
    expect(buildCommand({ type: 'reboot' })).toBe('REBOOT');
  });

  it('超出範圍或不是整數：丟出中文錯誤', () => {
    expect(() => buildCommand({ type: 'angle', deg: 80 })).toThrow(/安裝角度/);
    expect(() => buildCommand({ type: 'height', m: 0.1 })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'calibration', factor: 2.5 })).toThrow(/校正係數/);
    expect(() => buildCommand({ type: 'angle', deg: 9.5 })).toThrow(/安裝角度/);
    expect(() => buildCommand({ type: 'radarSnr', value: 5.5 })).toThrow(/整數/);
    expect(() => buildCommand({ type: 'radarSnr', value: 9 })).toThrow(/訊噪比/);
    expect(() => buildCommand({ type: 'wheel', mm: Number.NaN })).toThrow(RangeError);
    expect(() => buildCommand({ type: 'rearRange', m: 4 })).toThrow(/警示距離/);
    expect(() => buildCommand({ type: 'rearRange', m: 15.5 })).toThrow(/整數/);
    expect(() => buildCommand({ type: 'rearTtc', s: 7 })).toThrow(/到達時間/);
    expect(() => buildCommand({ type: 'rearSnr', value: 9 })).toThrow(RangeError);
  });
});

describe('diffRearConfig', () => {
  it('只送有變的後方參數', () => {
    expect(diffRearConfig(DEFAULT_REAR_CONFIG, { ...DEFAULT_REAR_CONFIG })).toEqual([]);
    expect(diffRearConfig(DEFAULT_REAR_CONFIG, { ...DEFAULT_REAR_CONFIG, ttcS: 2.52 })).toEqual([]);
    expect(diffRearConfig(DEFAULT_REAR_CONFIG, { ...DEFAULT_REAR_CONFIG, rangeM: 20, snr: 5 })).toEqual([
      { type: 'rearRange', m: 20 },
      { type: 'rearSnr', value: 5 },
    ]);
  });
});

describe('diffConfig', () => {
  it('只送有變的參數（以送出的精度比較）', () => {
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG })).toEqual([]);
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, heightM: 0.70004 })).toEqual([]);
    expect(diffConfig(DEFAULT_CONFIG, { ...DEFAULT_CONFIG, angleDeg: 40, direction: -1, calibration: 1.1, radarSnr: 6 })).toEqual([
      { type: 'angle', deg: 40 },
      { type: 'direction', dir: -1 },
      { type: 'calibration', factor: 1.1 },
      { type: 'radarSnr', value: 6 },
    ]);
  });
});

describe('groundWindow（與韌體相同）', () => {
  const rad = (d: number) => (d * Math.PI) / 180;

  it('預設 30°、0.70 m：0.71～8.13 m → 整數距離 0～9 m', () => {
    const w = groundWindow(30, 0.7);
    expect(w.minM).toBeCloseTo(0.7 / Math.sin(rad(60)) - 0.1, 3);
    expect(w.maxM).toBeCloseTo(0.7 / Math.sin(rad(5)) + 0.1, 3);
    expect(w.minDistanceM).toBe(0);
    expect(w.maxDistanceM).toBe(9);
    expect(w.boresightM).toBeCloseTo(1.4, 2);
  });

  it('45°、0.70 m：0～3 m', () => {
    const w = groundWindow(45, 0.7);
    expect(w.minM).toBeCloseTo(0.7 / Math.sin(rad(75)) - 0.1, 3);
    expect(w.maxM).toBeCloseTo(0.7 / Math.sin(rad(20)) + 0.1, 3);
    expect([w.minDistanceM, w.maxDistanceM]).toEqual([0, 3]);
  });

  it('很高、很淺：遠端是雷達的偵測距離 10 m', () => {
    const w = groundWindow(10, 1.5);
    expect(w.maxM).toBe(10);
    expect([w.minDistanceM, w.maxDistanceM]).toEqual([2, 10]);
  });
});
