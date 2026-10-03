/**
 * 【外框】危險時畫面四周泛起柔和的紅色光暈並呼吸閃爍（設定可關閉），不會擋住內容。
 */
import { useRadar, useSettings } from '../../application/container';

export function DangerFlash() {
  const enabled = useSettings((s) => s.flashScreen);
  const danger = useRadar(
    (s) => s.connection.status === 'connected' && !s.stale && s.telemetry?.radarOnline === true && s.telemetry.level === 2,
  );
  if (!enabled || !danger) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 shadow-[inset_0_0_90px_24px_rgb(255_59_48/0.6)] motion-safe:animate-edge-glow"
    />
  );
}
