/**
 * 【設計系統】按鈕：主要（品牌橘）/ 次要（白底框線）/ 文字 / 危險（紅）四種，三種尺寸。整個網頁只用這一個按鈕。
 */
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'lg' | 'md' | 'sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm hover:brightness-95 active:brightness-90',
  secondary: 'border border-line bg-surface text-ink shadow-sm hover:bg-fill active:bg-fill',
  plain: 'text-accent-ink hover:bg-accent/10 active:bg-accent/15',
  destructive: 'bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90',
};

const SIZE: Record<ButtonSize, string> = {
  lg: 'h-13 px-6 text-title',
  md: 'h-11 px-4 text-body',
  sm: 'h-9 px-3 text-callout',
};

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap transition select-none disabled:pointer-events-none disabled:opacity-40 ${FOCUS_RING} ${
        SIZE[size]
      } ${VARIANT[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...props}
    />
  );
}
