/**
 * 【速度】主畫面：對地速度（大字）、量測狀態、本次行程、速度趨勢圖。
 * 騎車時手機裝在龍頭上：最重要的數字最大、其他資訊安靜地放在下面。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, useRadar, useSettings, useTrip } from '../../../application/container';
import { SPEED_WINDOW_MS } from '../../../application/radarStore';
import { STEADY_ACCEL, describeState, recentAccel } from '../../../application/selectors';
import { unambiguousGroundMps } from '../../../domain/protocol';
import { averageMps } from '../../../domain/trip';
import { DASH, formatDistance, formatDuration, formatPercent, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { ConfirmDialog, KeyValue, PageHeader, Panel, Stat, StatusLabel, TONE_TEXT } from '../../kit';
import { SpeedChart } from '../../widgets/SpeedChart';
import { ConnectPanel } from '../common/ConnectPanel';
import { DeviceNotices } from '../common/DeviceNotices';

/** 訊號品質：最近 20 筆資料框中可用量測的比例，四格顯示 */
function QualityBars({ pct }: { pct: number }) {
  const level = pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : pct > 0 ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-2 text-label text-muted" title={`最近 20 筆資料框中 ${pct}% 可用`}>
      <span aria-hidden className="flex h-3 items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`w-[3px] rounded-[1px] ${i <= level ? 'bg-fg' : 'bg-line-strong'}`} style={{ height: `${25 * i}%` }} />
        ))}
      </span>
      <span className="tabular">訊號 {pct}%</span>
    </span>
  );
}

