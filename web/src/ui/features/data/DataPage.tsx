/**
 * 【數據】診斷與記錄：即時資料框、距離 × 徑向速度散佈圖、判斷統計、CSV 記錄、指令主控台。
 * 手機用上方的分段切換（一次看一塊，主控台不用捲到最下面）；電腦兩欄全部攤開。
 */
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, radarStore, useRadar, useSettings } from '../../../application/container';
import { VERDICT_LABEL, verdictBreakdown } from '../../../application/selectors';
import { DASH, formatClock, formatDistance, formatDuration, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { useMediaQuery, DESKTOP } from '../../hooks/useMediaQuery';
import { useNow } from '../../hooks/useNow';
import { Button, Card, DownloadIcon, EmptyState, IconButton, KeyValue, RecordIcon, Section, Segmented, SendIcon, StatusDot, TextField, TrashIcon, cx } from '../../kit';
import { PageHeader } from '../../shell/PageHeader';
import { ScatterPlot } from '../../widgets/ScatterPlot';

type View = 'live' | 'chart' | 'console';
const VIEW_KEY = 'bsis.data.view';

function FrameCard() {
  const unit = useSettings((s) => s.speedUnit);
  const s = useRadar(useShallow((r) => ({ t: r.telemetry, rate: r.frameRateHz })));
  const t = s.t;
  const odo = formatDistance(t?.radarDistanceM ?? null);
  const wheelOdo = formatDistance(t?.wheelDistanceM ?? null);
  return (
    <Section title="即時資料框" description="C4001 每 0.1 秒一筆；最新一筆與估計器狀態">
      <Card className="overflow-hidden">
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
      </Card>
    </Section>
  );
}

function ScatterCard() {
  const s = useRadar(useShallow((r) => ({ frames: r.frames, config: r.config, speed: r.telemetry?.speedMps ?? null })));
  return (
    <Section title="距離 × 徑向速度" description="最近 30 秒；路面回波應落在理論曲線附近、灰色窗口內">
      <Card className="p-4">
        <ScatterPlot frames={s.frames} config={s.config} speedMps={s.speed} />
      </Card>
    </Section>
  );
}

function VerdictCard() {
  const frames = useRadar((r) => r.frames);
  const rows = verdictBreakdown(frames.map((f) => f.verdict));
  return (
    <Section title="判斷統計" description={`最近 ${frames.length} 筆資料框`}>
      <Card className="p-4">
        {rows.length === 0 ? (
          <EmptyState title="還沒有資料框">連線後會即時統計每一筆的判斷結果。</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.verdict}>
                <div className="flex items-baseline justify-between text-subhead">
                  <span className="text-ink">{VERDICT_LABEL[r.verdict]}</span>
                  <span className="num text-muted">
                    {r.count} · {r.pct.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      r.verdict === 'accepted' || r.verdict === 'unfolded' ? 'bg-tint' : r.verdict === 'noTarget' || r.verdict === 'repeated' ? 'bg-line-strong' : 'bg-warn',
                    )}
                    style={{ width: `${r.pct}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

function RecorderCard() {
  const rec = useRadar((r) => r.recording);
  const connected = useRadar((r) => r.connection.status === 'connected');
  const now = useNow();
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-headline font-semibold text-ink">記錄 CSV</p>
        {rec.active && rec.startedAt !== null ? (
          <p className="mt-0.5 inline-flex items-center gap-2 text-footnote text-ink">
            <StatusDot tone="bad" className="motion-safe:animate-pulse" />
            記錄中 <span className="num">{formatDuration((now - rec.startedAt) / 1000)}</span>
            <span className="num text-muted">· {rec.rows} 列</span>
          </p>
        ) : (
          <p className="mt-0.5 text-footnote text-muted">每一筆資料框一列（約 10 Hz），分析精度、比較模型用</p>
        )}
      </div>
      {rec.active ? (
        <Button variant="primary" icon={DownloadIcon} onClick={actions.stopRecording}>
          停止並下載
        </Button>
      ) : (
        <Button variant="tinted" icon={RecordIcon} disabled={!connected} onClick={() => radarStore.getState().startRecording()}>
          開始記錄
        </Button>
      )}
    </Card>
  );
}

const QUICK_COMMANDS = ['GET', 'HELP'];

function ConsoleCard({ fill = false }: { fill?: boolean }) {
  const log = useRadar((r) => r.console);
  const connected = useRadar((r) => r.connection.status === 'connected');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const send = (line: string) => {
    const cmd = line.trim();
    if (!cmd) return;
    void radarStore.getState().sendRaw(cmd);
    setText('');
  };

  return (
    <Section
      title="指令主控台"
      description="收發的文字（遙測不列出）；可輸入 HELP、GET、ANGLE 45 等指令"
      action={<IconButton icon={TrashIcon} label="清除主控台" onClick={() => radarStore.getState().clearConsole()} />}
    >
      <Card className="overflow-hidden">
        <div ref={listRef} className={cx('thin-scroll overflow-y-auto bg-surface-2 px-4 py-3 font-mono text-[12.5px] leading-5', fill ? 'h-[calc(100dvh-24rem)] min-h-56' : 'h-64')}>
          {log.length === 0 && <p className="text-faint">（沒有訊息）</p>}
          {log.map((e) => (
            <div key={e.id} className="flex gap-3 whitespace-pre-wrap">
              <span className="shrink-0 text-faint">{formatClock(e.at)}</span>
              <span className={e.dir === 'out' ? 'text-tint' : e.dir === 'info' ? 'text-muted' : 'text-ink'}>
                {e.dir === 'out' ? '› ' : e.dir === 'info' ? '· ' : ''}
                {e.text}
              </span>
            </div>
          ))}
        </div>
        <form
          className="flex flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <div className="flex gap-2">
            <TextField
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={connected ? '輸入指令' : '連線後可輸入指令'}
              disabled={!connected}
              aria-label="指令"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              className="flex-1 font-mono"
            />
            <IconButton icon={SendIcon} label="送出" variant="soft" size="lg" type="submit" disabled={!connected || text.trim() === ''} className="text-tint" />
          </div>
          <div className="flex gap-2">
            {QUICK_COMMANDS.map((c) => (
              <Button key={c} size="sm" variant="secondary" disabled={!connected} onClick={() => send(c)} className="font-mono">
                {c}
              </Button>
            ))}
          </div>
        </form>
      </Card>
    </Section>
  );
}

function readView(): View {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    return v === 'chart' || v === 'console' ? v : 'live';
  } catch {
    return 'live';
  }
}

export function DataPage() {
  const desktop = useMediaQuery(DESKTOP);
  const [view, setView] = useState<View>(readView);
  const choose = (v: View) => {
    setView(v);
    try {
      sessionStorage.setItem(VIEW_KEY, v);
    } catch {
      // 記不住就算了
    }
  };

  if (desktop) {
    return (
      <>
        <PageHeader title="數據" description="原始資料框、判斷結果與記錄：驗證雷達是否穩定量到路面" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="grid gap-6">
            <RecorderCard />
            <FrameCard />
          </div>
          <div className="grid gap-6">
            <ScatterCard />
            <VerdictCard />
          </div>
          <div className="lg:col-span-2">
            <ConsoleCard />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="數據" />
      <div className="mb-4">
        <Segmented<View>
          label="顯示"
          block
          value={view}
          onChange={choose}
          options={[
            { value: 'live', label: '資料框' },
            { value: 'chart', label: '圖表' },
            { value: 'console', label: '主控台' },
          ]}
        />
      </div>
      <div className="grid gap-6">
        {view === 'live' && (
          <>
            <RecorderCard />
            <FrameCard />
          </>
        )}
        {view === 'chart' && (
          <>
            <ScatterCard />
            <VerdictCard />
          </>
        )}
        {view === 'console' && <ConsoleCard fill />}
      </div>
    </>
  );
}
