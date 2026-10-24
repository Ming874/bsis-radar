/**
 * 【設計系統】版面：卡片、區塊標題、群組列表（設定頁那種一列一列的清單）。
 */
import { useId, type ComponentType, type ReactNode } from 'react';
import { FOCUS_RING_INSET, cx, haptic } from './base';
import { ChevronRightIcon, type IconProps } from './icons';

export function Card({ children, className = '', alert = false, id }: { children: ReactNode; className?: string; alert?: boolean; id?: string }) {
  return (
    <div id={id} className={cx('card min-w-0', alert && 'ring-2 ring-bad', className)}>
      {children}
    </div>
  );
}

/** 區塊：標題（右邊可放動作）＋內容。手機上標題對齊卡片內文 */
export function Section({
  title,
  description,
  action,
  children,
  className = '',
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cx('min-w-0 scroll-mt-20', className)}>
      <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-title font-bold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-footnote text-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** 群組列表：小標＋一張卡片，裡面的列之間有分隔線；footer 是卡片下方的說明 */
export function ListGroup({ title, footer, children, className = '', id }: { title?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('min-w-0 scroll-mt-20', className)}>
      {title && <h2 className="eyebrow mb-1.5 px-4">{title}</h2>}
      <div className="card overflow-hidden [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
      {footer && <div className="mt-2 px-4 text-footnote text-muted">{footer}</div>}
    </section>
  );
}

/**
 * 一列：左邊名稱與說明，右邊數值或控制項（children）。
 * stack：控制項放在名稱下面（手機上放不下時，例如輪胎尺寸選單＋數值）。
 */
export function Row({
  label,
  detail,
  value,
  icon: Icon,
  chevron = false,
  onClick,
  destructive = false,
  stack = false,
  disabled = false,
  htmlFor,
  children,
}: {
  label: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  icon?: ComponentType<IconProps>;
  chevron?: boolean;
  onClick?: () => void;
  destructive?: boolean;
  stack?: boolean;
  /** 現在不能用（例如還沒連線）：變淡、不能按 */
  disabled?: boolean;
  htmlFor?: string;
  children?: ReactNode;
}) {
  const LabelTag = htmlFor ? 'label' : 'span';
  const head = (
    <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
      {Icon && <Icon className={cx('h-5 w-5 shrink-0', destructive ? 'text-bad' : 'text-muted')} />}
      <span className="min-w-0 flex-1">
        <LabelTag htmlFor={htmlFor} className={cx('block text-body', destructive ? 'text-bad' : 'text-ink')}>
          {label}
        </LabelTag>
        {detail && <span className="mt-0.5 block text-footnote text-muted">{detail}</span>}
      </span>
    </span>
  );
  const tail = (
    <>
      {value !== undefined && <span className="num shrink-0 text-right text-subhead text-muted">{value}</span>}
      {!stack && children && <span className="flex shrink-0 items-center gap-2">{children}</span>}
      {chevron && <ChevronRightIcon className="h-[18px] w-[18px] shrink-0 text-faint" />}
    </>
  );
  const base = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5';

  if (onClick) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          haptic();
          onClick();
        }}
        className={cx(base, 'transition-colors hover:bg-surface-2/60 active:bg-surface-2 disabled:pointer-events-none disabled:opacity-40', FOCUS_RING_INSET)}
      >
        {head}
        {tail}
      </button>
    );
  }
  if (stack) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          {head}
          {tail}
        </div>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
    );
  }
  return (
    <div className={base}>
      {head}
      {tail}
    </div>
  );
}
