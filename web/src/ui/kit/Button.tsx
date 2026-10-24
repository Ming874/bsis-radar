/**
 * 【設計系統】按鈕：膠囊形，手機上至少 44 px 高（Apple、Material 建議的觸控大小）。
 * primary 主要動作（每個區塊最多一個）、tinted 次要但想讓人看見的動作、secondary 一般動作、
 * plain 文字按鈕、danger 會刪除或重開的動作。
 */
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { FOCUS_RING, cx, haptic } from './base';
import type { IconProps } from './icons';

export type ButtonVariant = 'primary' | 'tinted' | 'secondary' | 'plain' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-tint-solid text-white hover:brightness-110',
  tinted: 'bg-tint-soft text-tint hover:bg-[color-mix(in_srgb,var(--tint)_20%,transparent)]',
  secondary: 'bg-surface-2 text-ink hover:bg-surface-3',
  plain: 'text-tint hover:bg-tint-soft',
  danger: 'bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad hover:bg-[color-mix(in_srgb,var(--bad)_18%,transparent)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-footnote',
  md: 'h-11 gap-2 px-5 text-subhead',
  lg: 'h-[52px] gap-2 px-5 text-headline',
};

const ICON: Record<ButtonSize, string> = { sm: 'h-4 w-4 shrink-0', md: 'h-[18px] w-[18px] shrink-0', lg: 'h-5 w-5 shrink-0' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<IconProps>;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, block, className = '', children, type = 'button', onClick, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      onClick={(e) => {
        haptic();
        onClick?.(e);
      }}
      className={cx(
        'press inline-flex shrink-0 items-center justify-center rounded-full font-semibold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        block && 'w-full',
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={ICON[size]} strokeWidth={2.1} />}
      {children}
    </button>
  );
}

/** 只有圖示的圓形按鈕（一定要給 label，螢幕閱讀器才知道用途） */
export function IconButton({
  icon: Icon,
  label,
  variant = 'plain',
  size = 'md',
  className = '',
  onClick,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ComponentType<IconProps>;
  label: string;
  variant?: 'plain' | 'soft' | 'surface';
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        haptic();
        onClick?.(e);
      }}
      className={cx(
        'press inline-flex shrink-0 items-center justify-center rounded-full disabled:opacity-40',
        variant === 'soft' ? 'bg-surface-2 text-ink hover:bg-surface-3' : variant === 'surface' ? 'card text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
        box,
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[19px] w-[19px]'} strokeWidth={2} />
    </button>
  );
}
