/**
 * 【設定】這個瀏覽器上的網頁設定：警示方式、顯示、連線、說明、關於。
 * （ESP32 的偵測參數在「裝置」頁。）電腦版分兩欄。
 */
import { useCallback, useState } from 'react';
import { BRAVE_BLUETOOTH_HELP, alerts, capabilities, settingsStore, useRadar, useSettings } from '../../../application/container';
import type { AlertMode, AppSettings, ThemeSetting } from '../../../application/settingsStore';
import type { SpeedUnit } from '../../../domain/units';
import { APP_HELP, FAQ } from '../../content/help';
import {
  AlertIcon,
  Banner,
  Button,
  ConfirmSheet,
  GaugeIcon,
  HelpBody,
  HelpIcon,
  ListRow,
  MicIcon,
  PageHeader,
  PhoneIcon,
  PlayIcon,
  RadarIcon,
  RefreshIcon,
  RulerIcon,
  Section,
  Segmented,
  Sheet,
  Slider,
  SunIcon,
  Switch,
  TerminalIcon,
  VibrateIcon,
  VolumeIcon,
  ZapIcon,
} from '../../kit';

const update = (patch: Partial<AppSettings>) => settingsStore.getState().update(patch);

type SheetState = { kind: 'faq'; index: number } | { kind: 'format' } | { kind: 'reset' } | null;

const FORMAT_TEXT = `ESP32 → 網頁（每 0.2 秒）
R=1 W=1 L=2 D=8.42 V=6.20 TTC=1.4 N=1 RD=8.50 RV=-6.31 E=52000 T=35

設定回覆
CFG TEST=1 MINSPD=1.50 MINE=0 RANGE=15.0 SIGN=-1
    DTTC=1.5 DDIST=4.0 HOLD=1000 CONFIRM=3 FW=2.0.0

網頁 → ESP32
GET  TEST 0|1  MINSPD 1.5  MINE 50000  RANGE 15
SIGN -1|0|1  DTTC 1.5  DDIST 4  HOLD 1000  CONFIRM 3
DEFAULTS  REBOOT`;

