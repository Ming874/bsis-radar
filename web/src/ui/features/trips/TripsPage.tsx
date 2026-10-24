/**
 * 【行程】本次行程（即時速度曲線）、累計、行程紀錄（依日期分組）、行程詳情（速度曲線、輪速比對）、匯出。
 * 行程存在這支手機的瀏覽器裡（最多 200 筆）；換手機前用「設定 → 備份」匯出。
 */
import { useMemo, useState } from 'react';
import { actions, tripStore, useSettings, useTrip } from '../../../application/container';
import { averageMps, summarizeTrips, type SavedTrip } from '../../../domain/trip';
import {
  DASH,
  formatDistance,
  formatDuration,
  formatDurationWords,
  formatHm,
  formatDayLabel,
  formatPercent,
  formatSpeed,
  kmhToMps,
  speedUnitLabel,
  type SpeedUnit,
} from '../../../domain/units';
import { useNow } from '../../hooks/useNow';
import { Button, Card, ConfirmSheet, DownloadIcon, EmptyState, IconButton, ListGroup, RouteIcon, Row, Sheet, Stat, TrashIcon } from '../../kit';
import { PageHeader } from '../../shell/PageHeader';
import { goTab } from '../../shell/tabs';
import { TraceChart } from '../../widgets/TraceChart';

function CurrentTrip() {
  const unit = useSettings((s) => s.speedUnit);
  const trip = useTrip((s) => s.current);
  const trace = useTrip((s) => s.trace);
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const empty = trip.distanceM <= 0 && trip.movingS <= 0;
  const d = formatDistance(trip.distanceM);
  const avg = averageMps(trip);
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-headline font-semibold text-ink">本次行程</h2>
        <span className="num text-footnote text-muted">{empty ? '還沒開始' : `${formatHm(trip.startedAt)} 開始 · ${formatDurationWords((now - trip.startedAt) / 1000)}`}</span>
      </div>
      {empty ? (
        <p className="mt-2 text-footnote text-muted">連線後開始騎，里程、時間與速度曲線會即時記在這裡。</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="里程" value={d.value} unit={d.unit} size="sm" />
            <Stat label="移動時間" value={formatDuration(trip.movingS)} size="sm" />
            <Stat label="平均" value={formatSpeed(avg, unit)} unit={avg === null ? undefined : speedUnitLabel(unit)} size="sm" muted={avg === null} />
          </div>
          {trace.v.length >= 10 && (
            <div className="mt-4">
              <TraceChart trace={trace} unit={unit} avgMps={avg} height={150} />
            </div>
          )}
          <Button className="mt-4" block onClick={() => setConfirm(true)}>
            結束並儲存
          </Button>
        </>
      )}
      <ConfirmSheet
        open={confirm}
        title="結束本次行程"
        message="超過 50 m 的行程會存進下面的紀錄，接著從 0 開始累計。"
        confirmLabel="結束並儲存"
        onConfirm={actions.finishTrip}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}

function Totals({ trips, unit }: { trips: SavedTrip[]; unit: SpeedUnit }) {
  const t = summarizeTrips(trips);
  const total = formatDistance(t.distanceM);
  return (
    <Card className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 sm:grid-cols-4">
      <Stat label={`累計里程（${t.count} 趟）`} value={total.value} unit={total.unit} />
      <Stat label="騎乘時間" value={formatDuration(t.movingS)} />
      <Stat label="平均速度" value={formatSpeed(t.avgMps, unit)} unit={t.avgMps === null ? undefined : speedUnitLabel(unit)} muted={t.avgMps === null} />
      <Stat label="最高速度" value={t.maxMps > 0 ? formatSpeed(t.maxMps, unit) : DASH} unit={t.maxMps > 0 ? speedUnitLabel(unit) : undefined} />
    </Card>
  );
}

function tripSummary(t: SavedTrip, unit: SpeedUnit): string {
  const avg = averageMps(t);
  const parts = [formatDurationWords(t.movingS)];
  if (avg !== null) parts.push(`平均 ${formatSpeed(avg, unit)} ${speedUnitLabel(unit)}`);
  if (t.overspeedCount) parts.push(`超速 ${t.overspeedCount} 次`);
  return parts.join(' · ');
}

