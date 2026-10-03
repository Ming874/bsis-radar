/**
 * 【裝置】ESP32 偵測參數的統一定義：名稱、單位、範圍、步進、顯示方式、對應指令、說明。
 * 列表與編輯面板都由這份定義產生，新增參數只要改這裡。
 */
import { COMMAND_LIMITS, DEFAULT_DEVICE_CONFIG } from '../../../domain/protocol';
import type { DeviceCommand } from '../../../domain/types';
import { mpsToKmh } from '../../../domain/units';
import { PARAM_HELP, type HelpText } from '../../content/help';

export type NumericKey = 'minSpeedMps' | 'minEnergy' | 'warnRangeM' | 'dangerTtcS' | 'dangerDistM' | 'holdMs' | 'confirmHits';
export type ParamKey = NumericKey | 'approachSign';

export interface NumericParam {
  key: NumericKey;
  label: string;
  help: HelpText;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  slider: boolean;
  /** 列表右側顯示的值 */
  format: (v: number) => string;
  /** 編輯面板中、數值下方的換算說明 */
  hint?: (v: number) => string;
  toCommand: (v: number) => DeviceCommand;
  defaultValue: number;
}

const L = COMMAND_LIMITS;
const D = DEFAULT_DEVICE_CONFIG;
const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));

export const NUMERIC_PARAMS: Record<NumericKey, NumericParam> = {
  minSpeedMps: {
    key: 'minSpeedMps',
    label: '接近速度門檻',
    help: PARAM_HELP.minSpeedMps,
    unit: 'm/s',
    ...L.minSpeedMps,
    step: 0.1,
    decimals: 2,
    slider: true,
    format: (v) => `${trim(v, 2)} m/s`,
    hint: (v) => `約 ${mpsToKmh(v).toFixed(1)} km/h（走路約 4.3 km/h）`,
    toCommand: (v) => ({ type: 'minSpeed', mps: v }),
    defaultValue: D.minSpeedMps,
  },
  minEnergy: {
    key: 'minEnergy',
    label: '反射能量門檻',
    help: PARAM_HELP.minEnergy,
    unit: '',
    ...L.minEnergy,
    step: 1000,
    decimals: 0,
    slider: false,
    format: (v) => (v === 0 ? '不過濾' : v.toLocaleString()),
    hint: (v) => (v === 0 ? '目前不過濾能量' : `能量低於 ${v.toLocaleString()} 的目標不算來車`),
    toCommand: (v) => ({ type: 'minEnergy', value: v }),
    defaultValue: D.minEnergy,
  },
  warnRangeM: {
    key: 'warnRangeM',
    label: '警示距離',
    help: PARAM_HELP.warnRangeM,
    unit: 'm',
    ...L.warnRangeM,
    step: 0.5,
    decimals: 1,
    slider: true,
    format: (v) => `${trim(v, 1)} m`,
    toCommand: (v) => ({ type: 'warnRange', meters: v }),
    defaultValue: D.warnRangeM,
  },
  dangerTtcS: {
    key: 'dangerTtcS',
    label: '危險到達時間',
    help: PARAM_HELP.dangerTtcS,
    unit: '秒',
    ...L.dangerTtcS,
    step: 0.1,
    decimals: 1,
    slider: true,
    format: (v) => `${trim(v, 1)} 秒`,
    toCommand: (v) => ({ type: 'dangerTtc', seconds: v }),
    defaultValue: D.dangerTtcS,
  },
  dangerDistM: {
    key: 'dangerDistM',
    label: '危險距離',
    help: PARAM_HELP.dangerDistM,
    unit: 'm',
    ...L.dangerDistM,
    step: 0.5,
    decimals: 1,
    slider: true,
    format: (v) => `${trim(v, 1)} m`,
    toCommand: (v) => ({ type: 'dangerDist', meters: v }),
    defaultValue: D.dangerDistM,
  },
  confirmHits: {
    key: 'confirmHits',
    label: '確認筆數',
    help: PARAM_HELP.confirmHits,
    unit: '筆',
    ...L.confirmHits,
    step: 1,
    decimals: 0,
    slider: true,
    format: (v) => `${v} 筆`,
    hint: (v) => `約 ${(v * 0.1).toFixed(1)} 秒（雷達每秒約 10 筆）`,
    toCommand: (v) => ({ type: 'confirm', hits: v }),
    defaultValue: D.confirmHits,
  },
  holdMs: {
    key: 'holdMs',
    label: '警示保持時間',
    help: PARAM_HELP.holdMs,
    unit: 'ms',
    ...L.holdMs,
    step: 100,
    decimals: 0,
    slider: true,
    format: (v) => `${trim(v / 1000, 1)} 秒`,
    hint: (v) => `${trim(v / 1000, 1)} 秒`,
    toCommand: (v) => ({ type: 'hold', ms: v }),
    defaultValue: D.holdMs,
  },
};

export const SIGN_OPTIONS: Array<{ value: -1 | 0 | 1; label: string; description: string }> = [
  { value: -1, label: '負 = 接近', description: '依實測，C4001 接近時速度為負（建議）' },
  { value: 1, label: '正 = 接近', description: '人走近不警示、後退才警示時改用這個' },
  { value: 0, label: '不判斷方向', description: '只看速度大小，遠離的車也會觸發（不建議）' },
];

export const signLabel = (s: -1 | 0 | 1) => SIGN_OPTIONS.find((o) => o.value === s)?.label ?? String(s);

export const PARAM_GROUPS: Array<{ title: string; footer: string; keys: ParamKey[] }> = [
  { title: '偵測條件', footer: '什麼樣的目標算是「來車」。', keys: ['minSpeedMps', 'minEnergy', 'approachSign'] },
  { title: '警示等級', footer: '什麼時候開始提醒、什麼時候算危險。', keys: ['warnRangeM', 'dangerTtcS', 'dangerDistM'] },
  { title: '穩定性', footer: '過濾雜訊與警示保持。', keys: ['confirmHits', 'holdMs'] },
];
