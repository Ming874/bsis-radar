/**
 * 【數據】診斷與記錄：即時資料框、距離 × 徑向速度散佈圖、判斷統計、CSV 記錄、行程紀錄、指令主控台。
 */
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, radarStore, tripStore, useRadar, useSettings, useTrip } from '../../../application/container';
import { VERDICT_LABEL, verdictBreakdown } from '../../../application/selectors';
import { averageMps } from '../../../domain/trip';
import { DASH, formatClock, formatDateTime, formatDistance, formatDuration, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  ConfirmDialog,
  DownloadIcon,
  EmptyState,
  IconButton,
  KeyValue,
  PageHeader,
  Panel,
  RecordIcon,
  SendIcon,
  StatusDot,
  TrashIcon,
} from '../../kit';
import { ScatterPlot } from '../../widgets/ScatterPlot';

function FramePanel() {
  const unit = useSettings((s) => s.speedUnit);
  const s = useRadar(useShallow((r) => ({ t: r.telemetry, rate: r.frameRateHz })));
  const t = s.t;
  const odo = formatDistance(t?.radarDistanceM ?? null);
  const wheelOdo = formatDistance(t?.wheelDistanceM ?? null);
  return (
    <Panel title="即時資料框" description="C4001 每 0.1 秒一筆；以下為最新一筆與估計器狀態" flush>
      <KeyValue
        dense
        rows={[
          { label: '資料框', value: t ? `#${t.frame}` : DASH, hint: s.rate === null ? undefined : `${s.rate.toFixed(1)} Hz` },
          { label: '目標數 N', value: t ? t.targets : DASH },
          { label: '距離 RD', value: t?.rangeM?.toFixed(2) ?? DASH, unit: t?.rangeM == null ? undefined : 'm' },
          { label: '徑向速度 RV', value: t?.radialMps?.toFixed(2) ?? DASH, unit: t?.radialMps == null ? undefined : 'm/s' },
          { label: '能量 E', value: t ? t.energy.toLocaleString('en-US') : DASH },
          { label: '換算對地速度 G', value: formatSpeed(t?.groundMps ?? null, unit), unit: t?.groundMps == null ? undefined : speedUnitLabel(unit), hint: '濾波前' },
          { label: '判斷 FV', value: t ? <span className="font-sans">{VERDICT_LABEL[t.verdict]}</span> : DASH },
          { label: '可用比例 Q', value: t ? `${t.qualityPct}%` : DASH, hint: '最近 20 筆' },
          { label: '方向相反 WD', value: t ? `${t.wrongDirPct}%` : DASH },
          { label: '雷達里程 DR', value: odo.value, unit: t ? odo.unit : undefined, hint: '開機起' },
          { label: '輪速里程 DW', value: wheelOdo.value, unit: t?.wheelDistanceM == null ? undefined : wheelOdo.unit },
          { label: 'ESP32 運作', value: t ? formatDuration(t.uptimeS) : DASH },
        ]}
      />
    </Panel>
  );
}

function ScatterPanel() {
  const s = useRadar(useShallow((r) => ({ frames: r.frames, config: r.config, speed: r.telemetry?.speedMps ?? null })));
  return (
    <Panel title="距離 × 徑向速度" description="最近 30 秒；路面回波應落在理論曲線附近、灰色窗口內">
      <ScatterPlot frames={s.frames} config={s.config} speedMps={s.speed} />
    </Panel>
  );
}

