/**
 * 【騎乘】主畫面（iOS 小工具風格）：警示卡、系統狀態、快速開關；電腦版右側多一張距離趨勢圖。
 * 未連線時顯示引導。
 */
import { useMemo, type ComponentType } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, radarStore, settingsStore, useRadar, useSettings } from '../../../application/container';
import { selectSafety } from '../../../application/selectors';
import { formatDuration } from '../../../domain/units';
import { useNow } from '../../hooks/useNow';
import {
  AlertIcon,
  BluetoothIcon,
  Button,
  CpuIcon,
  FOCUS_RING,
  PageHeader,
  RadarIcon,
  RecordIcon,
  VolumeIcon,
  VolumeOffIcon,
  type DotState,
} from '../../kit';
import { DistanceChart } from '../../widgets/DistanceChart';
import { ConnectPanel } from './ConnectPanel';
import { StatusPanel } from './StatusPanel';

const TRAIL_MS = 2000;

/** 騎乘頁的小工具外框（大圓角白卡） */
const WIDGET = 'rounded-widget bg-surface shadow-card ring-1 ring-line/80';

/** 狀態圖示圓：像 iOS 控制中心，正常 = 綠、處理中 = 黃、異常 = 紅、無資料 = 灰 */
const STATE_CIRCLE: Record<DotState, string> = {
  ok: 'bg-safe text-white',
  busy: 'bg-caution text-white motion-safe:animate-pulse',
  error: 'bg-danger text-white',
  off: 'bg-fill text-ink-3',
};

