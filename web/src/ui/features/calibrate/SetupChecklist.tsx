/**
 * 【校正】設定進度：照著做完就能上路。每一項都由裝置目前的狀態判斷（不是自己勾的），點了捲到對應的區塊。
 */
import { useShallow } from 'zustand/react/shallow';
import { openSheet, useRadar } from '../../../application/container';
import { DEFAULT_CONFIG } from '../../../domain/protocol';
import { AlertIcon, CheckCircleIcon, CircleIcon, ListGroup, Row, cx, type IconProps } from '../../kit';
import { goTab } from '../../shell/tabs';
import type { ComponentType } from 'react';

type State = 'done' | 'todo' | 'warn' | 'optional';

const ICON: Record<State, { Icon: ComponentType<IconProps>; color: string }> = {
  done: { Icon: CheckCircleIcon, color: 'text-ok' },
  todo: { Icon: CircleIcon, color: 'text-faint' },
  warn: { Icon: AlertIcon, color: 'text-warn' },
  optional: { Icon: CircleIcon, color: 'text-faint' },
};

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Item({ state, label, detail, onClick }: { state: State; label: string; detail: string; onClick: () => void }) {
  const { Icon, color } = ICON[state];
  return (
    <Row
      label={
        <span className="flex items-center gap-3">
          <Icon className={cx('h-[22px] w-[22px] shrink-0', color)} strokeWidth={2} />
          <span>{label}</span>
        </span>
      }
      detail={<span className="block pl-[34px]">{detail}</span>}
      chevron
      onClick={onClick}
    />
  );
}

export function SetupChecklist() {
  const s = useRadar(
    useShallow((r) => ({
      connected: r.connection.status === 'connected',
      legacy: r.legacyFirmware,
      config: r.config,
      wheel: r.telemetry ? r.telemetry.wheelDistanceM !== null : null,
    })),
  );
  const c = s.config;
  const ready = s.connected && c !== null && !s.legacy;
  const mountDefault = c !== null && c.angleDeg === DEFAULT_CONFIG.angleDeg && c.heightM === DEFAULT_CONFIG.heightM;

  return (
    <ListGroup title="設定進度" footer="依裝置目前的參數判斷；每一項的做法在上手文件 §7～§10。">
      <Item
        state={ready ? 'done' : s.legacy ? 'warn' : 'todo'}
        label="連線裝置"
        detail={ready ? `韌體 v${c.firmware}` : s.legacy ? `韌體 v${s.legacy} 過舊，請燒錄 3.x` : '按這裡連線 BSIS-Speed'}
        onClick={() => openSheet('connection')}
      />
      <Item
        state={!c ? 'todo' : mountDefault ? 'warn' : 'done'}
        label="安裝幾何"
        detail={!c ? '連線後讀取' : `${c.angleDeg.toFixed(1)}° · ${c.heightM.toFixed(2)} m · ${c.direction === 1 ? '朝後' : '朝前'}${mountDefault ? '（預設值，請實際量測）' : ''}`}
        onClick={() => scrollToId('mount')}
      />
      <Item
        state={!c ? 'todo' : c.calibration === 1 ? 'warn' : 'done'}
        label="校正係數"
        detail={!c ? '連線後讀取' : c.calibration === 1 ? '出廠值 1.0000，讀值通常偏低 10～20%' : `CAL ${c.calibration.toFixed(4)}`}
        onClick={() => scrollToId('calibration')}
      />
      <Item
        state={!c ? 'todo' : c.radialLimitMps > 3.5 ? 'done' : 'warn'}
        label="雷達測速上限"
        detail={!c ? '連線後讀取' : c.radialLimitMps > 3.5 ? `VMAX ${c.radialLimitMps.toFixed(2)} m/s（已調高）` : `VMAX ${c.radialLimitMps.toFixed(2)} m/s，需實車驗收（上手文件 §10.1）`}
        onClick={() => {
          goTab('settings');
          // 換頁後再捲到「裝置參數」
          setTimeout(() => scrollToId('device'), 120);
        }}
      />
      <Item
        state={s.wheel === null ? 'optional' : s.wheel ? 'done' : 'optional'}
        label="輪速感測器（選用）"
        detail={s.wheel ? '有資料，可做輪速校正與精度驗證' : '沒接也能用；接了可以驗證精度'}
        onClick={() => scrollToId('agreement')}
      />
    </ListGroup>
  );
}