export function SettingsPage() {
  const s = useSettings((x) => x);
  const firmware = useRadar((r) => r.config?.firmware ?? '—');
  const [sheet, setSheet] = useState<SheetState>(null);
  const close = useCallback(() => setSheet(null), []);
  const faq = sheet?.kind === 'faq' ? FAQ[sheet.index] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="設定" subtitle="這個瀏覽器上的網頁設定；ESP32 的偵測參數在「裝置」頁" />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <Section title="警示方式">
            <ListRow
              icon={<VolumeIcon />}
              title="嗶聲"
              description={APP_HELP.sound.short}
              accessory={<Switch label="嗶聲" checked={s.sound} onChange={(v) => update({ sound: v })} />}
            />
            <ListRow title="音量" value={`${Math.round(s.volume * 100)}%`} disabled={!s.sound}>
              <Slider label="音量" value={s.volume} onChange={(v) => update({ volume: v })} min={0} max={1} step={0.05} disabled={!s.sound} />
            </ListRow>
            <ListRow icon={<AlertIcon />} tone="caution" title="提醒時機" description={APP_HELP.alertMode.short} help={APP_HELP.alertMode}>
              <Segmented<AlertMode>
                label="提醒時機"
                value={s.alertMode}
                onChange={(v) => update({ alertMode: v })}
                options={[
                  { value: 'caution', label: '注意就提醒' },
                  { value: 'danger', label: '危險才提醒' },
                ]}
              />
            </ListRow>
            <ListRow
              icon={<VibrateIcon />}
              title="震動"
              description={capabilities.vibration ? APP_HELP.vibration.short : '這個裝置或瀏覽器不支援震動'}
              disabled={!capabilities.vibration}
              accessory={<Switch label="震動" checked={s.vibration} disabled={!capabilities.vibration} onChange={(v) => update({ vibration: v })} />}
            />
            <ListRow
              icon={<MicIcon />}
              title="語音播報"
              description={capabilities.speech ? APP_HELP.voice.short : '這個瀏覽器不支援語音'}
              disabled={!capabilities.speech}
              accessory={<Switch label="語音播報" checked={s.voice} disabled={!capabilities.speech} onChange={(v) => update({ voice: v })} />}
            />
            <ListRow
              icon={<RulerIcon />}
              title="播報距離"
              description={APP_HELP.speakDistance.short}
              disabled={!s.voice || !capabilities.speech}
              accessory={
                <Switch
                  label="播報距離"
                  checked={s.speakDistance}
                  disabled={!s.voice || !capabilities.speech}
                  onChange={(v) => update({ speakDistance: v })}
                />
              }
            />
            <ListRow
              icon={<ZapIcon />}
              tone="danger"
              title="危險時畫面泛紅光"
              description={APP_HELP.flashScreen.short}
              accessory={<Switch label="危險時畫面泛紅光" checked={s.flashScreen} onChange={(v) => update({ flashScreen: v })} />}
            />
            <ListRow icon={<PlayIcon />} tone="safe" title="測試警示" description="播放一次嗶聲、震動與語音" accessory={null} onClick={() => alerts.test()} />
          </Section>

          <Section title="顯示">
            <ListRow
              icon={<PhoneIcon />}
              title="連線時保持螢幕常亮"
              description={capabilities.wakeLock ? APP_HELP.keepAwake.short : '這個瀏覽器不支援，請延長手機的螢幕關閉時間'}
              disabled={!capabilities.wakeLock}
              accessory={<Switch label="保持螢幕常亮" checked={s.keepAwake} disabled={!capabilities.wakeLock} onChange={(v) => update({ keepAwake: v })} />}
            />
            <ListRow icon={<GaugeIcon />} title="速度單位">
              <Segmented<SpeedUnit>
                label="速度單位"
                value={s.speedUnit}
                onChange={(v) => update({ speedUnit: v })}
                options={[
                  { value: 'kmh', label: '公里/時 km/h' },
                  { value: 'mps', label: '公尺/秒 m/s' },
                ]}
              />
            </ListRow>
            <ListRow icon={<SunIcon />} title="外觀" description={APP_HELP.theme.short}>
              <Segmented<ThemeSetting>
                label="外觀"
                value={s.theme}
                onChange={(v) => update({ theme: v })}
                options={[
                  { value: 'light', label: '淺色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟隨系統' },
                ]}
              />
            </ListRow>
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          <Section title="連線">
            <ListRow
              icon={<RefreshIcon />}
              title="斷線自動重新連線"
              description={APP_HELP.autoReconnect.short}
              accessory={<Switch label="斷線自動重新連線" checked={s.autoReconnect} onChange={(v) => update({ autoReconnect: v })} />}
            />
          </Section>
          {capabilities.brave && (
            <Banner tone="warning" title="Brave 瀏覽器">
              {BRAVE_BLUETOOTH_HELP}
            </Banner>
          )}

          <Section title="使用說明">
            {FAQ.map((item, index) => (
              <ListRow key={item.q} icon={<HelpIcon />} tone="neutral" title={item.q} onClick={() => setSheet({ kind: 'faq', index })} />
            ))}
            <ListRow icon={<TerminalIcon />} tone="neutral" title="資料格式（給開發者）" onClick={() => setSheet({ kind: 'format' })} />
          </Section>

          <Section title="關於">
            <ListRow icon={<RadarIcon />} title="Radar A 後方來車警示" description="以 Web Bluetooth 連線 ESP32 與 C4001 毫米波雷達" />
            <ListRow title="網頁版本" value={__APP_VERSION__} />
            <ListRow title="ESP32 韌體" value={firmware} />
            <ListRow
              title="Web Bluetooth"
              value={capabilities.bluetooth && !capabilities.brave ? '支援' : capabilities.brave ? '需在 Brave 開啟' : '不支援'}
            />
            <ListRow
              title="保持亮屏・震動・語音"
              value={[capabilities.wakeLock, capabilities.vibration, capabilities.speech].map((v) => (v ? '✓' : '✕')).join(' ')}
            />
            <ListRow destructive title="網頁設定恢復預設" accessory={null} onClick={() => setSheet({ kind: 'reset' })} />
          </Section>
        </div>
      </div>

      {faq && (
        <Sheet
          title={faq.q}
          onClose={close}
          footer={
            <Button variant="primary" block onClick={close}>
              我知道了
            </Button>
          }
        >
          <HelpBody paragraphs={faq.a} />
        </Sheet>
      )}
      {sheet?.kind === 'format' && (
        <Sheet title="資料格式" description="ESP32 與網頁之間的文字協定" onClose={close}>
          <pre className="overflow-x-auto rounded-card bg-slate-950 p-4 font-mono text-[12px] leading-relaxed text-slate-100">{FORMAT_TEXT}</pre>
        </Sheet>
      )}
      {sheet?.kind === 'reset' && (
        <ConfirmSheet
          title="網頁設定恢復預設？"
          message="聲音、震動、外觀等這個瀏覽器上的設定會恢復預設；ESP32 的偵測參數不受影響。"
          confirmLabel="恢復預設"
          destructive
          onConfirm={() => settingsStore.getState().reset()}
          onClose={close}
        />
      )}
    </div>
  );
}
