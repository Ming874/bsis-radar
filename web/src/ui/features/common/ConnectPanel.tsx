/**
 * 【UI 層】未連線時的引導：連線按鈕、瀏覽器支援說明。
 */
import { BRAVE_BLUETOOTH_HELP, actions, capabilities, useRadar } from '../../../application/container';
import { BluetoothIcon, Button, Notice, Panel } from '../../kit';

export function ConnectPanel() {
  const status = useRadar((r) => r.connection.status);
  const error = useRadar((r) => (r.connection.status === 'disconnected' ? r.connection.error : undefined));
  const busy = status === 'connecting' || status === 'reconnecting';

  return (
    <Panel>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-value font-semibold text-fg">連線測速雷達</h2>
          <p className="mt-1 text-body text-muted">
            以藍牙連線 ESP32（裝置名稱 BSIS-Speed）。第一次使用請先依
            <a className="mx-1 text-accent hover:underline" href="https://github.com/Ming874/bsis-radar/blob/main/docs/GETTING_STARTED.md" target="_blank" rel="noreferrer">
              上手文件
            </a>
            完成安裝與校正。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {capabilities.knownDevices && (
            <Button disabled={busy} onClick={() => void actions.reconnectKnownDevice()}>
              連回上次的裝置
            </Button>
          )}
          <Button variant="primary" icon={BluetoothIcon} disabled={!capabilities.bluetooth || busy} onClick={() => void actions.connect()}>
            {busy ? '連線中…' : '連線'}
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="bad" title="連線失敗">
            {error}
          </Notice>
        </div>
      )}
      {!capabilities.bluetooth && (
        <div className="mt-4">
          <Notice tone="warn" title="這個瀏覽器不支援 Web Bluetooth">
            Android 請用 Chrome；電腦請用 Chrome 或 Edge；iPhone 請安裝 Bluefy 瀏覽器。網頁必須以 HTTPS 開啟。
          </Notice>
        </div>
      )}
      {capabilities.bluetooth && capabilities.brave && (
        <div className="mt-4">
          <Notice tone="warn" title="Brave 預設關閉藍牙">
            {BRAVE_BLUETOOTH_HELP}
          </Notice>
        </div>
      )}
    </Panel>
  );
}
