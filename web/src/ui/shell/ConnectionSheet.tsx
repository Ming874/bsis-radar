/**
 * 【外框】連線面板：點右上角的連線狀態打開，所有連線相關操作都在這裡。
 */
import { useShallow } from 'zustand/react/shallow';
import { BRAVE_BLUETOOTH_HELP, actions, capabilities, useRadar } from '../../application/container';
import { formatDuration } from '../../domain/units';
import { Banner, BluetoothIcon, ListRow, RefreshIcon, Section, Sheet, StopIcon } from '../kit';

export function ConnectionSheet({ onClose }: { onClose: () => void }) {
  const { status, deviceName, attempt, uptimeS, radarOnline } = useRadar(
    useShallow((s) => ({
      status: s.connection.status,
      deviceName: s.connection.deviceName,
      attempt: s.connection.attempt,
      uptimeS: s.telemetry?.uptimeS ?? null,
      radarOnline: s.telemetry?.radarOnline ?? null,
    })),
  );
  const run = (fn: () => unknown) => () => {
    void fn();
    onClose();
  };

  const statusText =
    status === 'connected'
      ? `已連線：${deviceName ?? 'ESP32'}`
      : status === 'connecting'
        ? '連線中…'
        : status === 'reconnecting'
          ? `重新連線中（第 ${attempt ?? 1} 次）`
          : '尚未連線';

  return (
    <Sheet title="連線" description={statusText} onClose={onClose}>
      <div className="space-y-4 pt-1">
        {status === 'connected' && (
          <Section>
            <ListRow title="裝置" value={deviceName ?? 'ESP32'} />
            <ListRow title="雷達" value={radarOnline === null ? '—' : radarOnline ? '在線' : '離線'} />
            <ListRow title="ESP32 運作時間" value={uptimeS === null ? '—' : formatDuration(uptimeS)} />
          </Section>
        )}

        {capabilities.brave && status !== 'connected' && (
          <Banner tone="warning" title="偵測到 Brave 瀏覽器">
            {BRAVE_BLUETOOTH_HELP}
          </Banner>
        )}
        {!capabilities.bluetooth && (
          <Banner tone="warning" title="這個瀏覽器不能連藍牙">
            Android 請用 Chrome；電腦請用 Chrome 或 Edge；iPhone 請改用 Bluefy 瀏覽器。
          </Banner>
        )}

        {status === 'idle' || status === 'disconnected' ? (
          capabilities.bluetooth && (
            <Section>
              <ListRow icon={<BluetoothIcon />} title="連線雷達" description="選擇 RadarA-ESP32" accessory={null} onClick={run(actions.connectBluetooth)} />
              {capabilities.knownDevices && (
                <ListRow icon={<RefreshIcon />} title="連回上次的裝置" accessory={null} onClick={run(actions.reconnectKnownDevice)} />
              )}
            </Section>
          )
        ) : (
          <Section>
            <ListRow
              icon={<StopIcon />}
              destructive
              title={status === 'connected' ? '中斷連線' : '取消連線'}
              accessory={null}
              onClick={run(actions.disconnect)}
            />
          </Section>
        )}
      </div>
    </Sheet>
  );
}
