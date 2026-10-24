/**
 * 【UI 層】未連線時的引導（速度頁最上面）：大按鈕連線、連回上次的裝置、瀏覽器不支援時的說明。
 */
import { BRAVE_BLUETOOTH_HELP, actions, capabilities, useRadar } from '../../../application/container';
import { BluetoothIcon, Button, Card, Notice, RefreshIcon } from '../../kit';

export function ConnectPanel() {
  const status = useRadar((r) => r.connection.status);
  const error = useRadar((r) => (r.connection.status === 'disconnected' ? r.connection.error : undefined));
  const busy = status === 'connecting' || status === 'reconnecting';

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tint-soft text-tint">
          <BluetoothIcon className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-headline font-semibold text-ink">連線測速雷達</h2>
          <p className="mt-0.5 text-footnote text-muted">
            打開 ESP32 的電源，手機靠近一點再按連線。第一次使用請先看
            <a className="mx-0.5 font-semibold text-tint" href="https://github.com/Ming874/bsis-radar/blob/main/docs/GETTING_STARTED.md" target="_blank" rel="noreferrer">
              上手文件
            </a>
            。
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" size="lg" icon={BluetoothIcon} className="sm:flex-1" block disabled={!capabilities.bluetooth || busy} onClick={() => void actions.connect()}>
          {busy ? '連線中…' : '連線'}
        </Button>
        {capabilities.knownDevices && (
          <Button size="lg" icon={RefreshIcon} className="sm:flex-1" block disabled={busy} onClick={() => void actions.reconnectKnownDevice()}>
            連回上次的裝置
          </Button>
        )}
      </div>
      {(error || !capabilities.bluetooth || capabilities.brave) && (
        <div className="mt-4 flex flex-col gap-2">
          {error && (
            <Notice tone="bad" title="連線失敗" flat>
              {error}
            </Notice>
          )}
          {!capabilities.bluetooth && (
            <Notice tone="warn" title="這個瀏覽器不支援 Web Bluetooth" flat>
              Android 請用 Chrome；電腦請用 Chrome 或 Edge；iPhone 請安裝 Bluefy 瀏覽器開啟這個網址。沒有硬體也可以
              <a className="mx-0.5 font-semibold text-tint" href="/?demo">
                看示範模式
              </a>
              。
            </Notice>
          )}
          {capabilities.bluetooth && capabilities.brave && (
            <Notice tone="warn" title="Brave 預設關閉藍牙" flat>
              {BRAVE_BLUETOOTH_HELP}
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}
