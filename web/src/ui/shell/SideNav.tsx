/**
 * 【外框】電腦版左側導覽列（螢幕寬 1024px 以上才顯示；手機用底部分頁列）。
 */
import { FOCUS_RING } from '../kit';
import type { TabItem } from './TabBar';

export function SideNav<T extends string>({ tabs, active, onSelect }: { tabs: Array<TabItem<T>>; active: T; onSelect: (id: T) => void }) {
  return (
    <nav aria-label="主要分頁" className="fixed top-14 bottom-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
      <ul className="flex-1 space-y-0.5 p-3">
        {tabs.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onSelect(id)}
                className={`relative flex h-10 w-full items-center gap-3 rounded-control px-3 text-body transition ${FOCUS_RING} ${
                  on ? 'bg-accent/10 font-semibold text-accent-ink' : 'font-medium text-ink-2 hover:bg-fill hover:text-ink'
                }`}
              >
                {on && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />}
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-5 py-3 text-caption text-ink-3">網頁版本 {__APP_VERSION__}</p>
    </nav>
  );
}
