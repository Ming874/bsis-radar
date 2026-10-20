/**
 * 【設計系統】表單：欄位列、數值輸入、分段選擇、開關、下拉選單。
 */
import { useId, useState, type ReactNode } from 'react';
import { FOCUS_RING } from './Button';
import { MinusIcon, PlusIcon } from './icons';
import { inRange } from './tones';

/** 一列設定：左邊名稱與說明，右邊控制項（手機上上下排列） */
export function Field({
  label,
  description,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-[60%]">
        <label htmlFor={htmlFor} className="text-body font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-label text-muted">{description}</p>}
        {error && <p className="mt-1 text-label text-bad">{error}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 一組欄位（中間有分隔線） */
export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line">{children}</div>;
}

/**
 * 數值輸入：可直接打字（允許「0.」這種打到一半的字）、− / + 依 step 調整並限制在範圍內。
 * 超出範圍時外框變紅，由呼叫端決定能不能送出。
 */
export function NumberInput({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  unit,
  width = 'w-24',
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
  width?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  // 輸入中顯示使用者打的字（允許「0.」），沒在輸入時顯示格式化後的數值
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? value.toFixed(decimals) : '');

  const valid = inRange(value, min, max);
  const bump = (dir: 1 | -1) => {
    const base = Number.isFinite(value) ? value : min;
    const next = Math.min(max, Math.max(min, Number((base + dir * step).toFixed(decimals))));
    setDraft(null);
    onChange(next);
  };
  const stepBtn = `flex h-9 w-8 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-30 ${FOCUS_RING}`;

  return (
    <div className={`inline-flex h-9 items-stretch overflow-hidden rounded-md border bg-sunken ${valid ? 'border-line-strong' : 'border-bad'}`}>
      <button type="button" aria-label={`減少${label}`} className={stepBtn} disabled={value <= min} onClick={() => bump(-1)}>
        <MinusIcon className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-1 border-x border-line px-2">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={!valid}
          min={min}
          max={max}
          step={step}
          value={shown}
          onFocus={() => setDraft(shown)}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = e.target.valueAsNumber;
            onChange(Number.isFinite(n) ? n : Number.NaN);
          }}
          className={`no-spin tabular ${width} bg-transparent text-right font-mono text-value text-fg outline-none`}
        />
        {unit && <span className="text-label text-muted">{unit}</span>}
      </div>
      <button type="button" aria-label={`增加${label}`} className={stepBtn} disabled={value >= max} onClick={() => bump(1)}>
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  block = false,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  block?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-md border border-line-strong bg-sunken p-0.5 ${block ? 'w-full' : ''} ${disabled ? 'opacity-40' : ''}`}
    >
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
            className={`h-8 flex-1 rounded-[4px] px-3 text-body whitespace-nowrap transition-colors ${FOCUS_RING} ${
              active ? 'bg-panel font-medium text-fg shadow-[0_0_0_1px_var(--c-line-strong)]' : 'text-muted hover:text-fg'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${FOCUS_RING} ${checked ? 'bg-accent-strong' : 'bg-line-strong'}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

export function Select<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`h-9 max-w-full rounded-md border border-line-strong bg-sunken px-2.5 text-body text-fg ${FOCUS_RING}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
