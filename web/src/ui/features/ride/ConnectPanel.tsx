/**
 * 【騎乘】還沒連線時的引導畫面：三個步驟 + 一個主要按鈕，瀏覽器不相容時直接說明怎麼辦。
 * 手機與電腦都置中顯示成一張卡片。
 */
import { BRAVE_BLUETOOTH_HELP, actions, capabilities } from '../../../application/container';
import { Banner, BluetoothIcon, Button, RadarIcon, RefreshIcon } from '../../kit';

const STEPS = ['打開 ESP32 電源（板子藍燈慢閃）', '按下方「連線雷達」，選擇 RadarA-ESP32', '騎車時把手機固定在龍頭，保持這個畫面開著'];

export function ConnectPanel() {
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;
  return (
    <div className="mx-auto max-w-md lg:max-w-lg lg:pt-8">
      <div className="rounded-widget bg-surface px-5 pt-8 pb-5 shadow-card ring-1 ring-line/80 lg:px-8 lg:pt-10 lg:pb-8">
        <div className="flex flex-col items-center text-center">
          <span className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[22px] bg-accent text-white shadow-lg shadow-accent/30">
            <span aria-hidden className="absolute inset-0 bg-linear-to-b from-white/30 to-transparent" />
            <RadarIcon className="relative h-10 w-10" />
          </span>
          <h2 className="mt-5 text-headline font-bold tracking-tight text-ink">連線你的 Radar A</h2>
          <p className="mt-2 max-w-sm text-body leading-relaxed text-ink-2">手機和後方雷達連上後，有車從後方接近就會用聲音、震動和畫面提醒你。</p>
        </div>

        <ol className="mt-7 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-body text-ink">
              <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-callout font-bold text-accent-ink">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>

        {(insecure || capabilities.brave || !capabilities.bluetooth) && (
          <div className="mt-6 space-y-3">
            {insecure && (
              <Banner tone="danger" title="需要 HTTPS">
                瀏覽器只允許在 HTTPS 網頁使用藍牙，請用正式網址 bsis.iosoftware.ai 開啟。
              </Banner>
            )}
            {capabilities.brave && (
              <Banner tone="warning" title="偵測到 Brave 瀏覽器">
                {BRAVE_BLUETOOTH_HELP}
              </Banner>
            )}
            {!capabilities.bluetooth && (
              <Banner tone="warning" title="這個瀏覽器不能連藍牙">
                Android 請用 Chrome；電腦請用 Chrome 或 Edge；iPhone 的 Safari 不支援，請改用 Bluefy 瀏覽器。
              </Banner>
            )}
          </div>
        )}

        {capabilities.bluetooth && (
          <div className="mt-7 space-y-2">
            <Button variant="primary" size="lg" block onClick={() => void actions.connectBluetooth()}>
              <BluetoothIcon />
              連線雷達
            </Button>
            {capabilities.knownDevices && (
              <Button variant="plain" block onClick={() => void actions.reconnectKnownDevice()}>
                <RefreshIcon />
                連回上次的裝置
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
