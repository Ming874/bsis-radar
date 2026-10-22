/**
 * 【UI 層】頂端列：產品名稱、超速標記（在其他分頁也看得到）、連線狀態（點了看連線詳情與中斷 / 重新連線）。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, capabilities, isDemo, useOverspeed, useRadar } from '../../application/container';
import { selectLink } from '../../application/selectors';
import { formatDuration } from '../../domain/units';
import { Button, Dialog, FOCUS_RING, KeyValue, LogoMark, StatusDot } from '../kit';

function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const s = useRadar(
    useShallow((r) => ({
      connection: r.connection,
      stale: r.stale,
      telemetry: r.telemetry,
      legacyFirmware: r.legacyFirmware,
      firmware: r.config?.firmware ?? r.legacyFirmware,
      frameRateHz: r.frameRateHz,
    })),
  );
  const link = selectLink(s);
  const connected = s.connection.status === 'connected';
  const busy = s.connection.status === 'connecting' || s.connection.status === 'reconnecting';
  return (
    <Dialog
      title="連線"
      onClose={onClose}
      footer={
        connected || busy ? (
          <Button
            variant="danger"
            onClick={() => {
              void actions.disconnect();
              onClose();
            }}
          >
            中斷連線
          </Button>
        ) : (
          <>
            {capabilities.knownDevices && (
              <Button
                onClick={() => {
                  void actions.reconnectKnownDevice();
                  onClose();
                }}
              >
                連回上次的裝置
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!capabilities.bluetooth}
              onClick={() => {
                void actions.connect();
                onClose();
              }}
            >
              連線
            </Button>
          </>
        )
      }
    >
      <div className="-mx-4 -my-4">
        <KeyValue
          rows={[
            {
              label: '狀態',
              value: (
                <span className="inline-flex items-center gap-2 font-sans">
                  <StatusDot tone={link.tone} />
                  {link.label}
                </span>
              ),
            },
            { label: '裝置', value: s.connection.deviceName ?? '—' },
            { label: '韌體', value: s.firmware ? `v${s.firmware}` : '—' },
            { label: 'ESP32 運作時間', value: s.telemetry ? formatDuration(s.telemetry.uptimeS) : '—' },
            { label: '雷達資料框', value: s.frameRateHz === null ? '—' : s.frameRateHz.toFixed(1), unit: s.frameRateHz === null ? undefined : 'Hz' },
          ]}
        />
      </div>
      {link.detail && <p className="mt-3 text-label text-muted">{link.detail}</p>}
    </Dialog>
  );
}

export function TopBar() {
  const [open, setOpen] = useState(false);
  const link = useRadar(
    useShallow((r) => selectLink({ connection: r.connection, stale: r.stale, telemetry: r.telemetry, legacyFirmware: r.legacyFirmware })),
  );
  const deviceName = useRadar((r) => r.connection.deviceName);
  const over = useOverspeed((o) => o.active);
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-panel pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="h-7 w-7 text-accent-strong" />
          <span className="text-value font-semibold tracking-tight text-fg">BSIS 測速</span>
          <span className="hidden text-label text-subtle sm:inline">毫米波雷達對地測速</span>
          {isDemo && <span className="rounded-sm border border-warn/50 px-1.5 py-0.5 text-[11px] text-warn">示範資料</span>}
          {over && <span className="rounded-sm border border-bad px-1.5 py-0.5 text-[11px] font-medium text-bad">超速</span>}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex h-8 min-w-0 items-center gap-2 rounded-md border border-line-strong px-3 text-body text-fg hover:bg-hover ${FOCUS_RING}`}
        >
          <StatusDot tone={link.tone} />
          <span className="truncate">{link.label}</span>
          {link.tone === 'ok' && deviceName && <span className="hidden truncate text-muted sm:inline">· {deviceName}</span>}
        </button>
      </div>
      {open && <ConnectionDialog onClose={() => setOpen(false)} />}
    </header>
  );
}