/** 雷達 / 藍牙 / ESP32 三格狀態 */
function SystemTiles() {
  const { status, radarOnline, uptimeS, stale } = useRadar(
    useShallow((s) => ({
      status: s.connection.status,
      radarOnline: s.telemetry?.radarOnline ?? null,
      uptimeS: s.telemetry?.uptimeS ?? null,
      stale: s.stale,
    })),
  );
  const connected = status === 'connected';
  const radar: [DotState, string] = !connected || radarOnline === null ? ['off', '—'] : radarOnline ? ['ok', '在線'] : ['error', '離線'];
  const link: [DotState, string] = connected
    ? stale
      ? ['error', '資料中斷']
      : ['ok', '已連線']
    : ['busy', status === 'reconnecting' ? '重新連線' : '連線中'];
  const tiles: Array<{ label: string; Icon: ComponentType<{ className?: string }>; state: DotState; value: string }> = [
    { label: '雷達', Icon: RadarIcon, state: radar[0], value: radar[1] },
    { label: '藍牙', Icon: BluetoothIcon, state: link[0], value: link[1] },
    { label: 'ESP32 運作', Icon: CpuIcon, state: uptimeS === null ? 'off' : 'ok', value: uptimeS === null ? '—' : formatDuration(uptimeS) },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map(({ label, Icon, state, value }) => (
        <div key={label} className={`min-w-0 p-3 ${WIDGET}`}>
          <span className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${STATE_CIRCLE[state]}`}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="mt-2.5 truncate text-caption font-semibold text-ink-3">{label}</div>
          <div className="tabular truncate text-body font-semibold text-ink">{value}</div>
        </div>
      ))}
    </div>
  );
}

/** iOS 控制中心式的開關：開啟時圖示圓填滿顏色 */
function Toggle({
  on,
  color,
  Icon,
  title,
  subtitle,
  onClick,
}: {
  on: boolean;
  color: string;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-[4.5rem] min-w-0 items-center gap-3 p-3 text-left transition duration-200 active:scale-[0.97] ${WIDGET} ${FOCUS_RING}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${on ? color : 'bg-fill text-ink-2'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body font-semibold text-ink">{title}</span>
        <span className="block truncate text-caption text-ink-2">{subtitle}</span>
      </span>
    </button>
  );
}

/** 騎車時最常用的兩個開關：聲音、記錄資料 */
function QuickToggles() {
  const sound = useSettings((s) => s.sound);
  const recording = useRadar((s) => s.recording);
  const now = useNow();
  const elapsed = recording.startedAt === null ? 0 : Math.max(0, (now - recording.startedAt) / 1000);

  return (
    <div className="grid grid-cols-2 gap-3">
      <Toggle
        on={sound}
        color="bg-accent text-white"
        Icon={sound ? VolumeIcon : VolumeOffIcon}
        title={sound ? '聲音開啟' : '已靜音'}
        subtitle={sound ? '點一下靜音' : '點一下恢復'}
        onClick={() => settingsStore.getState().update({ sound: !sound })}
      />
      <Toggle
        on={recording.active}
        color="bg-danger text-white"
        Icon={RecordIcon}
        title={recording.active ? `記錄中 ${formatDuration(elapsed)}` : '記錄資料'}
        subtitle={recording.active ? `${recording.rows.toLocaleString()} 筆・點一下停止並下載` : '實車測試時開啟'}
        onClick={() => (recording.active ? actions.stopRecording() : radarStore.getState().startRecording())}
      />
    </div>
  );
}

/** 室內測試模式提醒（iOS 通知樣式） */
function TestModeNotice() {
  return (
    <div role="status" className={`flex items-center gap-3 p-3 ${WIDGET}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-caution text-white">
        <AlertIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">室內測試模式開啟中</p>
        <p className="text-caption text-ink-2">走路的人也會觸發警示，上路前請切換</p>
      </div>
      <Button size="sm" variant="primary" onClick={() => void radarStore.getState().sendCommand({ type: 'testMode', enabled: false })}>
        上路模式
      </Button>
    </div>
  );
}

export function RidePage() {
  const view = useRadar(useShallow(selectSafety));
  const { telemetry, status, stale, warnRangeM, dangerDistM, history, testMode } = useRadar(
    useShallow((s) => ({
      telemetry: s.telemetry,
      status: s.connection.status,
      stale: s.stale,
      warnRangeM: s.config?.warnRangeM ?? 15,
      dangerDistM: s.config?.dangerDistM ?? 4,
      history: s.history,
      testMode: s.config?.testMode === true,
    })),
  );
  const unit = useSettings((s) => s.speedUnit);

  const trail = useMemo(() => {
    const end = telemetry?.receivedAt ?? 0;
    return history.filter((p) => p.t >= end - TRAIL_MS);
  }, [history, telemetry]);

  if (status === 'idle' || status === 'disconnected') return <ConnectPanel />;

  const trusted = status === 'connected' && !stale && telemetry?.radarOnline === true ? telemetry : null;

  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
      <div className="hidden lg:col-span-12 lg:block">
        <PageHeader title="騎乘" subtitle="即時後方來車警示" />
      </div>

      <div className="flex flex-col gap-3 lg:col-span-7">
        <StatusPanel view={view} telemetry={trusted} unit={unit} warnRangeM={warnRangeM} dangerDistM={dangerDistM} trail={trail} />
        {testMode && <TestModeNotice />}
      </div>

      <div className="flex flex-col gap-3 lg:col-span-5">
        <SystemTiles />
        <QuickToggles />

        <div className={`hidden p-4 lg:block ${WIDGET}`}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-body font-semibold text-ink">距離趨勢</h2>
            <span className="text-caption text-ink-3">最近 60 秒・黃色虛線 = 警示距離</span>
          </div>
          <DistanceChart points={history} warnRangeM={warnRangeM} />
        </div>

        {telemetry?.ownSpeedKmh != null && (
          <div className={`px-4 py-3 ${WIDGET}`}>
            <div className="text-caption font-semibold text-ink-3">自身車速（Radar B）</div>
            <div className="tabular font-rounded text-[2.25rem] leading-tight font-semibold tracking-tight text-ink">
              {telemetry.ownSpeedKmh.toFixed(0)} <span className="text-callout font-medium text-ink-2">km/h</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
