/**
 * 【設定】顯示偏好（存在手機）、裝置參數（存在 ESP32）、維護、關於。
 */
import { useState } from 'react';
import { capabilities, radarStore, settingsStore, useRadar, useSettings } from '../../../application/container';
import type { ThemeSetting } from '../../../application/settingsStore';
import { LIMITS, diffConfig, unambiguousGroundMps } from '../../../domain/protocol';
import type { EditableConfig } from '../../../domain/types';
import type { SpeedUnit } from '../../../domain/units';
import {
  Button,
  ConfirmDialog,
  ExternalIcon,
  Field,
  FieldGroup,
  KeyValue,
  NumberInput,
  PageHeader,
  Panel,
  PowerIcon,
  RefreshIcon,
  Segmented,
  Select,
  Switch,
  inRange,
} from '../../kit';

/** 常見輪胎的輪周長（mm，碼表廠商的對照表）；實際以滾動法量測最準 */
const WHEEL_PRESETS: Array<{ label: string; mm: number }> = [
  { label: '700×23C', mm: 2096 },
  { label: '700×25C', mm: 2105 },
  { label: '700×28C', mm: 2136 },
  { label: '700×32C', mm: 2155 },
  { label: '700×35C', mm: 2168 },
  { label: '700×38C', mm: 2180 },
  { label: '26×1.95', mm: 2050 },
  { label: '26×2.10', mm: 2068 },
  { label: '27.5×2.1', mm: 2148 },
  { label: '29×2.1', mm: 2288 },
  { label: '20×1.75', mm: 1515 },
];

function DisplayPanel() {
  const s = useSettings((x) => x);
  const update = settingsStore.getState().update;
  return (
    <Panel title="顯示" description="存在這支手機的瀏覽器裡" flush>
      <FieldGroup>
        <Field label="速度單位">
          <Segmented<SpeedUnit>
            label="速度單位"
            value={s.speedUnit}
            onChange={(speedUnit) => update({ speedUnit })}
            options={[
              { value: 'kmh', label: 'km/h' },
              { value: 'mps', label: 'm/s' },
            ]}
          />
        </Field>
        <Field label="外觀">
          <Segmented<ThemeSetting>
            label="外觀"
            value={s.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'dark', label: '深色' },
              { value: 'light', label: '淺色' },
              { value: 'system', label: '跟隨系統' },
            ]}
          />
        </Field>
        <Field label="連線時保持螢幕常亮" description={capabilities.wakeLock ? '螢幕關閉後瀏覽器會暫停網頁，騎乘時建議開啟' : '這個瀏覽器不支援'}>
          <Switch label="保持螢幕常亮" checked={s.keepAwake} disabled={!capabilities.wakeLock} onChange={(keepAwake) => update({ keepAwake })} />
        </Field>
        <Field label="斷線自動重新連線">
          <Switch label="斷線自動重新連線" checked={s.autoReconnect} onChange={(autoReconnect) => update({ autoReconnect })} />
        </Field>
      </FieldGroup>
    </Panel>
  );
}

type DeviceFields = Pick<EditableConfig, 'radarThreshold' | 'wheelMm' | 'radialLimitMps'>;

function DevicePanel() {
  const config = useRadar((r) => r.config);
  const applying = useRadar((r) => r.applying);
  const [draft, setDraft] = useState<Partial<DeviceFields>>({});
  if (!config) {
    return (
      <Panel title="裝置參數">
        <p className="text-body text-muted">連線後會讀取 ESP32 上的參數。</p>
      </Panel>
    );
  }
  const value: DeviceFields = {
    radarThreshold: draft.radarThreshold ?? config.radarThreshold,
    wheelMm: draft.wheelMm ?? config.wheelMm,
    radialLimitMps: draft.radialLimitMps ?? config.radialLimitMps,
  };
  const set = (patch: Partial<DeviceFields>) => setDraft((d) => ({ ...d, ...patch }));
  const pending = diffConfig(config, { ...config, ...value });
  const valid =
    inRange(value.radarThreshold, LIMITS.radarThreshold.min, LIMITS.radarThreshold.max) &&
    Number.isInteger(value.radarThreshold) &&
    inRange(value.wheelMm, LIMITS.wheelMm.min, LIMITS.wheelMm.max) &&
    Number.isInteger(value.wheelMm) &&
    inRange(value.radialLimitMps, LIMITS.radialLimitMps.min, LIMITS.radialLimitMps.max);
  const preset = WHEEL_PRESETS.find((p) => p.mm === value.wheelMm);

  return (
    <Panel
      title="裝置參數"
      description="存在 ESP32，斷電不會消失"
      flush
      footer={
        pending.length > 0 ? (
          <>
            <span className="mr-auto text-label text-muted">{pending.length} 項變更尚未套用</span>
            <Button variant="ghost" onClick={() => setDraft({})}>
              還原
            </Button>
            <Button
              variant="primary"
              disabled={!valid || applying}
              onClick={() => void radarStore.getState().applyConfig({ ...config, ...value }).then((ok) => ok && setDraft({}))}
            >
              {applying ? '套用中…' : '套用到裝置'}
            </Button>
          </>
        ) : undefined
      }
    >
      <FieldGroup>
        <Field label="雷達偵測門檻 RTHR" description="C4001 本身的門檻，越大越不靈敏。原廠 5；路面回波弱、常常量不到時不要調高">
          <NumberInput label="雷達偵測門檻" value={value.radarThreshold} onChange={(v) => set({ radarThreshold: Math.round(v) })} min={LIMITS.radarThreshold.min} max={LIMITS.radarThreshold.max} step={1} decimals={0} width="w-12" />
        </Field>
        <Field
          label="雷達測速上限 VMAX"
          description={`C4001 徑向速度的上限（預設 3.28）；目前安裝與校正下約 ${(unambiguousGroundMps(value.radialLimitMps, config.angleDeg, config.calibration) * 3.6).toFixed(1)} km/h，超過時韌體以連續追蹤還原折疊。量到更大的值時韌體會自動調高`}
        >
          <NumberInput label="雷達測速上限" value={value.radialLimitMps} onChange={(v) => set({ radialLimitMps: v })} min={LIMITS.radialLimitMps.min} max={LIMITS.radialLimitMps.max} step={0.01} decimals={2} unit="m/s" width="w-14" />
        </Field>
        <Field label="輪周長 WHEEL" description="只用於輪速感測器（參考值）。最準的量法：氣門嘴朝下做記號，人坐上車往前滾一圈，量兩個記號的距離">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              label="常見輪胎"
              value={preset ? String(preset.mm) : 'custom'}
              onChange={(v) => v !== 'custom' && set({ wheelMm: Number(v) })}
              options={[...WHEEL_PRESETS.map((p) => ({ value: String(p.mm), label: `${p.label}（${p.mm}）` })), { value: 'custom', label: '自訂' }]}
            />
            <NumberInput label="輪周長" value={value.wheelMm} onChange={(v) => set({ wheelMm: Math.round(v) })} min={LIMITS.wheelMm.min} max={LIMITS.wheelMm.max} step={1} decimals={0} unit="mm" width="w-14" />
          </div>
        </Field>
      </FieldGroup>
    </Panel>
  );
}

