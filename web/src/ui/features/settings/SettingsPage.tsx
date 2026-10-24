/**
 * 【設定】顯示與騎乘偏好、超速警示（存在手機）、裝置參數（存在 ESP32）、維護、App 與資料、文件。
 */
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, capabilities, openSheet, radarStore, settingsStore, toastStore, usePwa, useRadar, useSettings } from '../../../application/container';
import { ALERT_COOLDOWN_MS } from '../../../application/overspeedStore';
import type { ThemeSetting } from '../../../application/settingsStore';
import { OVERSPEED_ENTER_MS, OVERSPEED_EXIT_MS, OVERSPEED_HYSTERESIS_MPS, SPEED_LIMIT_KMH } from '../../../domain/overspeed';
import { LIMITS, diffConfig, unambiguousGroundMps } from '../../../domain/protocol';
import type { EditableConfig } from '../../../domain/types';
import { formatLimit, mpsToKmh, type SpeedUnit } from '../../../domain/units';
import { checkForUpdate } from '../../../infrastructure/pwa/pwa';
import {
  Button,
  ConfirmSheet,
  DownloadIcon,
  ExternalIcon,
  FileTextIcon,
  ListGroup,
  Notice,
  PowerIcon,
  RefreshIcon,
  Row,
  Segmented,
  Select,
  SmartphoneIcon,
  Stepper,
  Switch,
  TrashIcon,
  UploadIcon,
  inRange,
} from '../../kit';
import { PageHeader } from '../../shell/PageHeader';
import { PendingBar } from '../common/PendingBar';

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

