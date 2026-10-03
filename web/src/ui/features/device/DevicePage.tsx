/**
 * 【裝置】ESP32 與雷達：即時原始資料、模式切換、9 項偵測參數（點一下編輯）、工具。
 * 電腦版分兩欄：左邊資料與工具、右邊偵測參數。
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, capabilities, radarStore, useRadar } from '../../../application/container';
import { selectEnergyPeak } from '../../../application/selectors';
import { DEFAULT_DEVICE_CONFIG } from '../../../domain/protocol';
import type { VelocitySource } from '../../../domain/types';
import { formatDuration, mpsToKmh } from '../../../domain/units';
import { PARAM_HELP, VALUE_HELP } from '../../content/help';
import {
  ActivityIcon,
  AlertIcon,
  Banner,
  BluetoothIcon,
  BookIcon,
  Button,
  CheckCircleIcon,
  ClockIcon,
  ConfirmSheet,
  CpuIcon,
  EmptyState,
  GaugeIcon,
  HelpButton,
  HistoryIcon,
  ListRow,
  PageHeader,
  RefreshIcon,
  RulerIcon,
  Section,
  Segmented,
  SlidersIcon,
  StatusDot,
  TerminalIcon,
  ZapIcon,
  type DotState,
  type Tone,
} from '../../kit';
import { NumericParamSheet, SignSheet } from './ParamSheet';
import { NUMERIC_PARAMS, PARAM_GROUPS, signLabel, type ParamKey } from './params';
import { ConsoleSheet, GuideSheet } from './ToolSheets';

const PARAM_ICON: Record<ParamKey, { icon: ReactNode; tone: Tone }> = {
  minSpeedMps: { icon: <GaugeIcon />, tone: 'accent' },
  minEnergy: { icon: <ActivityIcon />, tone: 'accent' },
  approachSign: { icon: <SlidersIcon />, tone: 'accent' },
  warnRangeM: { icon: <RulerIcon />, tone: 'caution' },
  dangerTtcS: { icon: <ClockIcon />, tone: 'danger' },
  dangerDistM: { icon: <AlertIcon />, tone: 'danger' },
  confirmHits: { icon: <CheckCircleIcon />, tone: 'safe' },
  holdMs: { icon: <HistoryIcon />, tone: 'safe' },
};

type SheetState = { kind: 'param'; key: ParamKey } | { kind: 'console' } | { kind: 'guide' } | { kind: 'defaults' } | { kind: 'reboot' } | null;

/** 速度交叉核對的結果（韌體 VS 欄位） */
const VELOCITY_SOURCE: Record<VelocitySource, { label: string; dot: DotState }> = {
  none: { label: '—', dot: 'off' },
  checking: { label: '核對中', dot: 'busy' },
  doppler: { label: '一致', dot: 'ok' },
  unfolded: { label: '已還原折疊', dot: 'ok' },
  rangeRate: { label: '改用距離', dot: 'busy' },
  signFlip: { label: '正負號相反', dot: 'error' },
};

interface Cell {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  dot?: DotState;
}

