/**
 * 【速度】主畫面：對地速度（大字）、量測狀態、超速警示、騎乘模式、本次行程、速度趨勢圖。
 * 騎車時手機裝在龍頭上：最重要的數字最大、其他資訊安靜地放在下面。超速時數字與外框變紅。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, settingsStore, useOverspeed, useRadar, useSettings, useTrip } from '../../../application/container';
import { SPEED_WINDOW_MS } from '../../../application/radarStore';
import { STEADY_ACCEL, describeState, recentAccel } from '../../../application/selectors';
import { SPEED_LIMIT_KMH } from '../../../domain/overspeed';
import { unambiguousGroundMps } from '../../../domain/protocol';
import { averageMps } from '../../../domain/trip';
import { DASH, formatDistance, formatDuration, formatDurationWords, formatHm, formatLimit, formatPercent, formatSpeed, kmhToMps, speedUnitLabel } from '../../../domain/units';
import { DESKTOP, useMediaQuery } from '../../hooks/useMediaQuery';
import { useNow } from '../../hooks/useNow';
import {
  BellIcon,
  Button,
  Card,
  ConfirmSheet,
  KeyValue,
  MaximizeIcon,
  Row,
  Sheet,
  SignalBars,
  Stat,
  StatusLabel,
  Stepper,
  Switch,
  TONE_TEXT,
  cx,
} from '../../kit';
import { PageHeader } from '../../shell/PageHeader';
import { openRide } from '../../shell/tabs';
import { SpeedChart } from '../../widgets/SpeedChart';
import { ConnectPanel } from '../common/ConnectPanel';
import { DeviceNotices } from '../common/DeviceNotices';

function SpeedHero() {
  const unit = useSettings((s) => s.speedUnit);
  const limit = useSettings(useShallow((s) => ({ on: s.speedAlert, kmh: s.speedLimitKmh })));
  const over = useOverspeed((o) => o.active);
  const t = useRadar(
    useShallow((r) => ({
      connected: r.connection.status === 'connected',
      live: r.connection.status === 'connected' && !r.stale && r.telemetry !== null,
      stale: r.stale,
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
  const speed = t.live ? t.speed : null;
  const dim = t.state === 'holding' || t.state === 'acquiring';
  const comparable = speed !== null && t.wheel !== null && t.wheel >= 2 && t.state === 'tracking';
  const diffPct = comparable && steady && t.wheel !== null && speed !== null ? ((speed - t.wheel) / t.wheel) * 100 : null;

  return (
    <Card alert={over} className="flex flex-col p-5">
      <div className="flex min-h-6 items-center justify-between gap-3">
        {t.live ? (
          <StatusLabel tone={view.tone}>{view.label}</StatusLabel>
        ) : (
          <StatusLabel tone={t.stale ? 'bad' : 'idle'}>{t.stale ? '資料中斷' : t.connected ? '等待資料' : '未連線'}</StatusLabel>
        )}
        {t.live && (t.state === 'tracking' || t.state === 'holding') && <SignalBars pct={t.quality} />}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-7 lg:py-12">
        <div className="flex items-baseline gap-2">
          <span
            aria-live="off"
            className={cx('display text-[clamp(5.5rem,30vw,10.5rem)]', speed === null ? 'text-faint' : over ? 'text-bad' : dim ? 'text-muted' : 'text-ink')}
          >
            {formatSpeed(speed, unit)}
          </span>
          <span className={cx('text-headline font-semibold', over ? 'text-bad' : 'text-muted')}>{speedUnitLabel(unit)}</span>
        </div>
        {limit.on && (
          // 固定高度：超速與否切換時版面不跳動
          <p aria-live="polite" className={cx('num h-6 leading-6', over ? 'text-headline font-bold text-bad' : 'text-footnote text-muted')}>
            {over ? '超過速限' : '速限'} {formatLimit(limit.kmh, unit)} {speedUnitLabel(unit)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Stat label="不確定度 1σ" value={speed !== null && t.sigma > 0 ? `±${formatSpeed(t.sigma, unit)}` : DASH} muted={speed === null} size="sm" />
        <Stat label="輪速（參考）" value={t.live ? formatSpeed(t.wheel, unit) : DASH} muted={t.wheel === null} size="sm" />
        <Stat label="雷達 − 輪速" value={comparable && !steady ? '變速中' : formatPercent(diffPct)} muted={diffPct === null} size="sm" />
      </div>
      {t.live && view.detail && <p className={cx('mt-3 text-footnote', TONE_TEXT[view.tone])}>{view.detail}</p>}
    </Card>
  );
}

/** 速限的快速設定：不用跑到設定頁 */
function LimitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings(useShallow((x) => ({ on: x.speedAlert, kmh: x.speedLimitKmh, sound: x.alertSound, vibrate: x.alertVibrate })));
  const update = settingsStore.getState().update;
  return (
    <Sheet open={open} onClose={onClose} title="超速警示" description="對地速度持續 0.5 秒達到速限時，數字與外框變紅並提示">
      <div className="card -mx-1 overflow-hidden bg-surface-2 shadow-none [&>*+*]:border-t [&>*+*]:border-line">
        <Row label="超速警示">
          <Switch label="超速警示" checked={s.on} onChange={(speedAlert) => update({ speedAlert })} />
        </Row>
        <Row label="速限" detail="台灣電動輔助自行車的上限是 25 km/h">
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
        <Row label="提示音">
          <Switch label="提示音" checked={s.sound} disabled={!s.on} onChange={(alertSound) => update({ alertSound })} />
        </Row>
        <Row label="震動">
          <Switch label="震動" checked={s.vibrate} disabled={!s.on} onChange={(alertVibrate) => update({ alertVibrate })} />
        </Row>
      </div>
      <Button className="mt-4" block size="lg" disabled={!s.on || (!s.sound && !s.vibrate)} onClick={() => void actions.previewAlert()}>
        測試提示
      </Button>
      <p className="mt-3 px-1 text-footnote text-muted">靜音或媒體音量為 0 時不會響。更多說明在「設定 → 超速警示」。</p>
    </Sheet>
  );
}

