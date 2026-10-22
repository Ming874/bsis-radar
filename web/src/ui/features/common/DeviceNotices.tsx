/**
 * 【UI 層】裝置提示：只在需要使用者處理時出現（韌體過舊、雷達離線、朝向可能設反、超過測速上限…）。
 */
import { useShallow } from 'zustand/react/shallow';
import { radarStore, useRadar, useSettings } from '../../../application/container';
import { WRONG_DIRECTION_HINT_PCT, firmwareMismatch } from '../../../application/selectors';
import { FIRMWARE_MAJOR, unambiguousGroundMps } from '../../../domain/protocol';
import { kmhToMps } from '../../../domain/units';
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
      state: r.telemetry?.state ?? null,
      wrongDirPct: r.telemetry?.wrongDirPct ?? 0,
      unambiguousMps: r.config ? unambiguousGroundMps(r.config.radialLimitMps, r.config.angleDeg, r.config.calibration) : null,
    })),
  );
  const limit = useSettings(useShallow((x) => ({ on: x.speedAlert, kmh: x.speedLimitKmh })));
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
      <Notice key="radar" tone="bad" title="雷達離線">
        ESP32 收不到 C4001 的資料，正在自動重新設定（剛改過安裝參數時約需 4 秒）。若持續，請檢查雷達的電源與 TX／RX 接線。
      </Notice>,
    );
  }
  if (s.state === 'overRange') {
    notices.push(
      <Notice key="over" tone="bad" title="超出雷達測速上限">
        徑向速度接近 VMAX，雷達讀值不可靠。降低車速後會自動恢復；若在一般車速就出現，請到「數據」頁確認 C4001 的實際上限並調整 VMAX。
        {limit.on &&
          (s.unambiguousMps !== null && s.unambiguousMps >= kmhToMps(limit.kmh)
            ? ` 雷達的上限高於速限 ${limit.kmh} km/h，這時一定已經超速。`
            : ` 這時無法判斷是否超過速限 ${limit.kmh} km/h。`)}
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
          <Button size="sm" onClick={() => void radarStore.getState().sendCommand({ type: 'direction', dir: next })}>
            改成「雷達{next === 1 ? '朝後' : '朝前'}」
          </Button>
        }
      >
        雷達朝向（DIR）可能設反，或前方有迎面移動的物體。若車子確實在前進，請切換朝向。
      </Notice>,
    );
  }
  if (notices.length === 0) return null;
  return <div className="mb-4 flex flex-col gap-3">{notices}</div>;
}
