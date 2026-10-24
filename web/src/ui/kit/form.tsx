/**
 * 【設計系統】表單：數值步進器、分段選擇、開關、下拉選單、文字輸入。
 * 輸入框的字至少 16 px：iPhone 小於 16 px 的輸入框一點就會放大整個頁面。
 */
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';
import { FOCUS_RING, cx, haptic } from './base';
import { ChevronDownIcon, MinusIcon, PlusIcon } from './icons';
import { inRange } from './tones';

const REPEAT_DELAY_MS = 420;
const REPEAT_EVERY_MS = 70;

/**
 * 數值步進器：可直接打字（允許「0.」這種打到一半的字）；− / + 依 step 調整並限制在範圍內，按住不放會連續調整。
 * 超出範圍時外框變紅，由呼叫端決定能不能送出。
 */
export function Stepper({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
  unit,
  width = 'w-16',
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

  // 按住連續調整：計時器裡要拿到最新的值
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});
  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.delay);
      clearInterval(t.repeat);
    };
  }, []);

  const bump = (dir: 1 | -1) => {
    const { value: v, onChange: change } = latest.current;
    const base = Number.isFinite(v) ? v : min;
    const next = Math.min(max, Math.max(min, Number((base + dir * step).toFixed(decimals))));
    if (next === v) return stop(); // 到頂了：按鈕變停用、收不到放開的事件，這裡就停
    setDraft(null);
    change(next);
  };
  function stop() {
    const t = timers.current;
    clearTimeout(t.delay);
    clearInterval(t.repeat);
    t.delay = undefined;
    t.repeat = undefined;
  }
  const start = (dir: 1 | -1) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // 不要搶走輸入框的焦點、不要選取文字
    haptic();
    bump(dir);
    stop();
    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => bump(dir), REPEAT_EVERY_MS);
    }, REPEAT_DELAY_MS);
  };
  const stepBtn = cx(
    'press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-surface disabled:opacity-30 touch-none select-none',
    FOCUS_RING,
  );

  return (
    <div className={cx('inline-flex h-11 shrink-0 items-center rounded-full bg-surface-2 p-1', !valid && 'ring-2 ring-bad')}>
      <button
        type="button"
        aria-label={`減少${label}`}
        className={stepBtn}
        disabled={value <= min}
        onPointerDown={start(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), bump(-1))}
      >
        <MinusIcon className="h-4 w-4" strokeWidth={2.4} />
      </button>
      <label htmlFor={inputId} className="flex items-baseline justify-center gap-1 px-1">
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
          onFocus={(e) => {
            setDraft(shown);
            e.target.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = e.target.valueAsNumber;
            onChange(Number.isFinite(n) ? n : Number.NaN);
          }}
          className={cx('no-spin num bg-transparent text-center text-body font-semibold text-ink outline-none', width)}
        />
        {unit && <span className="text-footnote text-muted">{unit}</span>}
      </label>
      <button
        type="button"
        aria-label={`增加${label}`}
        className={stepBtn}
        disabled={value >= max}
        onPointerDown={start(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), bump(1))}
      >
        <PlusIcon className="h-4 w-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** 分段選擇：選中的底色滑過去（百分比位移，不用量元素大小） */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
  block = false,
  size = 'md',
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  block?: boolean;
  size?: 'sm' | 'md';
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('relative inline-flex shrink-0 rounded-full bg-surface-2 p-[3px]', block && 'flex w-full', disabled && 'opacity-40')}
    >
      <span
        aria-hidden
        className="tab-lens pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] rounded-full bg-surface shadow-[0_1px_3px_rgba(20,24,40,0.14)] dark:bg-surface-3"
        style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${Math.max(index, 0) * 100}%)`, opacity: index < 0 ? 0 : 1 }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!active) haptic();
              onChange(o.value);
            }}
            className={cx(
              'relative min-w-0 flex-1 rounded-full px-3.5 font-semibold whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px]',
              size === 'sm' ? 'h-8 text-footnote' : 'h-9 text-footnote',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 開關（iOS 尺寸 51 × 31） */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic();
        onChange(!checked);
      }}
      className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-tint-solid' : 'bg-surface-3', FOCUS_RING)}
    >
      <span
        className={cx(
          'absolute top-[2px] left-0 h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 [transition-timing-function:var(--ease-spring)]',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}

export function Select<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  id?: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <span className={cx('relative inline-flex max-w-full', className)}>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cx('h-11 w-full max-w-full appearance-none rounded-full bg-surface-2 pr-9 pl-4 text-body text-ink', FOCUS_RING)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-muted" />
    </span>
  );
}

export function TextField({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'h-11 min-w-0 rounded-full bg-surface-2 px-4 text-body text-ink outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-tint disabled:opacity-50',
        className,
      )}
    />
  );
}
