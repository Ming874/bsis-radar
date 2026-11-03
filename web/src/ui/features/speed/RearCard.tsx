/**
 * 【速度】後方來車卡片：主要來車的距離（大字）、接近速度、到達時間、後車車速（兩顆雷達整合），以及俯視圖。
 * 注意時外框變黃、危險時變紅。資料中斷或後方雷達離線時不顯示「安全」。
 */
import { useShallow } from 'zustand/react/shallow';
import { useRadar, useSettings, useTrip } from '../../../application/container';
import { describeRear } from '../../../application/selectors';
import { DEFAULT_REAR_CONFIG, rearDetectRange } from '../../../domain/protocol';
import { vehicleSpeedMps } from '../../../domain/rear';
import { DASH, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { Badge, Card, Stat, StatusLabel, TONE_TEXT, cx } from '../../kit';
import { RearRadarView } from '../../widgets/RearRadar';

export function RearCard() {
  const unit = useSettings((s) => s.speedUnit);
  const mirror = useSettings((s) => s.rearMirror);
  const s = useRadar(useShallow((r) => ({ connection: r.connection, rear: r.rear, rearStale: r.rearStale, config: r.config })));
  // 自己的對地速度：只用追蹤中的值（後車車速 = 自己 + 接近速度）
  const own = useRadar((r) => (r.telemetry && !r.stale && r.telemetry.state === 'tracking' ? r.telemetry.speedMps : null));
  const tripAlerts = useTrip((t) => t.current.rearAlerts);
  const view = describeRear(s);
  const rear = view.live ? s.rear : null;
  const cfg = s.config?.rear ?? { ...DEFAULT_REAR_CONFIG, detectRangeM: rearDetectRange(DEFAULT_REAR_CONFIG.rangeM) };
  const level = rear?.level ?? 'safe';
  const distance = rear?.distanceM ?? null;
  const closing = rear?.closingMps ?? null;
  const vehicle = vehicleSpeedMps(own, closing);
  const color = level === 'danger' ? 'text-bad' : level === 'caution' ? 'text-warn' : 'text-ink';

  let subtitle: string;
  if (!rear) subtitle = view.detail ?? '連線後顯示後方來車';
  else if (distance !== null && closing !== null) {
    subtitle = `接近 ${formatSpeed(closing, unit, unit === 'kmh' ? 0 : 1)} ${speedUnitLabel(unit)}${rear.ttcS !== null ? ` · ${rear.ttcS.toFixed(1)} 秒後到達` : ''}`;
  } else if (rear.holding) subtitle = '來車正在旁邊超車，警示保持中';
  else subtitle = `後方 ${cfg.detectRangeM} m 內沒有接近的車`;

  return (
    <Card id="rear-card" tone={level === 'danger' ? 'bad' : level === 'caution' ? 'warn' : undefined} className="scroll-mt-4 p-5">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-headline font-semibold text-ink">後方來車</h2>
        <span className="flex min-w-0 items-center gap-2">
          {rear?.receiveOnly && <Badge>只接收</Badge>}
          <StatusLabel tone={view.tone} className="truncate">
            {view.label}
          </StatusLabel>
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_118px] items-stretch gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex items-baseline gap-1.5" aria-live="off">
            <span className={cx('display text-[clamp(3.5rem,17vw,5.5rem)]', distance === null ? 'text-faint' : color)}>{distance === null ? DASH : Math.round(distance)}</span>
            <span className={cx('text-headline font-semibold', distance === null ? 'text-faint' : 'text-muted')}>m</span>
          </div>
          <p aria-live="polite" className={cx('mt-1 min-h-[2.25rem] text-footnote', level === 'safe' ? 'text-muted' : cx('font-semibold', color))}>
            {subtitle}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <Stat
              size="sm"
              label="後車車速"
              value={vehicle === null ? DASH : formatSpeed(vehicle, unit, unit === 'kmh' ? 0 : 1)}
              unit={vehicle === null ? undefined : speedUnitLabel(unit)}
              muted={vehicle === null}
              sub={closing !== null && vehicle === null ? '要量得到自己的車速' : undefined}
            />
            <Stat size="sm" label="本次行程警示" value={String(tripAlerts)} unit="次" muted={tripAlerts === 0} />
          </div>
        </div>
        <div className="h-[230px] rounded-[14px] bg-surface-2 p-1.5">
          <RearRadarView
            data={rear ? { level: rear.level, distanceM: rear.distanceM, targets: rear.targets } : null}
            rangeM={cfg.rangeM}
            detectRangeM={cfg.detectRangeM}
            mirror={mirror}
            message={view.live ? undefined : view.label}
          />
        </div>
      </div>
      {view.live && view.detail && <p className={cx('mt-3 text-footnote', TONE_TEXT[view.tone])}>{view.detail}</p>}
    </Card>
  );
}