function VerdictPanel() {
  const frames = useRadar((r) => r.frames);
  const rows = verdictBreakdown(frames.map((f) => f.verdict));
  return (
    <Panel title="判斷統計" description={`最近 ${frames.length} 筆資料框`}>
      {rows.length === 0 ? (
        <EmptyState title="還沒有資料框" />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.verdict}>
              <div className="flex items-baseline justify-between text-body">
                <span className="text-fg">{VERDICT_LABEL[r.verdict]}</span>
                <span className="tabular font-mono text-muted">
                  {r.count} · {r.pct.toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className={`h-full rounded-full ${r.verdict === 'accepted' || r.verdict === 'unfolded' ? 'bg-accent' : r.verdict === 'noTarget' || r.verdict === 'repeated' ? 'bg-line-strong' : 'bg-warn'}`}
                  style={{ width: `${r.pct}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecorderPanel() {
  const rec = useRadar((r) => r.recording);
  const connected = useRadar((r) => r.connection.status === 'connected');
  const now = useNow();
  return (
    <Panel title="記錄 CSV" description="每一筆資料框一列（約 10 Hz），用來分析精度、比較模型">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-body">
          {rec.active && rec.startedAt !== null ? (
            <span className="inline-flex items-center gap-2 text-fg">
              <StatusDot tone="bad" />
              記錄中 <span className="tabular font-mono">{formatDuration((now - rec.startedAt) / 1000)}</span>
              <span className="text-muted">· {rec.rows} 列</span>
            </span>
          ) : (
            <span className="text-muted">未記錄</span>
          )}
        </div>
        {rec.active ? (
          <Button variant="primary" icon={DownloadIcon} onClick={actions.stopRecording}>
            停止並下載
          </Button>
        ) : (
          <Button icon={RecordIcon} disabled={!connected} onClick={() => radarStore.getState().startRecording()}>
            開始記錄
          </Button>
        )}
      </div>
    </Panel>
  );
}

function TripsPanel() {
  const unit = useSettings((s) => s.speedUnit);
  const trips = useTrip((s) => s.trips);
  const [confirm, setConfirm] = useState(false);
  return (
    <Panel
      title="行程紀錄"
      description="存在這支手機的瀏覽器裡"
      flush
      actions={
        trips.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            全部清除
          </Button>
        ) : undefined
      }
    >
      {trips.length === 0 ? (
        <EmptyState title="還沒有行程紀錄">在「速度」頁結束行程後，超過 50 m 的行程會存在這裡。</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line text-left text-label text-muted">
                <th className="px-4 py-2 font-medium">開始</th>
                <th className="px-2 py-2 text-right font-medium">里程</th>
                <th className="px-2 py-2 text-right font-medium">移動時間</th>
                <th className="px-2 py-2 text-right font-medium">平均</th>
                <th className="px-2 py-2 text-right font-medium">最高</th>
                <th className="px-2 py-2 text-right font-medium">超速</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="tabular font-mono">
              {trips.map((t) => {
                const d = formatDistance(t.distanceM);
                return (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-sans text-fg">{formatDateTime(t.startedAt)}</td>
                    <td className="px-2 py-2 text-right text-fg">
                      {d.value} {d.unit}
                    </td>
                    <td className="px-2 py-2 text-right text-fg">{formatDuration(t.movingS)}</td>
                    <td className="px-2 py-2 text-right text-fg">{formatSpeed(averageMps(t), unit)}</td>
                    <td className="px-2 py-2 text-right text-fg">{formatSpeed(t.maxMps, unit)}</td>
                    <td className={`px-2 py-2 text-right ${t.overspeedCount ? 'text-fg' : 'text-subtle'}`}>
                      {t.overspeedS === undefined ? DASH : t.overspeedCount ? `${t.overspeedCount}× ${formatDuration(t.overspeedS)}` : '0'}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <IconButton icon={TrashIcon} label="刪除這筆行程" onClick={() => tripStore.getState().deleteTrip(t.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-label text-subtle">速度單位：{speedUnitLabel(unit)}。超速：次數 × 累計時間（以當時的速限判斷；2.1 版以前的紀錄沒有這一欄）</p>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="清除行程紀錄"
          message="這支手機上的所有行程紀錄都會刪除，無法復原。"
          confirmLabel="全部清除"
          destructive
          onConfirm={() => tripStore.getState().clearTrips()}
          onClose={() => setConfirm(false)}
        />
      )}
    </Panel>
  );
}

function ConsolePanel() {
  const log = useRadar((r) => r.console);
  const connected = useRadar((r) => r.connection.status === 'connected');
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  const send = () => {
    const line = text.trim();
    if (!line) return;
    void radarStore.getState().sendRaw(line);
    setText('');
  };

  return (
    <Panel
      title="指令主控台"
      description="收發的文字（遙測不列出）；可輸入 HELP、GET、ANGLE 45 等指令"
      flush
      actions={<IconButton icon={TrashIcon} label="清除主控台" onClick={() => radarStore.getState().clearConsole()} />}
    >
      <div className="h-56 overflow-y-auto bg-sunken px-4 py-2 font-mono text-[12px] leading-5">
        {log.length === 0 && <p className="text-subtle">（沒有訊息）</p>}
        {log.map((e) => (
          <div key={e.id} className="flex gap-3 whitespace-pre-wrap">
            <span className="shrink-0 text-subtle">{formatClock(e.at)}</span>
            <span className={e.dir === 'out' ? 'text-accent' : e.dir === 'info' ? 'text-muted' : 'text-fg'}>
              {e.dir === 'out' ? '› ' : e.dir === 'info' ? '· ' : ''}
              {e.text}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={connected ? '輸入指令' : '連線後可輸入指令'}
          disabled={!connected}
          aria-label="指令"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-sunken px-3 font-mono text-body text-fg outline-none placeholder:text-subtle focus-visible:border-accent"
        />
        <Button type="submit" icon={SendIcon} disabled={!connected || text.trim() === ''}>
          送出
        </Button>
      </form>
    </Panel>
  );
}

export function DataPage() {
  return (
    <>
      <PageHeader title="數據" description="原始資料框、判斷結果與記錄：驗證雷達是否穩定量到路面" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid gap-4">
          <FramePanel />
          <RecorderPanel />
        </div>
        <div className="grid gap-4">
          <ScatterPanel />
          <VerdictPanel />
        </div>
        <div className="lg:col-span-2">
          <TripsPanel />
        </div>
        <div className="lg:col-span-2">
          <ConsolePanel />
        </div>
      </div>
    </>
  );
}
