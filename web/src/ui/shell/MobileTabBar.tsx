/**
 * 【UI 層】手機的分頁列：浮在畫面底部的膠囊，選中的底色滑過去（百分比位移，五格一樣寬，不用量元素尺寸）。
 * - 正在打字（螢幕鍵盤開著）時收到下面去，位置讓給輸入框
 * - 點目前這一頁：捲回最上面
 * - 數據頁正在記錄 CSV、校正頁有一趟正在進行時，圖示旁有小點
 */
import { useEffect, useState } from 'react';
import { useCalibration, useRadar } from '../../application/container';
import { FOCUS_RING_INSET, cx, haptic } from '../kit';
import { TABS, goTab, type Tab } from './tabs';

/** 會叫出螢幕鍵盤的元素（輸入框、多行輸入框）；按鈕、開關不算 */
const isTextEntry = (el: Element | null) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(el.type)) ||
  (el instanceof HTMLElement && el.isContentEditable);

/** 觸控裝置上正在打字 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const sync = () => setTyping(isTextEntry(document.activeElement));
    // 焦點移到下一個元素之前 activeElement 是 body：等一下再看
    const later = () => setTimeout(sync, 0);
    window.addEventListener('focusin', sync);
    window.addEventListener('focusout', later);
    return () => {
      window.removeEventListener('focusin', sync);
      window.removeEventListener('focusout', later);
    };
  }, []);
  return typing;
}

export function MobileTabBar({ active }: { active: Tab }) {
  const typing = useTyping();
  const recording = useRadar((r) => r.recording.active);
  const calibrating = useCalibration((c) => c.session !== null || c.pending !== null);
  const index = TABS.findIndex((t) => t.id === active);
  const dot: Partial<Record<Tab, string>> = { data: recording ? 'bg-bad' : '', calibrate: calibrating ? 'bg-tint' : '' };

  return (
    <nav
      aria-label="主要分頁"
      data-hidden={typing ? '' : undefined}
      className="tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="chrome pointer-events-auto relative grid h-16 w-full max-w-md grid-cols-5 rounded-full p-[5px]">
        <span
          aria-hidden
          className="tab-lens pointer-events-none absolute top-[5px] bottom-[5px] left-[5px] rounded-full bg-tint-soft"
          style={{ width: `calc((100% - 10px) / ${TABS.length})`, transform: `translateX(${Math.max(index, 0) * 100}%)` }}
        />
        {TABS.map(({ id, label, Icon }) => {
          const current = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-current={current ? 'page' : undefined}
              onClick={() => {
                haptic();
                goTab(id);
              }}
              className={cx(
                'press relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold transition-colors',
                current ? 'text-tint' : 'text-muted',
                FOCUS_RING_INSET,
              )}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={current ? 2.2 : 1.9} />
                {dot[id] && <span aria-hidden className={cx('absolute -top-0.5 -right-1 h-2 w-2 rounded-full ring-2 ring-[var(--surface)]', dot[id])} />}
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
