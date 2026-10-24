/**
 * 【UI 層】電腦版（≥ 1024 px）左欄：產品名稱、分頁（選中的底色滑過去）、連線狀態、版本。
 */
import { useShallow } from 'zustand/react/shallow';
import { actions, capabilities, isDemo, openSheet, useRadar } from '../../application/container';
import { selectLink } from '../../application/selectors';
import { BluetoothIcon, Button, FOCUS_RING, LogoMark, StatusDot, cx } from '../kit';
import { TABS, goTab, type Tab } from './tabs';

const ROW_H = 44;
const ROW_GAP = 4;

function ConnectionCard() {
  const link = useRadar(useShallow((r) => selectLink({ connection: r.connection, stale: r.stale, telemetry: r.telemetry, legacyFirmware: r.legacyFirmware })));
  const device = useRadar((r) => r.connection.deviceName);
  const status = useRadar((r) => r.connection.status);
  const idle = status === 'idle' || status === 'disconnected';
  return (
    <div className="card p-3">
      <button
        type="button"
        onClick={() => openSheet('connection')}
        className={cx('flex w-full items-center gap-2.5 rounded-xl px-1 py-1 text-left hover:bg-surface-2', FOCUS_RING)}
      >
        <StatusDot tone={link.tone} />
        <span className="min-w-0 flex-1">
          <span className="block text-subhead font-semibold text-ink">{link.label}</span>
          <span className="block truncate text-caption text-muted">{device ?? (isDemo ? '示範模式' : 'BSIS-Speed')}</span>
        </span>
      </button>
      {idle && (
        <Button variant="primary" size="sm" block icon={BluetoothIcon} className="mt-2" disabled={!capabilities.bluetooth} onClick={() => void actions.connect()}>
          連線
        </Button>
      )}
    </div>
  );
}

export function Sidebar({ active }: { active: Tab }) {
  const index = TABS.findIndex((t) => t.id === active);
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r border-line px-4 py-6 lg:flex">
      <div className="mb-6 flex items-center gap-2.5 px-2.5">
        <LogoMark className="h-8 w-8 text-tint-solid" />
        <span className="min-w-0">
          <span className="block text-headline font-bold tracking-tight text-ink">BSIS 測速</span>
          <span className="block text-caption text-muted">毫米波雷達對地測速</span>
        </span>
      </div>
      <nav aria-label="主要分頁" className="relative flex flex-col" style={{ gap: ROW_GAP }}>
        <span
          aria-hidden
          className="tab-lens card pointer-events-none absolute inset-x-0 top-0"
          style={{ height: ROW_H, transform: `translateY(${Math.max(index, 0) * (ROW_H + ROW_GAP)}px)` }}
        />
        {TABS.map(({ id, label, Icon }) => {
          const current = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-current={current ? 'page' : undefined}
              onClick={() => goTab(id)}
              style={{ height: ROW_H }}
              className={cx(
                'relative flex items-center gap-3 rounded-xl px-3 text-subhead transition-colors',
                current ? 'font-semibold text-ink' : 'font-medium text-muted hover:bg-surface/60 hover:text-ink',
                FOCUS_RING,
              )}
            >
              <Icon className={cx('h-5 w-5', current ? 'text-tint' : 'text-faint')} strokeWidth={current ? 2.1 : 1.9} />
              {label}
            </button>
          );
        })}
      </nav>
      <div className="flex-1" />
      <ConnectionCard />
      <div className="mt-3 px-2.5 text-caption text-faint">
        網頁 v{__APP_VERSION__} ·{' '}
        <a className="hover:text-ink" href="https://github.com/Ming874/bsis-radar" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
    </aside>
  );
}
