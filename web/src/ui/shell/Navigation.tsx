/**
 * 【UI 層】導覽：電腦版（≥ 1024 px）左側選單，手機版底部分頁列。
 */
import { FOCUS_RING } from '../kit';
import { TABS, type Tab } from './tabs';

export function SideNav({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav aria-label="主要分頁" className="fixed top-14 bottom-0 left-0 z-20 hidden w-56 flex-col border-r border-line bg-panel lg:flex">
      <ul className="flex flex-col gap-0.5 p-3">
        {TABS.map(({ id, label, Icon }) => {
          const current = id === active;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onSelect(id)}
                className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-body transition-colors ${FOCUS_RING} ${
                  current ? 'bg-hover font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                <Icon className={`h-[18px] w-[18px] ${current ? 'text-accent' : ''}`} />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-line px-6 py-4 text-label text-subtle">
        網頁 v{__APP_VERSION__}
        <br />
        <a className="hover:text-fg" href="https://github.com/Ming874/bsis-radar" target="_blank" rel="noreferrer">
          github.com/Ming874/bsis-radar
        </a>
      </div>
    </nav>
  );
}

export function TabBar({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav
      aria-label="主要分頁"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {TABS.map(({ id, label, Icon }) => {
          const current = id === active;
          return (
            <li key={id}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onSelect(id)}
                className={`flex h-14 w-full flex-col items-center justify-center gap-1 text-[11px] transition-colors ${FOCUS_RING} ${
                  current ? 'text-accent' : 'text-muted'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
