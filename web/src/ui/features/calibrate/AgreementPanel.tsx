/**
 * 【校正】精度驗證：雷達與輪速感測器（參考值）的即時比對。
 * 距離誤差不受時間落後影響，是主要指標；速度差只在穩定騎乘（輪速 ≥ 2 m/s、雷達追蹤中）時取樣。
 */
import { calibrationStore, useCalibration, useRadar, useSettings } from '../../../application/container';
import { DASH, formatDistance, formatPercent, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { Button, Card, EmptyState, KeyValue, RefreshIcon, Section, cx } from '../../kit';

export function AgreementPanel() {
  const unit = useSettings((s) => s.speedUnit);
  const a = useCalibration((c) => c.agreement);
  const hasWheel = useRadar((r) => r.telemetry?.wheelDistanceM !== null && r.telemetry?.wheelDistanceM !== undefined);
  const dist = formatDistance(a.wheelDistanceM);
  const err = a.distanceErrorPct;

  return (
    <Section
      id="agreement"
      title="精度驗證"
      description="以輪速感測器為參考值，比對雷達的里程與速度"
      action={
        hasWheel && (
          <Button size="sm" variant="plain" icon={RefreshIcon} onClick={() => calibrationStore.getState().resetAgreement()}>
            重新開始
          </Button>
        )
      }
    >
      <Card className="overflow-hidden">
        {!hasWheel ? (
          <EmptyState title="沒有偵測到輪速感測器">接上 3144 霍爾開關（GPIO27）並轉動輪子後，這裡會即時比對雷達與輪速。</EmptyState>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
              <div>
                <div className="text-footnote text-muted">里程誤差（雷達相對輪速）</div>
                <div className={cx('num mt-0.5 text-[2rem] leading-tight font-semibold tracking-tight', err === null ? 'text-faint' : Math.abs(err) <= 2 ? 'text-ok' : Math.abs(err) <= 5 ? 'text-warn' : 'text-bad')}>
                  {formatPercent(err, 2)}
                </div>
              </div>
              <div className="text-right text-footnote text-muted">
                比對 <span className="num text-ink">{dist.value}</span> {dist.unit}
                <div className="text-caption">10 m 以上才算</div>
              </div>
            </div>
            <div className="border-t border-line">
              <KeyValue
                dense
                rows={[
                  {
                    label: '速度差平均',
                    value: a.meanDiffMps === null ? DASH : formatSpeed(a.meanDiffMps, unit, 2),
                    unit: a.meanDiffMps === null ? undefined : speedUnitLabel(unit),
                    hint: a.meanDiffPct === null ? undefined : formatPercent(a.meanDiffPct, 1),
                  },
                  { label: '速度差 RMS', value: a.rmsDiffMps === null ? DASH : formatSpeed(a.rmsDiffMps, unit, 2), unit: a.rmsDiffMps === null ? undefined : speedUnitLabel(unit) },
                  { label: '取樣數', hint: '輪速 ≥ 7.2 km/h、追蹤中', value: a.samples },
                ]}
              />
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}
