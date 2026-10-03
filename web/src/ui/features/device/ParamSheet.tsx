/**
 * 【裝置】參數編輯面板：大數字 + 步進器 + 滑桿 + 快速選項 + 完整說明，按「套用」立刻送到 ESP32。
 */
import { useState } from 'react';
import { radarStore } from '../../../application/container';
import { Button, CheckIcon, HelpBody, Sheet, Slider, Stepper } from '../../kit';
import { PARAM_HELP } from '../../content/help';
import { SIGN_OPTIONS, type NumericParam } from './params';

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 rounded-full border border-line bg-surface px-3.5 text-callout font-semibold text-ink-2 transition hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
}

export function NumericParamSheet({
  spec,
  current,
  energy,
  onClose,
}: {
  spec: NumericParam;
  current: number;
  energy: number;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(current);
  const valid = draft >= spec.min && draft <= spec.max && (spec.decimals > 0 || Number.isInteger(draft));
  const changed = draft !== current;

  const apply = () => {
    void radarStore.getState().sendCommand(spec.toCommand(draft));
    onClose();
  };

  return (
    <Sheet
      title={spec.label}
      description={spec.help.short}
      onClose={onClose}
      footer={
        <>
          <Button block onClick={onClose}>
            取消
          </Button>
          <Button block variant="primary" disabled={!valid || !changed} onClick={apply}>
            套用到 ESP32
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-2">
        <Stepper
          label={spec.label}
          value={draft}
          onChange={setDraft}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          decimals={spec.decimals}
          unit={spec.unit}
        />
        {spec.slider && <Slider label={spec.label} value={draft} onChange={setDraft} min={spec.min} max={spec.max} step={spec.step} />}
        <p className={`text-center text-callout ${valid ? 'text-ink-2' : 'font-semibold text-danger'}`}>
          {valid ? (spec.hint?.(draft) ?? `範圍 ${spec.min.toLocaleString()} ～ ${spec.max.toLocaleString()} ${spec.unit}`) : `請輸入 ${spec.min.toLocaleString()} ～ ${spec.max.toLocaleString()} ${spec.unit}`}
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          <Chip label={`預設 ${spec.format(spec.defaultValue)}`} onClick={() => setDraft(spec.defaultValue)} />
          <Chip label={`目前 ${spec.format(current)}`} onClick={() => setDraft(current)} />
          {spec.key === 'minEnergy' && energy > 0 && (
            <Chip label={`目前能量 ×0.8（${Math.round(energy * 0.8).toLocaleString()}）`} onClick={() => setDraft(Math.round(energy * 0.8))} />
          )}
        </div>

        <div className="rounded-card bg-fill p-4">
          <HelpBody paragraphs={spec.help.body} />
        </div>
      </div>
    </Sheet>
  );
}

export function SignSheet({ current, onClose }: { current: -1 | 0 | 1; onClose: () => void }) {
  const [draft, setDraft] = useState(current);
  const apply = () => {
    void radarStore.getState().sendCommand({ type: 'approachSign', sign: draft });
    onClose();
  };
  return (
    <Sheet
      title="接近方向"
      description={PARAM_HELP.approachSign.short}
      onClose={onClose}
      footer={
        <>
          <Button block onClick={onClose}>
            取消
          </Button>
          <Button block variant="primary" disabled={draft === current} onClick={apply}>
            套用到 ESP32
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="接近方向" className="space-y-2 pt-2">
        {SIGN_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={draft === o.value}
            onClick={() => setDraft(o.value)}
            className={`flex w-full items-center gap-3 rounded-card border p-4 text-left transition ${
              draft === o.value ? 'border-accent bg-accent/8' : 'border-line hover:bg-fill/60'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-ink">{o.label}</span>
              <span className="block text-callout text-ink-2">{o.description}</span>
            </span>
            {draft === o.value && <CheckIcon className="h-5 w-5 shrink-0 text-accent" />}
          </button>
        ))}
      </div>
      <div className="mt-4 rounded-card bg-fill p-4">
        <HelpBody paragraphs={PARAM_HELP.approachSign.body} />
      </div>
    </Sheet>
  );
}
