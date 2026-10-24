/**
 * 【校正】安裝幾何：角度、高度、朝向、速度模型。改完按「套用到裝置」才送出（一次送完所有變更）。
 */
import { useState } from 'react';
import { radarStore, useRadar } from '../../../application/container';
import { LIMITS, diffConfig, groundWindow } from '../../../domain/protocol';
import type { EditableConfig, SpeedModel } from '../../../domain/types';
import { Card, Notice, Row, Section, Segmented, Stepper, inRange } from '../../kit';
import { MountDiagram } from '../../widgets/MountDiagram';
import { PendingBar } from '../common/PendingBar';

type MountFields = Pick<EditableConfig, 'angleDeg' | 'heightM' | 'direction' | 'model'>;

export function MountPanel() {
  const config = useRadar((r) => r.config);
  const applying = useRadar((r) => r.applying);
  const [draft, setDraft] = useState<Partial<MountFields>>({});

  if (!config) {
    return (
      <Section id="mount" title="安裝幾何" description="雷達斜向下照路面">
        <Card className="p-5">
          <p className="text-subhead text-muted">連線後會讀取裝置目前的安裝參數。</p>
        </Card>
      </Section>
    );
  }

  const value: MountFields = {
    angleDeg: draft.angleDeg ?? config.angleDeg,
    heightM: draft.heightM ?? config.heightM,
    direction: draft.direction ?? config.direction,
    model: draft.model ?? config.model,
  };
  const set = (patch: Partial<MountFields>) => setDraft((d) => ({ ...d, ...patch }));
  const pending = diffConfig(config, { ...config, ...value });
  const valid = inRange(value.angleDeg, LIMITS.angleDeg.min, LIMITS.angleDeg.max) && inRange(value.heightM, LIMITS.heightM.min, LIMITS.heightM.max);
  const geometryChanged = pending.some((c) => c.type === 'angle' || c.type === 'height');
  const modelChanged = pending.some((c) => c.type === 'model');
  const preview = groundWindow(value.angleDeg, value.heightM);

  const apply = async () => {
    if (await radarStore.getState().applyConfig({ ...config, ...value })) setDraft({});
  };

  return (
    <Section id="mount" title="安裝幾何" description="角度用手機水平儀量雷達背面；高度量天線面中心到地面">
      <Card className="relative">
        <div className="m-2 rounded-[14px] bg-surface-2 px-3 py-2">
          <div className="mx-auto max-w-[440px]">
            <MountDiagram angleDeg={value.angleDeg} heightM={value.heightM} direction={value.direction} />
          </div>
        </div>
        <div className="[&>*+*]:border-t [&>*+*]:border-line">
          <Row label="俯角 θ" detail="建議 40～45°；1° 誤差約 1.7%">
            <Stepper label="俯角" value={value.angleDeg} onChange={(v) => set({ angleDeg: v })} min={LIMITS.angleDeg.min} max={LIMITS.angleDeg.max} step={0.5} decimals={1} unit="°" width="w-12" />
          </Row>
          <Row
            label="離地高度 h"
            detail={`視軸打在 ${(value.heightM / Math.tan((value.angleDeg * Math.PI) / 180)).toFixed(2)} m 外；窗口 ${preview.minM.toFixed(2)}～${preview.maxM.toFixed(2)} m`}
          >
            <Stepper label="離地高度" value={value.heightM} onChange={(v) => set({ heightM: v })} min={LIMITS.heightM.min} max={LIMITS.heightM.max} step={0.01} decimals={2} unit="m" width="w-12" />
          </Row>
          <Row label="雷達朝向" detail="朝後：裝在後貨架尾端（建議）">
            <Segmented
              label="雷達朝向"
              value={value.direction}
              onChange={(v) => set({ direction: v })}
              options={[
                { value: 1, label: '朝後' },
                { value: -1, label: '朝前' },
              ]}
            />
          </Row>
          <Row
            label="速度模型"
            stack
            detail={
              value.model === 'fixedAngle'
                ? '固定角度：v = CAL·|vr| / cos θ。文獻上的標準作法，不依賴雷達距離的準確度'
                : '距離幾何：每一筆用 sin α = h / 距離 算俯角。可降低路面材質造成的偏差，但需要準確的高度與距離（實驗性）'
            }
          >
            <Segmented<SpeedModel>
              label="速度模型"
              block
              value={value.model}
              onChange={(v) => set({ model: v })}
              options={[
                { value: 'fixedAngle', label: '固定角度' },
                { value: 'rangeGeometry', label: '距離幾何' },
              ]}
            />
          </Row>
        </div>
        {(geometryChanged || modelChanged) && (
          <div className="px-3 pb-3">
            <Notice tone="info" flat title={modelChanged ? '換了速度模型，請重新校正' : '套用後 ESP32 會重新設定雷達'}>
              {modelChanged ? '兩種模型的校正係數意義不同；套用後到下方重新做距離校正。' : '地面距離窗口會寫進 C4001，約 4 秒內沒有資料。角度改變後也建議重新校正。'}
            </Notice>
          </div>
        )}
        <PendingBar count={pending.length} valid={valid} applying={applying} onReset={() => setDraft({})} onApply={() => void apply()} />
      </Card>
    </Section>
  );
}