function DisplayGroup() {
  const s = useSettings(useShallow((x) => ({ unit: x.speedUnit, theme: x.theme, haptics: x.haptics, keepAwake: x.keepAwake, autoReconnect: x.autoReconnect })));
  const update = settingsStore.getState().update;
  return (
    <>
      <ListGroup title="顯示">
        <Row label="速度單位">
          <Segmented<SpeedUnit>
            label="速度單位"
            value={s.unit}
            onChange={(speedUnit) => update({ speedUnit })}
            options={[
              { value: 'kmh', label: 'km/h' },
              { value: 'mps', label: 'm/s' },
            ]}
          />
        </Row>
        <Row label="外觀">
          <Segmented<ThemeSetting>
            label="外觀"
            value={s.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'system', label: '系統' },
              { value: 'light', label: '淺色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        </Row>
        <Row label="觸覺回饋" detail={capabilities.vibrate ? '按按鈕時輕震一下' : '這個瀏覽器不支援（iPhone 沒有震動功能可用）'}>
          <Switch label="觸覺回饋" checked={s.haptics} disabled={!capabilities.vibrate} onChange={(haptics) => update({ haptics })} />
        </Row>
      </ListGroup>
      <ListGroup title="騎乘" footer="螢幕關閉後瀏覽器會暫停網頁、藍牙也會跟著停，騎乘時請保持常亮。">
        <Row label="連線時保持螢幕常亮" detail={capabilities.wakeLock ? '騎乘模式也會保持常亮' : '這個瀏覽器不支援'}>
          <Switch label="保持螢幕常亮" checked={s.keepAwake} disabled={!capabilities.wakeLock} onChange={(keepAwake) => update({ keepAwake })} />
        </Row>
        <Row label="斷線自動重新連線" detail="1、2、4、8、10 秒後重試">
          <Switch label="斷線自動重新連線" checked={s.autoReconnect} onChange={(autoReconnect) => update({ autoReconnect })} />
        </Row>
      </ListGroup>
    </>
  );
}

/** 超速警示：速限與提示方式；可靠度受校正與雷達測速上限影響，有問題時在下方提示 */
function AlertGroup() {
  const s = useSettings(useShallow((x) => ({ on: x.speedAlert, kmh: x.speedLimitKmh, sound: x.alertSound, vibrate: x.alertVibrate, unit: x.speedUnit })));
  const config = useRadar((r) => r.config);
  const update = settingsStore.getState().update;
  const unambiguousKmh = config ? mpsToKmh(unambiguousGroundMps(config.radialLimitMps, config.angleDeg, config.calibration)) : null;
  const uncalibrated = config !== null && config.calibration === 1;
  const folding = unambiguousKmh !== null && unambiguousKmh < s.kmh;
  const hysteresisKmh = mpsToKmh(OVERSPEED_HYSTERESIS_MPS);

  return (
    <div id="alert" className="flex scroll-mt-20 flex-col gap-3">
      <ListGroup
        title="超速警示"
        footer={`對地速度持續 ${OVERSPEED_ENTER_MS / 1000} 秒達到速限時，數字與外框變紅並提示；降到速限 − ${hysteresisKmh.toFixed(0)} km/h 以下 ${OVERSPEED_EXIT_MS / 1000} 秒後解除。提示在速限附近反覆進出時最多每 ${ALERT_COOLDOWN_MS / 1000} 秒一次。`}
      >
        <Row label="超速警示">
          <Switch label="超速警示" checked={s.on} onChange={(speedAlert) => update({ speedAlert })} />
        </Row>
        <Row label="速限" detail={`預設 25 km/h：電動輔助自行車的最大行駛速率${s.unit === 'mps' ? `（${formatLimit(s.kmh, 'mps')} m/s）` : ''}`}>
          <Stepper
            label="速限"
            value={s.kmh}
            onChange={(v) => {
              const kmh = Math.round(v);
              if (kmh >= SPEED_LIMIT_KMH.min && kmh <= SPEED_LIMIT_KMH.max) update({ speedLimitKmh: kmh });
            }}
            min={SPEED_LIMIT_KMH.min}
            max={SPEED_LIMIT_KMH.max}
            step={1}
            decimals={0}
            unit="km/h"
            width="w-9"
          />
        </Row>
        <Row label="提示音" detail={capabilities.alertSound ? '進入超速時響兩聲（2 kHz）' : '這個瀏覽器不支援'}>
          <Switch label="提示音" checked={s.sound} disabled={!s.on || !capabilities.alertSound} onChange={(alertSound) => update({ alertSound })} />
        </Row>
        <Row label="震動" detail={capabilities.vibrate ? '手機裝在龍頭上時不一定感覺得到' : '這個瀏覽器不支援'}>
          <Switch label="震動" checked={s.vibrate} disabled={!s.on || !capabilities.vibrate} onChange={(alertVibrate) => update({ alertVibrate })} />
        </Row>
        <Row label="測試提示" detail="靜音或媒體音量為 0 時不會響；出發前先確認">
          <Button size="sm" variant="tinted" disabled={!s.on || (!s.sound && !s.vibrate)} onClick={() => void actions.previewAlert()}>
            測試
          </Button>
        </Row>
      </ListGroup>
      {s.on && uncalibrated && (
        <Notice tone="warn" title="尚未校正，實際超速時可能不會警示">
          CAL = 1.0000 時讀值通常偏低 10～20%（實際 {s.kmh} km/h 約顯示 {(s.kmh * 0.8).toFixed(0)}～{(s.kmh * 0.9).toFixed(0)} km/h）。請先到「校正」頁完成距離校正。
        </Notice>
      )}
      {s.on && folding && unambiguousKmh !== null && (
        <Notice tone="info" title={`速限高於雷達不折疊的最高速度 ${unambiguousKmh.toFixed(1)} km/h`}>
          速限附近的讀值要靠韌體還原折疊，需要回波連續。若驗收發現 C4001 會截斷（上手文件 §10.1），超過 {unambiguousKmh.toFixed(1)} km/h 就會顯示「超出測速上限」，這時無法判斷是否超速。
        </Notice>
      )}
    </div>
  );
}

type DeviceFields = Pick<EditableConfig, 'radarThreshold' | 'wheelMm' | 'radialLimitMps'>;

function DeviceGroup() {
  const config = useRadar((r) => r.config);
  const applying = useRadar((r) => r.applying);
  const [draft, setDraft] = useState<Partial<DeviceFields>>({});
  if (!config) {
    return (
      <ListGroup title="裝置參數（存在 ESP32）">
        <Row label="連線後會讀取 ESP32 上的參數" detail="雷達門檻、測速上限、輪周長" />
      </ListGroup>
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
    <div id="device" className="scroll-mt-20">
      <ListGroup title="裝置參數（存在 ESP32，斷電不會消失）">
        <Row label="雷達偵測門檻 RTHR" detail="越大越不靈敏；原廠 5。常常量不到路面時不要調高">
          <Stepper label="雷達偵測門檻" value={value.radarThreshold} onChange={(v) => set({ radarThreshold: Math.round(v) })} min={LIMITS.radarThreshold.min} max={LIMITS.radarThreshold.max} step={1} decimals={0} width="w-9" />
        </Row>
        <Row
          label="雷達測速上限 VMAX"
          detail={`目前安裝與校正下約 ${(unambiguousGroundMps(value.radialLimitMps, config.angleDeg, config.calibration) * 3.6).toFixed(1)} km/h；量到更大的值時韌體會自動調高`}
        >
          <Stepper label="雷達測速上限" value={value.radialLimitMps} onChange={(v) => set({ radialLimitMps: v })} min={LIMITS.radialLimitMps.min} max={LIMITS.radialLimitMps.max} step={0.01} decimals={2} unit="m/s" width="w-12" />
        </Row>
        <Row label="輪周長 WHEEL" stack detail="只用於輪速感測器（參考值）。最準：氣門嘴朝下做記號，人坐上車往前滾一圈量距離">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="常見輪胎"
              className="min-w-0 flex-1"
              value={preset ? String(preset.mm) : 'custom'}
              onChange={(v) => v !== 'custom' && set({ wheelMm: Number(v) })}
              options={[...WHEEL_PRESETS.map((p) => ({ value: String(p.mm), label: `${p.label}（${p.mm}）` })), { value: 'custom', label: '自訂' }]}
            />
            <Stepper label="輪周長" value={value.wheelMm} onChange={(v) => set({ wheelMm: Math.round(v) })} min={LIMITS.wheelMm.min} max={LIMITS.wheelMm.max} step={1} decimals={0} unit="mm" width="w-14" />
          </div>
        </Row>
      </ListGroup>
      <div className="mt-2">
        <PendingBar
          count={pending.length}
          valid={valid}
          applying={applying}
          onReset={() => setDraft({})}
          onApply={() => void radarStore.getState().applyConfig({ ...config, ...value }).then((ok) => ok && setDraft({}))}
        />
      </div>
    </div>
  );
}

function MaintenanceGroup() {
  const connected = useRadar((r) => r.connection.status === 'connected');
  const [confirm, setConfirm] = useState<'defaults' | 'reboot' | null>(null);
  const send = (type: 'get' | 'defaults' | 'reboot') => void radarStore.getState().sendCommand({ type });
  return (
    <>
      <ListGroup title="維護" footer={connected ? undefined : '連線後才能使用。'}>
        <Row label="重新讀取設定" detail="從 ESP32 讀回目前所有參數" icon={RefreshIcon} disabled={!connected} onClick={() => send('get')} />
        <Row label="恢復預設值" detail="安裝參數、校正係數都回到出廠值" icon={TrashIcon} destructive disabled={!connected} onClick={() => setConfirm('defaults')} />
        <Row label="重新啟動 ESP32" detail="約 5 秒後恢復；網頁會自動重新連線" icon={PowerIcon} destructive disabled={!connected} onClick={() => setConfirm('reboot')} />
      </ListGroup>
      <ConfirmSheet
        open={confirm === 'defaults'}
        title="恢復預設值"
        message="所有參數都會回到預設值，包括校正係數。之後需要重新設定安裝幾何並校正。"
        confirmLabel="恢復預設"
        destructive
        onConfirm={() => send('defaults')}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet open={confirm === 'reboot'} title="重新啟動 ESP32" message="雷達與藍牙會中斷約 5 秒。" confirmLabel="重新啟動" destructive onConfirm={() => send('reboot')} onClose={() => setConfirm(null)} />
    </>
  );
}

function AppGroup() {
  const pwa = usePwa(useShallow((p) => ({ standalone: p.standalone, installed: p.installed, offlineReady: p.offlineReady, update: p.update })));
  const firmware = useRadar((r) => r.config?.firmware ?? r.legacyFirmware);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const found = await checkForUpdate();
    setChecking(false);
    if (!found) toastStore.getState().push('success', '已經是最新版', `網頁 v${__APP_VERSION__}`);
  };
  return (
    <ListGroup title="App">
      <Row
        label="安裝成 App"
        detail={pwa.standalone ? '現在是從主畫面打開的 App' : pwa.installed ? '這台已經安裝' : '從主畫面一鍵打開、全螢幕顯示'}
        icon={SmartphoneIcon}
        chevron
        onClick={() => openSheet('install')}
      />
      <Row label="離線開啟" value={pwa.offlineReady ? '可以' : import.meta.env.PROD ? '準備中' : '開發模式不支援'} />
      <Row label="網頁版本" value={`v${__APP_VERSION__}`}>
        {pwa.update ? (
          <Button size="sm" variant="tinted" onClick={() => window.location.reload()}>
            更新到 v{pwa.update.version}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={checking} onClick={() => void check()}>
            {checking ? '檢查中…' : '檢查更新'}
          </Button>
        )}
      </Row>
      <Row label="韌體版本" value={firmware ? `v${firmware}` : '—'} />
    </ListGroup>
  );
}

function DataGroup() {
  const file = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const result = actions.importBackup(await f.text());
    if (typeof result === 'string') toastStore.getState().push('error', '無法匯入', result);
    if (file.current) file.current.value = '';
  };
  return (
    <>
      <ListGroup title="資料（存在這支手機的瀏覽器裡）" footer="換手機、清除瀏覽器資料前先備份。匯入時設定會被取代，行程與校正紀錄會合併（不會重複）。">
        <Row label="匯出備份" detail="設定、行程紀錄、校正紀錄存成一個 JSON 檔" icon={DownloadIcon} onClick={actions.exportBackup} />
        <Row label="匯入備份" detail="選擇之前匯出的 JSON 檔" icon={UploadIcon} onClick={() => file.current?.click()} />
        <Row label="清除這台裝置的資料" detail="設定、行程、校正紀錄全部刪除（ESP32 上的參數不受影響）" icon={TrashIcon} destructive onClick={() => setConfirmReset(true)} />
      </ListGroup>
      <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      <ConfirmSheet
        open={confirmReset}
        title="清除這台裝置的資料"
        message="設定會回到預設值，行程紀錄與校正紀錄都會刪除，無法復原。"
        confirmLabel="全部清除"
        destructive
        onConfirm={actions.clearLocalData}
        onClose={() => setConfirmReset(false)}
      />
    </>
  );
}

