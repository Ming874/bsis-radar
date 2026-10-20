/**
 * 【設計系統】按鈕。
 * primary 主要動作（每個區塊最多一個）、secondary 一般動作、ghost 次要動作、danger 會刪除或重開的動作。
 */
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { IconProps } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** 鍵盤操作時的焦點框（滑鼠、觸控點擊時不顯示） */
export const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-white hover:brightness-110 active:brightness-95',
  secondary: 'border border-line-strong bg-panel text-fg hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'border border-line-strong bg-panel text-bad hover:border-bad/60 hover:bg-bad/10',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-label',
  md: 'h-9 gap-2 px-3.5 text-body',
  lg: 'h-11 gap-2 px-5 text-value',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<IconProps>;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, block, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${FOCUS_RING} ${className}`}
      {...rest}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />}
      {children}
    </button>
  );
}

/** 只有圖示的按鈕（一定要給 label，螢幕閱讀器才知道用途） */
export function IconButton({ icon: Icon, label, className = '', ...rest }: Omit<ButtonProps, 'children' | 'icon'> & { icon: ComponentType<IconProps>; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 ${FOCUS_RING} ${className}`}
      {...rest}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
