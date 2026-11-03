/**
 * 【校正】後方雷達（HLK-LD2451）：安裝檢查（即時俯視圖）、警示距離、危險到達時間、最低接近速度、訊噪比門檻。
 * 參數存在 ESP32；RANGE、RSPD、RSNR 會寫進 LD2451（要接 LD2451 RX → GPIO26 才寫得進去）。
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { radarStore, useRadar, useSettings } from '../../../application/container';
import { describeRear } from '../../../application/selectors';
import { REAR_LIMITS, diffRearConfig, rearDetectRange } from '../../../domain/protocol';
import type { EditableRearConfig } from '../../../domain/types';
import { DASH } from '../../../domain/units';
import { Card, Notice, Row, Section, StatusLabel, Stepper, inRange } from '../../kit';
import { RearRadarView } from '../../widgets/RearRadar';
import { PendingBar } from '../common/PendingBar';

export function RearPanel() {
  const s = useRadar(useShallow((r) => ({ connection: r.connection, rear: r.rear, rearStale: r.rearStale, config: r.config, rate: r.rearFrameRateHz })));
  const applying = useRadar((r) => r.applying);
  const mirror = useSettings((x) => x.rearMirror);
  const [draft, setDraft] = useState<Partial<EditableRearConfig>>({});
  const config = s.config;

  if (!config) {
    return (
      <Section id="rear" title="後方雷達" description="HLK-LD2451 朝正後方偵測來車">
        <Card className="p-5">
          <p className="text-subhead text-muted">連線後會讀取後方雷達的設定。</p>
        </Card>
      </Section>
    );
  }
  if (!config.rear) {
    return (
      <Section id="rear" title="後方雷達" description="HLK-LD2451 朝正後方偵測來車">
        <Notice tone="info" title={`韌體 v${config.firmware} 沒有後方來車功能`}>
          請燒錄 3.1 以上的韌體（firmware/flash.bat），接上 LD2451 後就會出現在這裡。
        </Notice>
      </Section>
    );
  }

  const current = config.rear;
  const value: EditableRearConfig = {
    rangeM: draft.rangeM ?? current.rangeM,
    minSpeedKmh: draft.minSpeedKmh ?? current.minSpeedKmh,
    ttcS: draft.ttcS ?? current.ttcS,
    snr: draft.snr ?? current.snr,
  };
  const set = (patch: Partial<EditableRearConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const pending = diffRearConfig(current, value);
  const L = REAR_LIMITS;
  const valid =
    inRange(value.rangeM, L.rangeM.min, L.rangeM.max) &&
    Number.isInteger(value.rangeM) &&
    inRange(value.minSpeedKmh, L.minSpeedKmh.min, L.minSpeedKmh.max) &&
    Number.isInteger(value.minSpeedKmh) &&
    inRange(value.ttcS, L.ttcS.min, L.ttcS.max) &&
    inRange(value.snr, L.snr.min, L.snr.max) &&
    Number.isInteger(value.snr);
  const view = describeRear(s);
  const rear = view.live ? s.rear : null;
  const detect = rearDetectRange(value.rangeM);
  const radarWrites = pending.some((c) => c.type !== 'rearTtc');

  const apply = async () => {
    if (await radarStore.getState().applyRearConfig(value)) setDraft({});
  };

  return (
    <Section id="rear" title="後方雷達" description="LD2451 直立（排針朝上）、天線面朝正後方，裝在座管或後貨架，離地 0.6～1 m">
      <Card className="relative">
        <div className="m-2 grid grid-cols-[minmax(0,1fr)_116px] gap-3 rounded-[14px] bg-surface-2 p-3">
          <div className="flex min-w-0 flex-col gap-2">
            <StatusLabel tone={view.tone}>{view.label}</StatusLabel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-footnote">
              <dt className="text-muted">模式</dt>
              <dd className="text-ink">{!rear ? DASH : rear.receiveOnly ? '只接收' : '完整'}</dd>
              <dt className="text-muted">偵測距離</dt>
              <dd className="num text-ink">{current.detectRangeM} m</dd>
              <dt className="text-muted">資料框</dt>
              <dd className="num text-ink">{s.rate === null ? DASH : `${s.rate.toFixed(1)} Hz`}</dd>
              <dt className="text-muted">目標</dt>
              <dd className="num text-ink">{rear ? rear.targets.length : DASH}</dd>
            </dl>
            <p className="mt-auto text-caption text-muted">走近或騎車經過雷達後方，車（點）應該從下面往上接近；左右相反就到「設定」對調。</p>
          </div>
          <div className="h-[200px]">
            <RearRadarView
              data={rear ? { level: rear.level, distanceM: rear.distanceM, targets: rear.targets } : null}
              rangeM={current.rangeM}
              detectRangeM={current.detectRangeM}
              mirror={mirror}
              message={view.live ? undefined : view.label}
            />
          </div>
        </div>
        {rear?.receiveOnly && (
          <div className="px-3 pb-1">
            <Notice tone="warn" flat title="只接收：設定沒有寫進 LD2451">
              ESP32 收得到資料，但雷達不回應指令（LD2451 RX 沒接）。目前用雷達自己存的設定（原廠：偵測 100 m、只回報靠近、5 km/h），
              距離與速度的篩選由 ESP32 再做一次，警示照常；要讓 ESP32 寫入最低速度與訊噪比，把 LD2451 RX 接到 GPIO26。
            </Notice>
          </div>
        )}
        <div className="[&>*+*]:border-t [&>*+*]:border-line">
          <Row label="警示距離 RANGE" detail={`確認的來車進入這個距離就注意；雷達偵測到 ${detect} m（提早確認）`}>
            <Stepper label="警示距離" value={value.rangeM} onChange={(v) => set({ rangeM: Math.round(v) })} min={L.rangeM.min} max={L.rangeM.max} step={1} decimals={0} unit="m" width="w-9" />
          </Row>
          <Row label="危險到達時間 TTC" detail={`5 m 內或到達時間 ≤ TTC 就危險；接近 30 km/h 時約在 ${(value.ttcS * (30 / 3.6)).toFixed(0)} m`}>
            <Stepper label="危險到達時間" value={value.ttcS} onChange={(v) => set({ ttcS: v })} min={L.ttcS.min} max={L.ttcS.max} step={0.5} decimals={1} unit="s" width="w-9" />
          </Row>
          <Row label="最低接近速度 RSPD" detail="比這個慢的接近不算來車（跟車、紅燈前慢慢靠近）">
            <Stepper label="最低接近速度" value={value.minSpeedKmh} onChange={(v) => set({ minSpeedKmh: Math.round(v) })} min={L.minSpeedKmh.min} max={L.minSpeedKmh.max} step={1} decimals={0} unit="km/h" width="w-9" />
          </Row>
          <Row label="訊噪比門檻 RSNR" detail="越大越不靈敏；原廠 4。誤報多再調高">
            <Stepper label="訊噪比門檻" value={value.snr} onChange={(v) => set({ snr: Math.round(v) })} min={L.snr.min} max={L.snr.max} step={1} decimals={0} width="w-9" />
          </Row>
        </div>
        {radarWrites && rear && !rear.receiveOnly && (
          <div className="px-3 pb-3">
            <Notice tone="info" flat title="套用後 ESP32 會重新寫入 LD2451">
              約 1 秒內沒有後方資料。
            </Notice>
          </div>
        )}
        <PendingBar count={pending.length} valid={valid} applying={applying} onReset={() => setDraft({})} onApply={() => void apply()} />
      </Card>
    </Section>
  );
}