function DocsGroup() {
  const docs = 'https://github.com/Ming874/bsis-radar/blob/main/docs';
  const links = [
    { href: `${docs}/GETTING_STARTED.md`, label: '上手文件', detail: '安裝、燒錄、校正、驗收' },
    { href: `${docs}/ALGORITHM.md`, label: '演算法與文獻', detail: '對地測速原理、誤差分析' },
    { href: `${docs}/SPEED_ALERT.md`, label: '超速警示', detail: '速限依據、判斷規則、限制' },
    { href: `${docs}/PROTOCOL.md`, label: '通訊協定', detail: '遙測欄位與指令' },
    { href: 'https://github.com/Ming874/bsis-radar', label: '原始碼', detail: 'GitHub' },
  ];
  return (
    <ListGroup title="文件">
      {links.map((l) => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60 active:bg-surface-2">
          <FileTextIcon className="h-5 w-5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-body text-ink">{l.label}</span>
            <span className="block text-footnote text-muted">{l.detail}</span>
          </span>
          <ExternalIcon className="h-4 w-4 shrink-0 text-faint" />
        </a>
      ))}
    </ListGroup>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader title="設定" description="這支手機上的偏好，以及存在 ESP32 的裝置參數" />
      <div className="grid items-start gap-7 lg:grid-cols-2">
        <div className="grid gap-7">
          <DisplayGroup />
          <AlertGroup />
          <AppGroup />
        </div>
        <div className="grid gap-7">
          <DeviceGroup />
          <MaintenanceGroup />
          <DataGroup />
          <DocsGroup />
        </div>
      </div>
      <p className="mt-8 text-center text-caption text-faint">
        BSIS 測速 · 網頁 v{__APP_VERSION__} · 國立彰化師範大學 電機與機械科技學系 專題製作
      </p>
    </>
  );
}