function RawData() {
  const { telemetry, peak } = useRadar(useShallow((s) => ({ telemetry: s.telemetry, peak: selectEnergyPeak(s) })));
  const has = (telemetry?.rawTargets ?? 0) > 0;
  const speed = telemetry?.rawSpeedMps ?? null;
  const rangeRate = telemetry?.rangeRateMps ?? null;
  const closing = telemetry?.closingMps ?? null;
  const source = telemetry?.velocitySource ?? null;
  const cells: Cell[] = [
    { label: '原始距離', value: has && telemetry?.rawRangeM != null ? telemetry.rawRangeM.toFixed(2) : '—', unit: 'm' },
    {
      label: '原始速度',
      value: speed === null ? '—' : speed.toFixed(2),
      unit: 'm/s',
      hint: speed === null ? undefined : `${mpsToKmh(speed).toFixed(0)} km/h`,
    },
    {
      label: '距離變化率',
      value: rangeRate === null ? '—' : Math.abs(rangeRate).toFixed(2),
      unit: 'm/s',
      hint: rangeRate === null ? undefined : rangeRate >= 0 ? '接近中' : '遠離中',
    },
    {
      label: '速度核對',
      value: source === null ? '—' : VELOCITY_SOURCE[source].label,
      dot: source === null ? undefined : VELOCITY_SOURCE[source].dot,
    },
    { label: '追蹤接近速度', value: closing === null ? '—' : closing.toFixed(2), unit: 'm/s' },
    { label: '目標數', value: telemetry ? String(telemetry.rawTargets) : '—' },
    { label: '反射能量', value: telemetry ? telemetry.energy.toLocaleString() : '—' },
    { label: '10 秒最大能量', value: telemetry ? peak.toLocaleString() : '—' },
    { label: 'ESP32 運作', value: telemetry ? formatDuration(telemetry.uptimeS) : '—' },
  ];
  return (
    <div className="grid grid-cols-3 gap-px bg-line">
      {cells.map(({ label, value, unit, hint, dot }) => (
        <div key={label} className="min-w-0 bg-surface px-3 py-3">
          <div className="truncate text-caption font-semibold text-ink-3">{label}</div>
          <div className="flex items-center gap-1.5 text-title font-bold text-ink">
            {dot && <StatusDot state={dot} />}
            <span className="tabular truncate">
              {value}
              {unit && value !== '—' && <span className="ml-0.5 text-caption font-medium text-ink-2">{unit}</span>}
            </span>
          </div>
          {hint && <div className="truncate text-caption text-ink-3">{hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** 都卜勒正負號與距離變化相反：提示修正「接近方向」，一鍵改好 */
function SignFlipNotice({ sign }: { sign: -1 | 0 | 1 }) {
  const flipped = useRadar((s) => s.telemetry?.velocitySource === 'signFlip');
  if (!flipped || sign === 0) return null;
  const next = (sign === -1 ? 1 : -1) as -1 | 1;
  return (
    <Banner
      tone="warning"
      title="雷達速度的正負號看起來設反了"
      action={
        <Button size="sm" variant="primary" onClick={() => void radarStore.getState().sendCommand({ type: 'approachSign', sign: next })}>
          改成「{signLabel(next)}」
        </Button>
      }
    >
      距離明明在變近，雷達報的速度方向卻相反。ESP32 已自動改用距離變化判斷，修正「接近方向」後速度會更精確。
    </Banner>
  );
}

export function DevicePage() {
  const { status, config, energy, deviceName } = useRadar(
    useShallow((s) => ({
      status: s.connection.status,
      config: s.config,
      energy: s.telemetry?.energy ?? 0,
      deviceName: s.connection.deviceName,
    })),
  );
  const [sheet, setSheet] = useState<SheetState>(null);
  const close = useCallback(() => setSheet(null), []);
  const send = radarStore.getState().sendCommand;

  if (status !== 'connected') {
    return (
      <div className="space-y-4">
        <PageHeader title="裝置" subtitle="ESP32 與雷達的偵測參數" />
        <Section>
          <EmptyState icon={<CpuIcon />} title="尚未連線" description="連線後可以即時查看雷達資料，並調整 ESP32 的 9 項偵測參數。">
            {capabilities.bluetooth ? (
              <Button variant="primary" size="lg" block onClick={() => void actions.connectBluetooth()}>
                <BluetoothIcon />
                連線雷達
              </Button>
            ) : (
              <p className="text-callout text-ink-2">這個瀏覽器不能連藍牙：Android 請用 Chrome，電腦請用 Chrome 或 Edge。</p>
            )}
          </EmptyState>
        </Section>
      </div>
    );
  }

  const subtitle = `${deviceName ?? 'ESP32'}・韌體 ${config?.firmware ?? '讀取中…'}`;

  const tools = (
    <Section title="工具">
      <ListRow icon={<BookIcon />} title="校正步驟" description="第一次使用時照著做" onClick={() => setSheet({ kind: 'guide' })} />
      <ListRow icon={<TerminalIcon />} tone="neutral" title="指令主控台" description="查看收發的文字、手動送指令" onClick={() => setSheet({ kind: 'console' })} />
      <ListRow icon={<RefreshIcon />} tone="neutral" title="重新讀取設定" onClick={() => void send({ type: 'get' })} />
      <ListRow icon={<RefreshIcon />} destructive title="全部恢復預設值" onClick={() => setSheet({ kind: 'defaults' })} />
      <ListRow icon={<ZapIcon />} destructive title="重新啟動 ESP32" onClick={() => setSheet({ kind: 'reboot' })} />
    </Section>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="裝置" subtitle={subtitle} />

      {config && <SignFlipNotice sign={config.approachSign} />}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <Section title="即時雷達資料" action={<HelpButton help={VALUE_HELP.raw} />}>
            <RawData />
          </Section>

          {config && (
            <Section
              title="模式"
              action={<HelpButton help={PARAM_HELP.testMode} />}
              footer="室內測試模式下，接近速度門檻降為 0.1 m/s，走路的人也會觸發；上路前請切回「上路」。"
            >
              <div className="p-3">
                <Segmented
                  label="模式"
                  value={config.testMode ? 'test' : 'road'}
                  onChange={(v) => void send({ type: 'testMode', enabled: v === 'test' })}
                  options={[
                    { value: 'test', label: '室內測試' },
                    { value: 'road', label: '上路' },
                  ]}
                />
              </div>
            </Section>
          )}

          {/* 電腦版：工具放左欄；手機版放在最下面 */}
          <div className="hidden lg:block">{tools}</div>
        </div>

        <div className="flex flex-col gap-6">
          {config ? (
            PARAM_GROUPS.map((group) => (
              <Section key={group.title} title={group.title} footer={group.footer}>
                {group.keys.map((key) => {
                  const { icon, tone } = PARAM_ICON[key];
                  if (key === 'approachSign') {
                    return (
                      <ListRow
                        key={key}
                        icon={icon}
                        tone={tone}
                        title="接近方向"
                        value={signLabel(config.approachSign)}
                        onClick={() => setSheet({ kind: 'param', key })}
                      />
                    );
                  }
                  const spec = NUMERIC_PARAMS[key];
                  const testOverride = key === 'minSpeedMps' && config.testMode;
                  return (
                    <ListRow
                      key={key}
                      icon={icon}
                      tone={tone}
                      title={spec.label}
                      description={testOverride ? '測試模式中暫時使用 0.1 m/s' : undefined}
                      value={spec.format(config[key])}
                      onClick={() => setSheet({ kind: 'param', key })}
                    />
                  );
                })}
              </Section>
            ))
          ) : (
            <Section>
              <ListRow icon={<RefreshIcon />} title="正在讀取 ESP32 的設定…" description="沒有反應時點一下重新讀取" onClick={() => void send({ type: 'get' })} />
            </Section>
          )}

          <div className="lg:hidden">{tools}</div>
        </div>
      </div>

      {sheet?.kind === 'param' && config && sheet.key === 'approachSign' && <SignSheet current={config.approachSign} onClose={close} />}
      {sheet?.kind === 'param' && config && sheet.key !== 'approachSign' && (
        <NumericParamSheet spec={NUMERIC_PARAMS[sheet.key]} current={config[sheet.key]} energy={energy} onClose={close} />
      )}
      {sheet?.kind === 'console' && <ConsoleSheet onClose={close} />}
      {sheet?.kind === 'guide' && <GuideSheet onClose={close} />}
      {sheet?.kind === 'defaults' && (
        <ConfirmSheet
          title="全部恢復預設值？"
          message={`ESP32 的 9 項偵測參數會改回預設：室內測試模式開、接近速度 ${DEFAULT_DEVICE_CONFIG.minSpeedMps} m/s、警示距離 ${DEFAULT_DEVICE_CONFIG.warnRangeM} m、危險到達時間 ${DEFAULT_DEVICE_CONFIG.dangerTtcS} 秒等。`}
          confirmLabel="恢復預設"
          destructive
          onConfirm={() => void send({ type: 'defaults' })}
          onClose={close}
        />
      )}
      {sheet?.kind === 'reboot' && (
        <ConfirmSheet
          title="重新啟動 ESP32？"
          message="約 5 秒後恢復，期間不會偵測來車；網頁會自動重新連線。"
          confirmLabel="重新啟動"
          destructive
          onConfirm={() => void send({ type: 'reboot' })}
          onClose={close}
        />
      )}
    </div>
  );
}
