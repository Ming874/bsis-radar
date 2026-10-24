/**
 * 【騎乘模式】手機裝在龍頭上時用的全螢幕儀表：只放對地速度（盡量大）、量測狀態與本次行程。
 *
 * - 進入時請瀏覽器全螢幕（Android Chrome、電腦；iPhone 不支援就只是蓋滿畫面），保持螢幕常亮
 * - 超速時整個畫面變紅（白字），眼角餘光就看得到；資料中斷時數字變成「—」並寫出原因
 * - 橫放時數字在左、行程在右
 * - 按「結束」或返回鍵回到速度頁
 */
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { capabilities, uiStore, useOverspeed, useRadar, useSettings, useTrip } from '../../../application/container';
import { describeState } from '../../../application/selectors';
import { averageMps } from '../../../domain/trip';
import { formatClock, formatDistance, formatDuration, formatLimit, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { useNow } from '../../hooks/useNow';
import { MinimizeIcon, StatusDot, cx, haptic, lockScroll } from '../../kit';
import { closeRide } from '../../shell/tabs';

function useFullscreen(): void {
  useEffect(() => {
    uiStore.setState({ ride: true });
    if (capabilities.fullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    }
    // 讓背景的頁面不要跟著捲
    const release = lockScroll();
    return () => {
      uiStore.setState({ ride: false });
      release();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
}

export function RideMode() {
  useFullscreen();
  const unit = useSettings((s) => s.speedUnit);
  const limit = useSettings(useShallow((s) => ({ on: s.speedAlert, kmh: s.speedLimitKmh })));
  const over = useOverspeed((o) => o.active);
  const r = useRadar(
    useShallow((s) => ({
      status: s.connection.status,
      live: s.connection.status === 'connected' && !s.stale && s.telemetry !== null,
      stale: s.stale,
      state: s.telemetry?.state ?? 'noRadar',
      speed: s.telemetry?.speedMps ?? null,
    })),
  );
  const trip = useTrip((s) => s.current);
  const now = useNow();
  const view = describeState(r.state);
  const speed = r.live ? r.speed : null;
  const avg = averageMps(trip);
  const d = formatDistance(trip.distanceM);

  let status: { tone: Parameters<typeof StatusDot>[0]['tone']; label: string };
  if (r.live) status = { tone: view.tone, label: view.label };
  else if (r.stale) status = { tone: 'bad', label: '資料中斷：確認 ESP32 有電、手機不要離太遠' };
  else if (r.status === 'reconnecting' || r.status === 'connecting') status = { tone: 'busy', label: '藍牙重新連線中' };
  else status = { tone: 'idle', label: '未連線：回到速度頁按「連線」' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="騎乘模式"
      className={cx(
        'fixed inset-0 z-[55] flex flex-col pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] transition-colors duration-300',
        over ? 'bg-bad-solid text-white' : 'bg-bg text-ink',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={cx('inline-flex min-w-0 items-center gap-2 text-subhead font-semibold', over ? 'text-white' : 'text-ink')}>
          {!over && <StatusDot tone={status.tone} />}
          <span className="truncate">{over ? '超過速限' : status.label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className={cx('num text-subhead font-semibold', over ? 'text-white/80' : 'text-muted')}>{formatClock(now).slice(0, 5)}</span>
          <button
            type="button"
            onClick={() => {
              haptic();
              closeRide();
            }}
            className={cx('press inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-subhead font-semibold', over ? 'bg-white/20 text-white' : 'bg-surface-2 text-ink')}
          >
            <MinimizeIcon className="h-4 w-4" strokeWidth={2.2} />
            結束
          </button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-stretch justify-center gap-6 landscape:flex-row landscape:items-center">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <span
            aria-live="off"
            className={cx(
              'display text-[min(42vw,34vh)] landscape:text-[min(28vw,52vh)]',
              speed === null ? (over ? 'text-white/60' : 'text-faint') : over ? 'text-white' : r.state === 'holding' ? 'text-muted' : 'text-ink',
            )}
          >
            {formatSpeed(speed, unit)}
          </span>
          <span className={cx('mt-2 text-title font-semibold', over ? 'text-white/85' : 'text-muted')}>
            {speedUnitLabel(unit)}
            {limit.on && <span className="num ml-3 font-medium">· 速限 {formatLimit(limit.kmh, unit)}</span>}
          </span>
        </div>

        <div
          className={cx(
            'grid grid-cols-3 gap-2 rounded-[24px] p-4 landscape:w-[min(38vw,22rem)] landscape:grid-cols-1 landscape:gap-4',
            over ? 'bg-white/15' : 'bg-surface',
          )}
        >
          {[
            { label: '里程', value: d.value, unit: d.unit },
            { label: '移動時間', value: formatDuration(trip.movingS) },
            { label: '平均', value: formatSpeed(avg, unit), unit: avg === null ? undefined : speedUnitLabel(unit) },
          ].map((s) => (
            <div key={s.label} className="min-w-0 text-center landscape:text-left">
              <div className={cx('text-footnote', over ? 'text-white/80' : 'text-muted')}>{s.label}</div>
              <div className="mt-0.5 flex items-baseline justify-center gap-1 landscape:justify-start">
                <span className="num text-[clamp(1.5rem,7vw,2.25rem)] leading-tight font-semibold tracking-tight">{s.value}</span>
                {s.unit && <span className={cx('text-footnote', over ? 'text-white/80' : 'text-muted')}>{s.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
