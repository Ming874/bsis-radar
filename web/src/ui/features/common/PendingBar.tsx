/**
 * 【UI 層】還沒套用的裝置參數：浮在畫面下方（手機在分頁列上面），捲到哪裡都按得到「套用到裝置」。
 * 放在卡片最後面，卡片捲出畫面後就跟著離開（sticky）。
 */
import { Button } from '../../kit';

export function PendingBar({ count, valid, applying, onReset, onApply }: { count: number; valid: boolean; applying: boolean; onReset: () => void; onApply: () => void }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 px-3 pb-3 lg:bottom-4">
      <div className="chrome flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate text-footnote font-medium text-ink">{valid ? `${count} 項變更尚未套用` : '有數值超出範圍'}</span>
        <Button size="sm" variant="plain" onClick={onReset}>
          還原
        </Button>
        <Button size="sm" variant="primary" disabled={!valid || applying} onClick={onApply}>
          {applying ? '套用中…' : '套用到裝置'}
        </Button>
      </div>
    </div>
  );
}
