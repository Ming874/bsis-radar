/**
 * 【校正】精度驗證：雷達與輪速感測器（參考值）的即時比對。
 * 距離誤差不受時間落後影響，是主要指標；速度差只在穩定騎乘（輪速 ≥ 2 m/s、雷達追蹤中）時取樣。
 */
import { calibrationStore, useCalibration, useRadar, useSettings } from '../../../application/container';
import { DASH, formatDistance, formatPercent, formatSpeed, speedUnitLabel } from '../../../domain/units';
import { Button, EmptyState, KeyValue, Panel, RefreshIcon } from '../../kit';

export function AgreementPanel() {
  const unit = useSettings((s) => s.speedUnit);
  const a = useCalibration((c) => c.agreement);
  const hasWheel = useRadar((r) => r.telemetry?.wheelDistanceM !== null && r.telemetry?.wheelDistanceM !== undefined);
  const dist = formatDistance(a.wheelDistanceM);

  return (
    <Panel
      title="精度驗證"
      description="以輪速感測器為參考值，比對雷達的里程與速度"
      flush
      actions={
        <Button size="sm" variant="ghost" icon={RefreshIcon} onClick={() => calibrationStore.getState().resetAgreement()}>
          重新開始
        </Button>
      }
    >
      {!hasWheel ? (
        <EmptyState title="沒有偵測到輪速感測器">接上 3144 霍爾開關（GPIO27）並轉動輪子後，這裡會即時比對雷達與輪速。</EmptyState>
      ) : (
        <KeyValue
          rows={[
            { label: '里程誤差', hint: '雷達相對輪速', value: formatPercent(a.distanceErrorPct, 2) },
            { label: '比對距離', value: dist.value, unit: dist.unit },
            { label: '速度差平均', value: a.meanDiffMps === null ? DASH : formatSpeed(a.meanDiffMps, unit, 2), unit: a.meanDiffMps === null ? undefined : speedUnitLabel(unit), hint: a.meanDiffPct === null ? undefined : formatPercent(a.meanDiffPct, 1) },
            { label: '速度差 RMS', value: a.rmsDiffMps === null ? DASH : formatSpeed(a.rmsDiffMps, unit, 2), unit: a.rmsDiffMps === null ? undefined : speedUnitLabel(unit) },
            { label: '取樣數', hint: '輪速 ≥ 7.2 km/h 且雷達追蹤中', value: a.samples },
          ]}
        />
      )}
    </Panel>
  );
}
