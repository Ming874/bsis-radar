/**
 * 【設計系統】輸入控制：開關、分段選擇、滑桿、數值步進器。
 */
import type { CSSProperties } from 'react';
import { FOCUS_RING } from './Button';
import { MinusIcon, PlusIcon } from './icons';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${FOCUS_RING} ${
        checked ? 'bg-accent' : 'bg-ink-3/45'
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex rounded-control bg-fill p-1 ${disabled ? 'opacity-40' : ''}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`h-9 flex-1 rounded-[6px] px-2 text-callout font-semibold transition ${FOCUS_RING} ${
              active ? 'bg-raised text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}) {
  const safe = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const fill = max > min ? ((safe - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={safe}
      disabled={disabled}
      onChange={(e) => onChange(e.target.valueAsNumber)}
      // 已選範圍的長度交給 index.css 的 .range 畫成品牌橘
      style={{ '--fill': `${fill}%` } as CSSProperties}
      className="range"
    />
  );
}

/** − 數值 + ：可直接輸入，按鈕依 step 增減並限制在範圍內 */
export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  unit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
}) {
  const valid = value >= min && value <= max;
  const bump = (dir: 1 | -1) => {
    const base = Number.isFinite(value) ? value : min;
    onChange(Math.min(max, Math.max(min, Number((base + dir * step).toFixed(decimals)))));
  };
  const round =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink shadow-sm transition hover:bg-fill disabled:opacity-30 ' +
    FOCUS_RING;
  return (
    <div className="flex items-center gap-3">
      <button type="button" aria-label={`減少${label}`} className={round} disabled={value <= min} onClick={() => bump(-1)}>
        <MinusIcon />
      </button>
      <label
        className={`flex h-14 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-control border-2 px-3 ${
          valid ? 'border-transparent bg-fill' : 'border-danger bg-danger/5'
        }`}
      >
        <input
          type="number"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={!valid}
          value={Number.isNaN(value) ? '' : value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          style={{ width: `${Math.max(2, (Number.isNaN(value) ? '' : String(value)).length) + 0.6}ch` }}
          className="tabular max-w-full min-w-0 bg-transparent text-center text-headline font-bold text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && <span className="shrink-0 text-body font-semibold text-ink-2">{unit}</span>}
      </label>
      <button type="button" aria-label={`增加${label}`} className={round} disabled={value >= max} onClick={() => bump(1)}>
        <PlusIcon />
      </button>
    </div>
  );
}