function TripDetail({ trip, unit, onClose }: { trip: SavedTrip | null; unit: SpeedUnit; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  // 關閉動畫期間還要畫得出上一筆
  const [last, setLast] = useState(trip);
  if (trip && trip !== last) setLast(trip);
  const now = useNow();
  const t = trip ?? last;
  if (!t) return null;
  const d = formatDistance(t.distanceM);
  const avg = averageMps(t);
  const wheelDiff = t.wheelDistanceM !== null && t.wheelDistanceM >= 50 ? ((t.distanceM - t.wheelDistanceM) / t.wheelDistanceM) * 100 : null;
  const wheel = formatDistance(t.wheelDistanceM);

  return (
    <Sheet
      open={trip !== null}
      onClose={onClose}
      wide
      title={`${formatDayLabel(t.startedAt, now)} ${formatHm(t.startedAt)}–${formatHm(t.endedAt)}`}
      description={`總時間 ${formatDurationWords((t.endedAt - t.startedAt) / 1000)}`}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" icon={DownloadIcon} disabled={!t.trace} onClick={() => actions.exportTraceCsv(t)}>
            匯出 CSV
          </Button>
          <Button variant="danger" className="flex-1" icon={TrashIcon} onClick={() => setConfirm(true)}>
            刪除
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat label="里程" value={d.value} unit={d.unit} />
        <Stat label="移動時間" value={formatDuration(t.movingS)} />
        <Stat label="平均速度" value={formatSpeed(avg, unit)} unit={avg === null ? undefined : speedUnitLabel(unit)} muted={avg === null} />
        <Stat label="最高速度" value={formatSpeed(t.maxMps, unit)} unit={speedUnitLabel(unit)} />
      </div>
      <div className="mt-5">
        {t.trace && t.trace.v.length > 1 ? (
          <TraceChart trace={t.trace} unit={unit} avgMps={avg} limitMps={t.limitKmh ? kmhToMps(t.limitKmh) : null} />
        ) : (
          <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-footnote text-muted">這筆行程沒有速度曲線（網頁 3.0 以前存的紀錄）</p>
        )}
      </div>
      <div className="card mt-5 overflow-hidden bg-surface-2 shadow-none [&>*+*]:border-t [&>*+*]:border-line">
        <Row
          label="超速"
          value={t.overspeedCount === undefined ? '沒有紀錄' : t.overspeedCount === 0 ? '未超過速限' : `${t.overspeedCount} 次，共 ${formatDuration(t.overspeedS ?? 0)}`}
          detail={t.limitKmh ? `速限 ${t.limitKmh} km/h` : t.limitKmh === null ? '當時沒開超速警示' : undefined}
        />
        <Row label="輪速感測器里程" value={t.wheelDistanceM === null ? '沒有接' : `${wheel.value} ${wheel.unit}`} detail={wheelDiff === null ? undefined : `雷達相對輪速 ${formatPercent(wheelDiff, 1)}`} />
      </div>
      <ConfirmSheet
        open={confirm}
        title="刪除這筆行程"
        message="刪除後無法復原。"
        confirmLabel="刪除"
        destructive
        onConfirm={() => {
          tripStore.getState().deleteTrip(t.id);
          onClose();
        }}
        onClose={() => setConfirm(false)}
      />
    </Sheet>
  );
}

/** 依開始日期分組（由新到舊） */
function groupByDay(trips: SavedTrip[], now: number): Array<{ label: string; trips: SavedTrip[] }> {
  const groups: Array<{ label: string; trips: SavedTrip[] }> = [];
  for (const t of trips) {
    const label = formatDayLabel(t.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.trips.push(t);
    else groups.push({ label, trips: [t] });
  }
  return groups;
}

export function TripsPage() {
  const unit = useSettings((s) => s.speedUnit);
  const trips = useTrip((s) => s.trips);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // 日期標題（今天、昨天）跟著時間走：每分鐘重算一次就夠
  const minute = Math.floor(useNow() / 60_000);
  const groups = useMemo(() => groupByDay(trips, minute * 60_000), [trips, minute]);
  const opened = trips.find((t) => t.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="行程"
        description="每次結束行程都會存在這支手機上，含速度曲線"
        actions={trips.length > 0 && <IconButton icon={DownloadIcon} label="匯出全部行程（CSV）" variant="surface" onClick={actions.exportTripsCsv} />}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="grid gap-4">
          <CurrentTrip />
          {trips.length > 0 && <Totals trips={trips} unit={unit} />}
        </div>
        <div className="grid gap-5">
          {trips.length === 0 ? (
            <Card>
              <EmptyState
                icon={RouteIcon}
                title="還沒有行程紀錄"
                action={
                  <Button variant="tinted" onClick={() => goTab('speed')}>
                    到速度頁
                  </Button>
                }
              >
                在「速度」頁或上面按「結束並儲存」後，超過 50 m 的行程會列在這裡。
              </EmptyState>
            </Card>
          ) : (
            groups.map((g) => (
              <ListGroup key={g.label} title={g.label}>
                {g.trips.map((t) => {
                  const d = formatDistance(t.distanceM);
                  return (
                    <Row
                      key={t.id}
                      label={<span className="num">{`${formatHm(t.startedAt)}–${formatHm(t.endedAt)}`}</span>}
                      detail={tripSummary(t, unit)}
                      value={<span className="font-semibold text-ink">{`${d.value} ${d.unit}`}</span>}
                      chevron
                      onClick={() => setOpenId(t.id)}
                    />
                  );
                })}
              </ListGroup>
            ))
          )}
          {trips.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button size="sm" variant="plain" icon={DownloadIcon} onClick={actions.exportTripsCsv}>
                匯出全部（CSV）
              </Button>
              <Button size="sm" variant="plain" className="text-bad hover:bg-[color-mix(in_srgb,var(--bad)_10%,transparent)]" onClick={() => setConfirmClear(true)}>
                全部清除
              </Button>
            </div>
          )}
        </div>
      </div>
      <TripDetail trip={opened} unit={unit} onClose={() => setOpenId(null)} />
      <ConfirmSheet
        open={confirmClear}
        title="清除行程紀錄"
        message={`這支手機上的 ${trips.length} 筆行程紀錄都會刪除，無法復原。需要的話先到「設定 → 備份」匯出。`}
        confirmLabel="全部清除"
        destructive
        onConfirm={() => tripStore.getState().clearTrips()}
        onClose={() => setConfirmClear(false)}
      />
    </>
  );
}
