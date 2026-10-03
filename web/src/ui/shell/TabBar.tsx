/**
 * 【外框】手機版底部分頁列（iOS 風格：毛玻璃底、選中的分頁變成品牌橘）。電腦版改用左側導覽列。
 */
import type { ComponentType } from 'react';
import { FOCUS_RING } from '../kit';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

export function TabBar<T extends string>({ tabs, active, onSelect }: { tabs: Array<TabItem<T>>; active: T; onSelect: (id: T) => void }) {
  return (
    <nav
      aria-label="主要分頁"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/80 bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl px-2 pt-1.5 pb-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onSelect(id)}
                className={`flex w-full flex-col items-center gap-0.5 rounded-control py-1 transition-colors ${FOCUS_RING} ${
                  on ? 'text-accent-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="text-caption font-semibold">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
