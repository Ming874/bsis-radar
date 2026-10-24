/**
 * 【UI 層】連線：頁首右上角的狀態膠囊（每一頁都看得到），點了打開連線面板（詳情、連線、中斷）。
 */
import { useShallow } from 'zustand/react/shallow';
import { BRAVE_BLUETOOTH_HELP, actions, capabilities, isDemo, openSheet, useRadar, useUi } from '../../application/container';
import { selectLink } from '../../application/selectors';
import { formatDuration } from '../../domain/units';
import { BluetoothIcon, Button, FOCUS_RING, KeyValue, Notice, PowerIcon, RefreshIcon, Sheet, SignalBars, StatusDot, cx, haptic } from '../kit';

function useLink() {
  return useRadar(useShallow((r) => selectLink({ connection: r.connection, stale: r.stale, telemetry: r.telemetry, legacyFirmware: r.legacyFirmware })));
}

/** 頁首的連線狀態；compact 用在捲動後縮小的頁首 */
export function ConnectionChip({ compact = false }: { compact?: boolean }) {
  const link = useLink();
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        openSheet('connection');
      }}
      aria-label={`連線狀態：${link.label}`}
      className={cx(
        'press inline-flex shrink-0 items-center gap-2 rounded-full font-semibold text-ink',
        compact ? 'h-8 px-2.5 text-footnote hover:bg-surface-2' : 'card h-9 px-3.5 text-footnote',
        FOCUS_RING,
      )}
    >
      <StatusDot tone={link.tone} />
      <span className="max-w-[9rem] truncate">{link.label}</span>
    </button>
  );
}

export function ConnectionSheet() {
  const open = useUi((u) => u.sheet === 'connection');
  const close = () => openSheet(null);
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
  const error = s.connection.status === 'disconnected' ? s.connection.error : undefined;

  return (
    <Sheet open={open} onClose={close} title="連線" description={isDemo ? '示範模式：模擬的 BSIS-Speed，不需要硬體' : '以藍牙連線 ESP32（裝置名稱 BSIS-Speed）'}>
      <div className="flex flex-col gap-4">
        <div className="card flex items-center gap-3 bg-surface-2 px-4 py-3.5 shadow-none">
          <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', connected ? 'bg-tint-soft text-tint' : 'bg-surface text-muted')}>
            <BluetoothIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-headline font-semibold text-ink">
              <StatusDot tone={link.tone} />
              {link.label}
            </p>
            <p className="truncate text-footnote text-muted">{s.connection.deviceName ?? (busy ? '正在連線…' : '還沒有連線的裝置')}</p>
          </div>
          {connected && s.telemetry?.radarOnline && <SignalBars pct={s.telemetry.qualityPct} showLabel={false} />}
        </div>

        {link.detail && !connected && <p className="-mt-1 px-1 text-footnote text-muted">{link.detail}</p>}

        {connected && (
          <div className="card -mx-1 overflow-hidden bg-surface-2 shadow-none">
            <KeyValue
              dense
              rows={[
                { label: '韌體', value: s.firmware ? `v${s.firmware}` : '—' },
                { label: '雷達', value: s.telemetry ? (s.telemetry.radarOnline ? '正常' : '離線') : '—' },
                { label: '雷達資料框', value: s.frameRateHz === null ? '—' : s.frameRateHz.toFixed(1), unit: s.frameRateHz === null ? undefined : 'Hz' },
                { label: 'ESP32 運作時間', value: s.telemetry ? formatDuration(s.telemetry.uptimeS) : '—' },
              ]}
            />
          </div>
        )}

        {error && (
          <Notice tone="bad" title="連線失敗" flat>
            {error}
          </Notice>
        )}
        {!capabilities.bluetooth && (
          <Notice tone="warn" title="這個瀏覽器不支援 Web Bluetooth" flat>
            Android 請用 Chrome；電腦請用 Chrome 或 Edge；iPhone 請安裝 Bluefy 瀏覽器開啟這個網址。網頁必須以 HTTPS 開啟。
          </Notice>
        )}
        {capabilities.bluetooth && capabilities.brave && (
          <Notice tone="warn" title="Brave 預設關閉藍牙" flat>
            {BRAVE_BLUETOOTH_HELP}
          </Notice>
        )}

        <div className="flex flex-col gap-2">
          {connected || busy ? (
            <Button
              variant="danger"
              size="lg"
              block
              icon={PowerIcon}
              onClick={() => {
                void actions.disconnect();
                close();
              }}
            >
              {busy ? '停止連線' : '中斷連線'}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                size="lg"
                block
                icon={BluetoothIcon}
                disabled={!capabilities.bluetooth}
                onClick={() => {
                  void actions.connect();
                  close();
                }}
              >
                連線
              </Button>
              {capabilities.knownDevices && (
                <Button
                  size="lg"
                  block
                  icon={RefreshIcon}
                  onClick={() => {
                    void actions.reconnectKnownDevice();
                    close();
                  }}
                >
                  連回上次的裝置
                </Button>
              )}
            </>
          )}
          {isDemo ? (
            <Button variant="plain" block onClick={() => window.location.assign('/')}>
              離開示範模式
            </Button>
          ) : (
            !connected && (
              <Button variant="plain" block onClick={() => window.location.assign('/?demo')}>
                沒有硬體？看示範模式
              </Button>
            )
          )}
        </div>
      </div>
    </Sheet>
  );
}