function MaintenancePanel() {
  const connected = useRadar((r) => r.connection.status === 'connected');
  const [confirm, setConfirm] = useState<'defaults' | 'reboot' | null>(null);
  const send = (type: 'get' | 'defaults' | 'reboot') => void radarStore.getState().sendCommand({ type });
  return (
    <Panel title="維護" flush>
      <FieldGroup>
        <Field label="重新讀取設定" description="從 ESP32 讀回目前所有參數">
          <Button size="sm" icon={RefreshIcon} disabled={!connected} onClick={() => send('get')}>
            讀取
          </Button>
        </Field>
        <Field label="恢復預設值" description="安裝參數、校正係數都回到出廠值（CAL = 1.0000）">
          <Button size="sm" variant="danger" disabled={!connected} onClick={() => setConfirm('defaults')}>
            恢復預設
          </Button>
        </Field>
        <Field label="重新啟動 ESP32" description="約 5 秒後恢復；網頁會自動重新連線">
          <Button size="sm" variant="danger" icon={PowerIcon} disabled={!connected} onClick={() => setConfirm('reboot')}>
            重新啟動
          </Button>
        </Field>
      </FieldGroup>
      {confirm === 'defaults' && (
        <ConfirmDialog
          title="恢復預設值"
          message="所有參數都會回到預設值，包括校正係數。之後需要重新設定安裝幾何並校正。"
          confirmLabel="恢復預設"
          destructive
          onConfirm={() => send('defaults')}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'reboot' && (
        <ConfirmDialog title="重新啟動 ESP32" message="雷達與藍牙會中斷約 5 秒。" confirmLabel="重新啟動" destructive onConfirm={() => send('reboot')} onClose={() => setConfirm(null)} />
      )}
    </Panel>
  );
}

function AboutPanel() {
  const firmware = useRadar((r) => r.config?.firmware ?? r.legacyFirmware);
  const docs = 'https://github.com/Ming874/bsis-radar/blob/main/docs';
  return (
    <Panel title="關於" flush>
      <KeyValue
        rows={[
          { label: '網頁版本', value: `v${__APP_VERSION__}` },
          { label: '韌體版本', value: firmware ? `v${firmware}` : '—' },
        ]}
      />
      <ul className="divide-y divide-line border-t border-line text-body">
        {[
          { href: `${docs}/GETTING_STARTED.md`, label: '上手文件：安裝、燒錄、校正、驗收' },
          { href: `${docs}/ALGORITHM.md`, label: '演算法與文獻：對地測速原理、誤差分析' },
          { href: `${docs}/PROTOCOL.md`, label: '通訊協定：遙測欄位與指令' },
          { href: 'https://github.com/Ming874/bsis-radar', label: '原始碼（GitHub）' },
        ].map((l) => (
          <li key={l.href}>
            <a href={l.href} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 px-4 py-2.5 text-fg hover:bg-hover">
              {l.label}
              <ExternalIcon className="h-4 w-4 shrink-0 text-subtle" />
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="設定" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="grid gap-4">
          <DisplayPanel />
          <DevicePanel />
        </div>
        <div className="grid gap-4">
          <MaintenancePanel />
          <AboutPanel />
        </div>
      </div>
    </>
  );
}
