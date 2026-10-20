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
import { Button, ConfirmDialog, EmptyState, IconButton, Notice, NumberInput, Panel, PlayIcon, Segmented, StopIcon, TrashIcon, inRange } from '../../kit';

const STEPS: Record<CalibrationMethod, string[]> = {
  distance: [
    '在平直的路面量好一段距離（建議 100 m，至少 30 m；操場直線跑道或捲尺），起點、終點做記號。',
    '車子停在起點，前輪對準記號，按「開始」。',
    '以平常的速度騎到終點，慢慢停下，前輪停在終點記號上，再按「結束」。',
    '輸入實際距離。重複 3 趟，結果會依距離加權合併。',
  ],
  wheel: [
    '先在「設定 → 輪周長」設好輪速感測器的輪周長（建議用滾動法實測）。',
    '按「開始」，在平坦的路面正常騎 300 m 以上，避免急煞、打滑與上下人行道。',
    '按「結束」：以同一段時間的輪速里程當參考距離。',
  ],
};

function SessionView() {
  const s = useCalibration(useShallow((c) => ({ session: c.session, pending: c.pending })));
  const [referenceM, setReferenceM] = useState(100);
  const [error, setError] = useState<string | null>(null);

  if (s.session) {
    const sess = s.session;
    return (
      <div className="rounded-md border border-line bg-sunken p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-label text-muted">{sess.method === 'distance' ? '距離校正進行中' : '輪速校正進行中'}</span>
          <span className="text-label text-subtle">開始於 {formatDateTime(sess.startedAt)}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <div className="text-label text-muted">雷達量到</div>
            <div className="tabular text-stat font-semibold text-fg">
              {sess.radarM.toFixed(1)} <span className="text-label font-normal text-muted">m</span>
            </div>
          </div>
          <div>
            <div className="text-label text-muted">輪速感測器</div>
            <div className="tabular text-stat font-semibold text-fg">
              {sess.wheelM === null ? '—' : sess.wheelM.toFixed(1)} {sess.wheelM !== null && <span className="text-label font-normal text-muted">m</span>}
            </div>
          </div>
        </div>
        {sess.invalid && (
          <div className="mt-3">
            <Notice tone="bad" title={sess.invalid} />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => calibrationStore.getState().cancel()}>
            取消
          </Button>
          <Button variant="primary" icon={StopIcon} onClick={() => calibrationStore.getState().stop()}>
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
      <div className="rounded-md border border-line bg-sunken p-4">
        <p className="text-body text-fg">
          這一趟雷達量到 <span className="tabular font-mono">{p.radarM.toFixed(2)} m</span>
          {p.method === 'wheel' && (
            <>
              ，輪速感測器 <span className="tabular font-mono">{p.wheelM === null ? '—' : `${p.wheelM.toFixed(2)} m`}</span>
            </>
          )}
          。
        </p>
        {p.method === 'distance' && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label htmlFor="cal-reference" className="text-body text-muted">
              實際距離
            </label>
            <NumberInput id="cal-reference" label="實際距離" value={referenceM} onChange={setReferenceM} min={MIN_CALIBRATION_M} max={5000} step={10} decimals={1} unit="m" width="w-20" />
          </div>
        )}
        {preview && (
          <p className="mt-3 text-label text-muted">
            雷達誤差 <span className="tabular font-mono text-fg">{formatPercent(preview.errorPct, 2)}</span>；只看這一趟的新係數為{' '}
            <span className="tabular font-mono text-fg">{roundCalibration(preview.newCalibration).toFixed(4)}</span>
          </p>
        )}
        {error && <p className="mt-2 text-label text-bad">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => calibrationStore.getState().discardPending()}>
            放棄這一趟
          </Button>
          <Button variant="primary" onClick={accept}>
            加入結果
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function RunsTable() {
  const runs = useCalibration((c) => c.runs);
  if (runs.length === 0) return <EmptyState title="還沒有校正紀錄">完成一趟後會列在這裡；建議做 3 趟再套用。</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-line text-left text-label text-muted">
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">方式</th>
            <th className="py-2 pr-3 text-right font-medium">雷達</th>
            <th className="py-2 pr-3 text-right font-medium">參考</th>
            <th className="py-2 pr-3 text-right font-medium">誤差</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="tabular font-mono">
          {runs.map((r, i) => {
            const e = evaluateRun(r);
            return (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="py-2 pr-3 font-sans text-muted">{i + 1}</td>
                <td className="py-2 pr-3 font-sans text-fg">{r.method === 'distance' ? '距離' : '輪速'}</td>
                <td className="py-2 pr-3 text-right text-fg">{r.radarM.toFixed(1)} m</td>
                <td className="py-2 pr-3 text-right text-fg">{r.referenceM.toFixed(1)} m</td>
                <td className="py-2 pr-3 text-right text-fg">{formatPercent(e?.errorPct ?? null, 2)}</td>
                <td className="py-1 text-right">
                  <IconButton icon={TrashIcon} label={`刪除第 ${i + 1} 趟`} onClick={() => calibrationStore.getState().removeRun(r.id)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CalibrationPanel() {
  const [method, setMethod] = useState<CalibrationMethod>('distance');
  const [confirm, setConfirm] = useState<number | null>(null);
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
    <Panel
      title="校正係數"
      description="CAL 讓雷達量到的距離等於真實距離：CAL新 = CAL舊 × 真實 ÷ 雷達"
      actions={
        <span className="tabular rounded-md border border-line bg-sunken px-2.5 py-1 font-mono text-value text-fg" title="目前裝置上的校正係數">
          {r.calibration === null ? '—' : r.calibration.toFixed(4)}
        </span>
      }
    >
      {cal.lastApplied && (
        <p className="mb-4 text-label text-muted">
          上次套用：{formatDateTime(cal.lastApplied.at)}，{cal.lastApplied.from.toFixed(4)} → {cal.lastApplied.to.toFixed(4)}（{cal.lastApplied.runs} 趟）
        </p>
      )}

      {!cal.busy && (
        <>
          <Segmented
            label="校正方式"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'distance', label: '已知距離' },
              { value: 'wheel', label: '輪速感測器' },
            ]}
          />
          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-body text-muted marker:text-subtle">
            {STEPS[method].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {method === 'wheel' && !r.hasWheel && (
            <div className="mt-3">
              <Notice tone="warn" title="沒有偵測到輪速感測器">
                輪子轉動後 ESP32 才會開始回報輪速；確認 3144 霍爾開關接在 GPIO27、磁鐵經過時距離 5 mm 內。
              </Notice>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" icon={PlayIcon} disabled={!r.connected || (method === 'wheel' && !r.hasWheel)} onClick={start}>
              開始一趟
            </Button>
          </div>
        </>
      )}
      <SessionView />

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-heading font-semibold text-fg">校正結果</h3>
          {cal.runs > 0 && (
            <Button size="sm" variant="ghost" onClick={() => calibrationStore.getState().clearRuns()}>
              清除
            </Button>
          )}
        </div>
        <RunsTable />
        {cal.combined && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-sunken px-4 py-3">
            <div>
              <div className="text-label text-muted">
                建議係數（{cal.combined.runs} 趟依距離加權
                {cal.combined.spreadPct !== null && `，各趟離散 ${cal.combined.spreadPct.toFixed(2)}%`}）
              </div>
              <div className="tabular font-mono text-stat font-semibold text-fg">{roundCalibration(cal.combined.calibration).toFixed(4)}</div>
            </div>
            <Button variant="primary" disabled={!r.connected} onClick={() => cal.combined && apply(cal.combined.calibration)}>
              套用到裝置
            </Button>
          </div>
        )}
      </div>

      <details className="group mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-label text-muted select-none hover:text-fg">手動輸入校正係數</summary>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <NumberInput label="校正係數" value={manualValue} onChange={setManual} min={LIMITS.calibration.min} max={LIMITS.calibration.max} step={0.001} decimals={4} width="w-24" />
          <Button disabled={!r.connected || !inRange(manualValue, LIMITS.calibration.min, LIMITS.calibration.max)} onClick={() => apply(manualValue)}>
            套用
          </Button>
        </div>
      </details>

      {confirm !== null && r.calibration !== null && (
        <ConfirmDialog
          title="校正係數變化很大"
          message={`新係數 ${confirm.toFixed(4)} 與目前 ${r.calibration.toFixed(4)} 相差超過 40%。通常代表安裝角度、雷達朝向或參考距離有誤；確定要套用嗎？`}
          confirmLabel="仍要套用"
          onConfirm={() => void actions.applyCalibration(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </Panel>
  );
}
