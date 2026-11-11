/**
 * 【UI 層】裝置提示：只在需要使用者處理時出現（韌體過舊、雷達離線、測速雷達只接收、朝向可能設反…）。
 */
import { useShallow } from 'zustand/react/shallow';
import { radarStore, useRadar } from '../../../application/container';
import { WRONG_DIRECTION_HINT_PCT, firmwareMismatch } from '../../../application/selectors';
import { FIRMWARE_MAJOR } from '../../../domain/protocol';
import { Button, Notice } from '../../kit';

export function DeviceNotices() {
  const s = useRadar(
    useShallow((r) => ({
      connected: r.connection.status === 'connected',
      legacy: r.legacyFirmware,
      firmware: r.config?.firmware,
      direction: r.config?.direction ?? null,
      stale: r.stale,
      radarOnline: r.telemetry?.radarOnline ?? null,
      receiveOnly: r.telemetry?.receiveOnly ?? false,
      wrongDirPct: r.telemetry?.wrongDirPct ?? 0,
    })),
  );
  if (!s.connected) return null;

  const notices = [];
  if (s.legacy) {
    notices.push(
      <Notice key="legacy" tone="bad" title={`裝置執行舊版韌體 v${s.legacy}（後方來車偵測版）`}>
        這個網頁需要對地測速韌體 {FIRMWARE_MAJOR}.x。請在電腦上雙擊 firmware/flash.bat 燒錄新版，設定會自動改用新的預設值。
      </Notice>,
    );
  } else if (firmwareMismatch(s.firmware)) {
    notices.push(
      <Notice key="mismatch" tone="warn" title={`韌體 v${s.firmware} 與網頁版本不一致`}>
        部分欄位可能無法顯示。建議燒錄與網頁相同主版本（{FIRMWARE_MAJOR}.x）的韌體。
      </Notice>,
    );
  }
  if (s.stale) {
    notices.push(
      <Notice key="stale" tone="bad" title="資料中斷">
        超過 1.5 秒沒有收到 ESP32 的資料。確認 ESP32 有電、距離手機不要太遠。
      </Notice>,
    );
  } else if (s.radarOnline === false) {
    notices.push(
      <Notice key="radar" tone="bad" title="測速雷達離線">
        ESP32 收不到測速雷達（LD2451）的資料，正在自動重新尋找（約 5～30 秒重試一次）。若持續，請檢查雷達的 5 V 電源、GND，以及 TX → GPIO16、RX → GPIO17 的接線。
      </Notice>,
    );
  } else if (s.receiveOnly) {
    notices.push(
      <Notice key="ro" tone="warn" title="測速雷達只接收，設定寫不進去">
        收得到測速雷達的資料，但指令沒有回覆（LD2451 RX 沒接到 GPIO17）。雷達會照它自己存的設定輸出；如果它被設成「只回報靠近」，就量不到朝後遠離的路面。請把 LD2451 RX 接到 GPIO17。
      </Notice>,
    );
  }
  if (s.wrongDirPct >= WRONG_DIRECTION_HINT_PCT && s.direction !== null) {
    const next = s.direction === 1 ? -1 : 1;
    notices.push(
      <Notice
        key="dir"
        tone="warn"
        title="多數資料框的速度方向與設定相反"
        action={
          <Button size="sm" variant="tinted" onClick={() => void radarStore.getState().sendCommand({ type: 'direction', dir: next })}>
            改成「雷達{next === 1 ? '朝後' : '朝前'}」
          </Button>
        }
      >
        雷達朝向（DIR）可能設反，或雷達一直看到朝它靠近的物體（例如後方來車）。若車子確實在前進，請切換朝向。
      </Notice>,
    );
  }
  if (notices.length === 0) return null;
  return <div className="mb-4 flex flex-col gap-2.5">{notices}</div>;
}
