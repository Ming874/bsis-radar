/**
 * 【校正】設定進度：照著做完就能上路。每一項都由裝置目前的狀態判斷（不是自己勾的），點了捲到對應的區塊。
 */
import { useShallow } from 'zustand/react/shallow';
import { openSheet, useRadar } from '../../../application/container';
import { DEFAULT_CONFIG, FIRMWARE_MAJOR } from '../../../domain/protocol';
import { AlertIcon, CheckCircleIcon, CircleIcon, ListGroup, Row, cx, type IconProps } from '../../kit';
import { goTab } from '../../shell/tabs';
import type { ComponentType } from 'react';

type State = 'done' | 'todo' | 'warn';

const ICON: Record<State, { Icon: ComponentType<IconProps>; color: string }> = {
  done: { Icon: CheckCircleIcon, color: 'text-ok' },
  todo: { Icon: CircleIcon, color: 'text-faint' },
  warn: { Icon: AlertIcon, color: 'text-warn' },
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
      radarOnline: r.connection.status === 'connected' && r.telemetry ? r.telemetry.radarOnline : null,
      receiveOnly: r.telemetry?.receiveOnly ?? false,
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
        detail={ready ? `韌體 v${c.firmware}` : s.legacy ? `韌體 v${s.legacy} 過舊，請燒錄 ${FIRMWARE_MAJOR}.x` : '按這裡連線 BSIS-Speed'}
        onClick={() => openSheet('connection')}
      />
      <Item
        state={!c ? 'todo' : mountDefault ? 'warn' : 'done'}
        label="安裝幾何"
        detail={!c ? '連線後讀取' : `${c.angleDeg.toFixed(1)}° · ${c.heightM.toFixed(2)} m · ${c.direction === 1 ? '朝後' : '朝前'}${mountDefault ? '（預設值，請實際量測）' : ''}`}
        onClick={() => scrollToId('mount')}
      />
      <Item
        state={s.radarOnline === null ? 'todo' : s.radarOnline && !s.receiveOnly ? 'done' : 'warn'}
        label="測速雷達"
        detail={
          s.radarOnline === null
            ? '連線後讀取'
            : !s.radarOnline
              ? '離線：檢查 5 V 與 GPIO16／17 接線'
              : s.receiveOnly
                ? '只接收：LD2451 RX 沒接到 GPIO17，設定寫不進去'
                : '在線，偵測設定已寫入雷達'
        }
        onClick={() => goTab('data')}
      />
    </ListGroup>
  );
}