function SpeedReadout() {
  const unit = useSettings((s) => s.speedUnit);
  const t = useRadar(
    useShallow((r) => ({
      connected: r.connection.status === 'connected' && !r.stale && r.telemetry !== null,
      state: r.telemetry?.state ?? 'noRadar',
      speed: r.telemetry?.speedMps ?? null,
      sigma: r.telemetry?.sigmaMps ?? 0,
      quality: r.telemetry?.qualityPct ?? 0,
      wheel: r.telemetry?.wheelMps ?? null,
      accel: recentAccel(r.speedHistory),
    })),
  );
  const view = describeState(t.state);
  const steady = t.accel !== null && Math.abs(t.accel) <= STEADY_ACCEL;
  const speed = t.connected ? t.speed : null;
  const dim = t.state === 'holding' || t.state === 'acquiring';
  const comparable = speed !== null && t.wheel !== null && t.wheel >= 2 && t.state === 'tracking';
  const diffPct = comparable && steady && t.wheel !== null && speed !== null ? ((speed - t.wheel) / t.wheel) * 100 : null;

  return (
    <Panel className="lg:row-span-2" bodyClassName="flex flex-col">
      <div className="flex items-center justify-between gap-3">
        {t.connected ? <StatusLabel tone={view.tone}>{view.label}</StatusLabel> : <StatusLabel tone="idle">未連線</StatusLabel>}
        {t.connected && (t.state === 'tracking' || t.state === 'holding') && <QualityBars pct={t.quality} />}
      </div>

      <div className="flex flex-1 items-center justify-center py-8 lg:py-10">
        <div className="flex items-baseline gap-3">
          <span
            aria-live="off"
            className={`tabular text-[clamp(5.5rem,26vw,10rem)] leading-none font-semibold tracking-tighter ${speed === null ? 'text-subtle' : dim ? 'text-muted' : 'text-fg'}`}
          >
            {formatSpeed(speed, unit)}
          </span>
          <span className="text-value font-medium text-muted">{speedUnitLabel(unit)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Stat label="不確定度（1σ）" value={speed !== null && t.sigma > 0 ? `±${formatSpeed(t.sigma, unit)}` : DASH} unit={speedUnitLabel(unit)} muted={speed === null} />
        <Stat label="輪速（參考）" value={t.connected ? formatSpeed(t.wheel, unit) : DASH} unit={t.wheel !== null ? speedUnitLabel(unit) : undefined} muted={t.wheel === null} />
        <Stat label="雷達 − 輪速" value={comparable && !steady ? '變速中' : formatPercent(diffPct)} muted={diffPct === null} />
      </div>
      {t.connected && view.detail && <p className={`mt-3 text-label ${TONE_TEXT[view.tone]}`}>{view.detail}</p>}
    </Panel>
  );
}

function TripPanel() {
  const unit = useSettings((s) => s.speedUnit);
  const trip = useTrip((s) => s.current);
  const [confirm, setConfirm] = useState(false);
  const distance = formatDistance(trip.distanceM);
  const avg = averageMps(trip);
  return (
    <Panel
      title="本次行程"
      actions={
        <button type="button" onClick={() => setConfirm(true)} className="rounded-md px-2 py-1 text-label text-muted hover:bg-hover hover:text-fg">
          結束並開始新的行程
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
        <Stat label="里程" value={distance.value} unit={distance.unit} />
        <Stat label="移動時間" value={formatDuration(trip.movingS)} />
        <Stat label="平均速度" value={formatSpeed(avg, unit)} unit={avg === null ? undefined : speedUnitLabel(unit)} muted={avg === null} />
        <Stat label="最高速度" value={trip.maxMps > 0 ? formatSpeed(trip.maxMps, unit) : DASH} unit={trip.maxMps > 0 ? speedUnitLabel(unit) : undefined} muted={trip.maxMps === 0} />
      </div>
      {confirm && (
        <ConfirmDialog
          title="結束本次行程"
          message="超過 50 m 的行程會存進「數據 → 行程紀錄」，接著從 0 開始累計。"
          confirmLabel="結束行程"
          onConfirm={actions.finishTrip}
          onClose={() => setConfirm(false)}
        />
      )}
    </Panel>
  );
}

function ChartPanel() {
  const unit = useSettings((s) => s.speedUnit);
  const points = useRadar((r) => r.speedHistory);
  return (
    <Panel title="速度趨勢" description="最近 2 分鐘">
      <SpeedChart points={points} unit={unit} windowMs={SPEED_WINDOW_MS} />
    </Panel>
  );
}

/** 電腦版右側：量測狀態一覽 */
function MeasurementPanel() {
  const s = useRadar(
    useShallow((r) => ({
      frameRate: r.frameRateHz,
      distance: r.telemetry?.radarDistanceM ?? null,
      model: r.config?.model ?? null,
      cal: r.config?.calibration ?? null,
      angle: r.config?.angleDeg ?? null,
      height: r.config?.heightM ?? null,
      firmware: r.config?.firmware ?? null,
      vmax: r.config?.radialLimitMps ?? null,
    })),
  );
  const odo = formatDistance(s.distance);
  const unfoldKmh = s.vmax !== null && s.angle !== null && s.cal !== null ? unambiguousGroundMps(s.vmax, s.angle, s.cal) * 3.6 : null;
  return (
    <Panel title="量測設定" flush className="hidden lg:block">
      <KeyValue
        dense
        rows={[
          { label: '速度模型', value: s.model === null ? DASH : s.model === 'fixedAngle' ? '固定角度' : '距離幾何' },
          { label: '安裝角度 / 高度', value: s.angle === null || s.height === null ? DASH : `${s.angle.toFixed(1)}° / ${s.height.toFixed(2)} m` },
          { label: '校正係數 CAL', value: s.cal === null ? DASH : s.cal.toFixed(4) },
          { label: '不折疊的最高速度', hint: 'CAL × VMAX ÷ cos θ', value: unfoldKmh === null ? DASH : unfoldKmh.toFixed(1), unit: unfoldKmh === null ? undefined : 'km/h' },
          { label: '雷達資料框', value: s.frameRate === null ? DASH : s.frameRate.toFixed(1), unit: s.frameRate === null ? undefined : 'Hz' },
          { label: '雷達里程（開機起）', value: odo.value, unit: s.distance === null ? undefined : odo.unit },
          { label: '韌體', value: s.firmware ? `v${s.firmware}` : DASH },
        ]}
      />
    </Panel>
  );
}

export function SpeedPage() {
  const connected = useRadar((r) => r.connection.status === 'connected');
  return (
    <>
      <PageHeader title="速度" description="C4001 毫米波雷達斜照路面量測的對地速度" />
      <DeviceNotices />
      {!connected && (
        <div className="mb-4">
          <ConnectPanel />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <SpeedReadout />
        <TripPanel />
        <ChartPanel />
        <MeasurementPanel />
      </div>
    </>
  );
}