function QuickActions() {
  const limit = useSettings(useShallow((s) => ({ on: s.speedAlert, kmh: s.speedLimitKmh, unit: s.speedUnit })));
  const [open, setOpen] = useState(false);
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Button variant="tinted" size="lg" icon={MaximizeIcon} onClick={openRide}>
        騎乘模式
      </Button>
      <Button size="lg" icon={BellIcon} onClick={() => setOpen(true)} className={cx(!limit.on && 'text-muted')}>
        {limit.on ? `速限 ${formatLimit(limit.kmh, limit.unit)} ${speedUnitLabel(limit.unit)}` : '警示關閉'}
      </Button>
      <LimitSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function TripCard() {
  const unit = useSettings((s) => s.speedUnit);
  const alertOn = useSettings((s) => s.speedAlert);
  const trip = useTrip((s) => s.current);
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const distance = formatDistance(trip.distanceM);
  const avg = averageMps(trip);
  const empty = trip.distanceM <= 0 && trip.movingS <= 0;
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-headline font-semibold text-ink">本次行程</h2>
        <span className="num text-footnote text-muted">{empty ? '還沒開始' : `${formatHm(trip.startedAt)} 開始 · ${formatDurationWords((now - trip.startedAt) / 1000)}`}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat label="里程" value={distance.value} unit={distance.unit} muted={empty} />
        <Stat label="移動時間" value={formatDuration(trip.movingS)} muted={empty} />
        <Stat label="平均速度" value={formatSpeed(avg, unit)} unit={avg === null ? undefined : speedUnitLabel(unit)} muted={avg === null} />
        <Stat
          label="最高速度"
          value={trip.maxMps > 0 ? formatSpeed(trip.maxMps, unit) : DASH}
          unit={trip.maxMps > 0 ? speedUnitLabel(unit) : undefined}
          muted={trip.maxMps === 0}
          sub={alertOn && !empty ? (trip.overspeedCount === 0 ? '未超過速限' : `超速 ${trip.overspeedCount} 次，共 ${formatDuration(trip.overspeedS)}`) : undefined}
        />
      </div>
      <Button className="mt-5" block disabled={empty} onClick={() => setConfirm(true)}>
        結束並儲存行程
      </Button>
      <ConfirmSheet
        open={confirm}
        title="結束本次行程"
        message="超過 50 m 的行程會存進「行程」頁（含速度曲線），接著從 0 開始累計。"
        confirmLabel="結束並儲存"
        onConfirm={actions.finishTrip}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}

function ChartCard() {
  const unit = useSettings((s) => s.speedUnit);
  const limitMps = useSettings((s) => (s.speedAlert ? kmhToMps(s.speedLimitKmh) : null));
  const points = useRadar((r) => r.speedHistory);
  return (
    <Card className="p-5 pb-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-headline font-semibold text-ink">速度趨勢</h2>
        <span className="text-footnote text-muted">最近 2 分鐘</span>
      </div>
      <SpeedChart points={points} unit={unit} windowMs={SPEED_WINDOW_MS} limitMps={limitMps} />
    </Card>
  );
}

/** 電腦版右側：量測設定一覽 */
function MeasurementCard() {
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
    <Card className="hidden overflow-hidden lg:block">
      <h2 className="px-4 pt-4 pb-2 text-headline font-semibold text-ink">量測設定</h2>
      <KeyValue
        dense
        rows={[
          { label: '速度模型', value: s.model === null ? DASH : <span className="font-sans">{s.model === 'fixedAngle' ? '固定角度' : '距離幾何'}</span> },
          { label: '安裝角度 / 高度', value: s.angle === null || s.height === null ? DASH : `${s.angle.toFixed(1)}° / ${s.height.toFixed(2)} m` },
          { label: '校正係數 CAL', value: s.cal === null ? DASH : s.cal.toFixed(4) },
          { label: '不折疊的最高速度', hint: 'CAL × VMAX ÷ cos θ', value: unfoldKmh === null ? DASH : unfoldKmh.toFixed(1), unit: unfoldKmh === null ? undefined : 'km/h' },
          { label: '雷達資料框', value: s.frameRate === null ? DASH : s.frameRate.toFixed(1), unit: s.frameRate === null ? undefined : 'Hz' },
          { label: '雷達里程（開機起）', value: odo.value, unit: s.distance === null ? undefined : odo.unit },
          { label: '韌體', value: s.firmware ? `v${s.firmware}` : DASH },
        ]}
      />
    </Card>
  );
}

export function SpeedPage() {
  const connected = useRadar((r) => r.connection.status === 'connected');
  // 電腦版兩欄：左邊速度＋趨勢圖、右邊行程＋量測設定；手機一欄：速度 → 行程 → 趨勢圖
  const desktop = useMediaQuery(DESKTOP);
  return (
    <>
      <PageHeader title="速度" description="C4001 毫米波雷達斜照路面量測的對地速度" />
      <DeviceNotices />
      {!connected && (
        <div className="mb-4">
          <ConnectPanel />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-3 lg:gap-4">
          <SpeedHero />
          <QuickActions />
          {desktop && <ChartCard />}
        </div>
        <div className="grid gap-4">
          <TripCard />
          {!desktop && <ChartCard />}
          <MeasurementCard />
        </div>
      </div>
    </>
  );
}
