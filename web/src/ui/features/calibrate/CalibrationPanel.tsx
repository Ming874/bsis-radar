/**
 * 【校正】校正係數 CAL：距離校正（已知距離）或輪速校正（輪速感測器的里程），可做多趟後合併套用。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, calibrationStore, radarStore, useCalibration, useRadar } from '../../../application/container';
import type { CalibrationMethod } from '../../../application/calibrationStore';
import { MIN_CALIBRATION_M, checkCalibration, evaluateRun, roundCalibration } from '../../../domain/calibration';
import { LIMITS } from '../../../domain/protocol';
import { formatDateTime, formatPercent } from '../../../domain/units';
import { Button, Card, ConfirmSheet, EmptyState, IconButton, Notice, PlayIcon, Section, Segmented, Stepper, StopIcon, TrashIcon, cx, inRange } from '../../kit';

const STEPS: Record<CalibrationMethod, string[]> = {
  distance: [
    '在平直的路面量好一段距離（建議 100 m，至少 30 m；操場直線跑道或捲尺），起點、終點做記號。',
    '車子停在起點，前輪對準記號，按「開始一趟」。',
    '以平常的速度騎到終點，慢慢停下，前輪停在終點記號上，再按「結束這一趟」。',
    '輸入實際距離。重複 3 趟，結果會依距離加權合併。',
  ],
  wheel: [
    '先在「設定 → 裝置參數」設好輪周長（建議用滾動法實測）。',
    '按「開始一趟」，在平坦的路面正常騎 300 m 以上，避免急煞、打滑與上下人行道。',
    '按「結束這一趟」：以同一段時間的輪速里程當參考距離。',
  ],
};

function Big({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-footnote text-muted">{label}</div>
      <div className="num mt-0.5 text-[2rem] leading-tight font-semibold tracking-tight text-ink">
        {value}
        {unit && <span className="ml-1 text-footnote font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function SessionView() {
  const s = useCalibration(useShallow((c) => ({ session: c.session, pending: c.pending })));
  const [referenceM, setReferenceM] = useState(100);
  const [error, setError] = useState<string | null>(null);

  if (s.session) {
    const sess = s.session;
    return (
      <div className="rounded-2xl bg-tint-soft p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-footnote font-semibold text-tint">{sess.method === 'distance' ? '距離校正進行中' : '輪速校正進行中'}</span>
          <span className="text-caption text-muted">開始於 {formatDateTime(sess.startedAt)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <Big label="雷達量到" value={sess.radarM.toFixed(1)} unit="m" />
          <Big label="輪速感測器" value={sess.wheelM === null ? '—' : sess.wheelM.toFixed(1)} unit={sess.wheelM === null ? undefined : 'm'} />
        </div>
        {sess.invalid && (
          <div className="mt-3">
            <Notice tone="bad" title={sess.invalid} flat />
          </div>
        )}
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <Button variant="secondary" size="lg" onClick={() => calibrationStore.getState().cancel()}>
            取消
          </Button>
          <Button variant="primary" size="lg" icon={StopIcon} onClick={() => calibrationStore.getState().stop()}>
            結束這一趟
          </Button>
        </div>
      </div>
    );
  }

  if (s.pending) {
    const p = s.pending;
    const reference = p.method === 'wheel' ? p.wheelM : referenceM;
    const preview = reference !== null && reference > 0 ? evaluateRun({ radarM: p.radarM, referenceM: reference, calibrationUsed: p.calibrationUsed }) : null;
    const accept = () => setError(calibrationStore.getState().acceptPending(p.method === 'distance' ? referenceM : undefined));
    return (
      <div className="rounded-2xl bg-surface-2 p-4">
        <div className="grid grid-cols-2 gap-4">
          <Big label="這一趟雷達量到" value={p.radarM.toFixed(2)} unit="m" />
          {p.method === 'wheel' && <Big label="輪速感測器" value={p.wheelM === null ? '—' : p.wheelM.toFixed(2)} unit={p.wheelM === null ? undefined : 'm'} />}
        </div>
        {p.method === 'distance' && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="cal-reference" className="text-subhead font-medium text-ink">
              實際距離
            </label>
            <Stepper id="cal-reference" label="實際距離" value={referenceM} onChange={setReferenceM} min={MIN_CALIBRATION_M} max={5000} step={10} decimals={1} unit="m" width="w-16" />
          </div>
        )}
        {preview && (
          <p className="mt-3 text-footnote text-muted">
            雷達誤差 <span className="num font-semibold text-ink">{formatPercent(preview.errorPct, 2)}</span>；只看這一趟的新係數為{' '}
            <span className="num font-semibold text-ink">{roundCalibration(preview.newCalibration).toFixed(4)}</span>
          </p>
        )}
        {error && <p className="mt-2 text-footnote text-bad">{error}</p>}
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <Button variant="secondary" size="lg" onClick={() => calibrationStore.getState().discardPending()}>
            放棄
          </Button>
          <Button variant="primary" size="lg" onClick={accept}>
            加入結果
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function RunsList() {
  const runs = useCalibration((c) => c.runs);
  if (runs.length === 0) return <EmptyState title="還沒有校正紀錄">完成一趟後會列在這裡；建議做 3 趟再套用。</EmptyState>;
  return (
    <div className="[&>*+*]:border-t [&>*+*]:border-line">
      {runs.map((r, i) => {
        const e = evaluateRun(r);
        return (
          <div key={r.id} className="flex items-center gap-3 py-2.5 pl-1">
            <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-footnote font-semibold text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="num text-subhead text-ink">
                雷達 {r.radarM.toFixed(1)} m · 參考 {r.referenceM.toFixed(1)} m
              </p>
              <p className="text-caption text-muted">
                {r.method === 'distance' ? '已知距離' : '輪速感測器'} · 誤差 <span className="num">{formatPercent(e?.errorPct ?? null, 2)}</span>
              </p>
            </div>
            <IconButton icon={TrashIcon} label={`刪除第 ${i + 1} 趟`} onClick={() => calibrationStore.getState().removeRun(r.id)} />
          </div>
        );
      })}
    </div>
  );
}

export function CalibrationPanel() {
  const [method, setMethod] = useState<CalibrationMethod>('distance');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [manual, setManual] = useState<number | null>(null);
  const cal = useCalibration(useShallow((c) => ({ busy: c.session !== null || c.pending !== null, combined: c.combined, lastApplied: c.lastApplied, runs: c.runs.length })));
  const r = useRadar(
    useShallow((s) => ({
      connected: s.connection.status === 'connected' && s.telemetry !== null && s.config !== null,
      calibration: s.config?.calibration ?? null,
      hasWheel: s.telemetry?.wheelDistanceM !== null && s.telemetry?.wheelDistanceM !== undefined,
    })),
  );

  // 按下「開始」時才讀取當下的遙測與設定（不訂閱，避免每 0.1 秒重繪）
  const start = () => {
    const { telemetry, config } = radarStore.getState();
    if (telemetry && config) calibrationStore.getState().start(method, telemetry, config.calibration);
  };
  const apply = (next: number) => {
    if (r.calibration !== null && checkCalibration(r.calibration, next) === 'largeChange') setConfirm(next);
    else void actions.applyCalibration(next);
  };
  const manualValue = manual ?? r.calibration ?? 1;

  return (
    <Section id="calibration" title="校正係數" description="CAL 讓雷達量到的距離等於真實距離：CAL新 = CAL舊 × 真實 ÷ 雷達">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-footnote text-muted">裝置上的校正係數</div>
            {cal.lastApplied ? (
              <div className="truncate text-caption text-muted">
                {formatDateTime(cal.lastApplied.at)} 套用（{cal.lastApplied.runs} 趟）
              </div>
            ) : (
              <div className="text-caption text-muted">{r.calibration === 1 ? '出廠值，尚未校正' : '　'}</div>
            )}
          </div>
          <span className={cx('num text-[1.75rem] font-semibold tracking-tight', r.calibration === 1 ? 'text-warn' : 'text-ink')}>{r.calibration === null ? '—' : r.calibration.toFixed(4)}</span>
        </div>

        {!cal.busy && (
          <div className="mt-4">
            <Segmented
              label="校正方式"
              block
              value={method}
              onChange={setMethod}
              options={[
                { value: 'distance', label: '已知距離' },
                { value: 'wheel', label: '輪速感測器' },
              ]}
            />
            <ol className="mt-4 flex flex-col gap-2.5">
              {STEPS[method].map((step, i) => (
                <li key={step} className="flex gap-3 text-subhead text-ink">
                  <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-bold text-muted">{i + 1}</span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
            {method === 'wheel' && !r.hasWheel && (
              <div className="mt-3">
                <Notice tone="warn" flat title="沒有偵測到輪速感測器">
                  輪子轉動後 ESP32 才會開始回報輪速；確認 3144 霍爾開關接在 GPIO27、磁鐵經過時距離 5 mm 內。
                </Notice>
              </div>
            )}
            <Button className="mt-4" variant="primary" size="lg" block icon={PlayIcon} disabled={!r.connected || (method === 'wheel' && !r.hasWheel)} onClick={start}>
              {r.connected ? '開始一趟' : '連線後才能校正'}
            </Button>
          </div>
        )}
        {cal.busy && (
          <div className="mt-4">
            <SessionView />
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-headline font-semibold text-ink">校正結果</h3>
            {cal.runs > 0 && (
              <Button size="sm" variant="plain" onClick={() => setConfirmClear(true)}>
                清除
              </Button>
            )}
          </div>
          <RunsList />
          {cal.combined && (
            <div className="mt-3 rounded-2xl bg-tint-soft p-4">
              <div className="text-footnote text-muted">
                建議係數（{cal.combined.runs} 趟依距離加權
                {cal.combined.spreadPct !== null && `，各趟離散 ${cal.combined.spreadPct.toFixed(2)}%`}）
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                <span className="num text-[1.75rem] font-semibold tracking-tight text-ink">{roundCalibration(cal.combined.calibration).toFixed(4)}</span>
                <Button variant="primary" disabled={!r.connected} onClick={() => cal.combined && apply(cal.combined.calibration)}>
                  套用到裝置
                </Button>
              </div>
            </div>
          )}
        </div>

        <details className="group mt-4 border-t border-line pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-subhead text-muted select-none hover:text-ink">手動輸入校正係數</summary>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Stepper label="校正係數" value={manualValue} onChange={setManual} min={LIMITS.calibration.min} max={LIMITS.calibration.max} step={0.001} decimals={4} width="w-20" />
            <Button disabled={!r.connected || !inRange(manualValue, LIMITS.calibration.min, LIMITS.calibration.max)} onClick={() => apply(manualValue)}>
              套用
            </Button>
          </div>
        </details>
      </Card>

      <ConfirmSheet
        open={confirm !== null && r.calibration !== null}
        title="校正係數變化很大"
        message={confirm !== null && r.calibration !== null ? `新係數 ${confirm.toFixed(4)} 與目前 ${r.calibration.toFixed(4)} 相差超過 40%。通常代表安裝角度、雷達朝向或參考距離有誤；確定要套用嗎？` : ''}
        confirmLabel="仍要套用"
        onConfirm={() => confirm !== null && void actions.applyCalibration(confirm)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirmClear}
        title="清除校正結果"
        message="這幾趟的結果都會刪除（裝置上的校正係數不變）。"
        confirmLabel="清除"
        destructive
        onConfirm={() => calibrationStore.getState().clearRuns()}
        onClose={() => setConfirmClear(false)}
      />
    </Section>
  );
}
