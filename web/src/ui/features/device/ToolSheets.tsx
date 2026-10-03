/**
 * 【裝置】工具面板：指令主控台、校正步驟。
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { radarStore, useRadar } from '../../../application/container';
import { formatClock } from '../../../domain/units';
import { Button, Sheet, Switch } from '../../kit';

export function ConsoleSheet({ onClose }: { onClose: () => void }) {
  const { entries, connected } = useRadar(
    useShallow((s) => ({ entries: s.console, connected: s.connection.status === 'connected' })),
  );
  const [hideTelemetry, setHideTelemetry] = useState(true);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const visible = useMemo(
    () => (hideTelemetry ? entries.filter((e) => !(e.dir === 'in' && e.text.startsWith('R='))) : entries),
    [entries, hideTelemetry],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight; // 新訊息自動捲到底
  }, [visible]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const line = text.trim();
    if (!line) return;
    void radarStore.getState().sendRaw(line);
    setText('');
  };

  return (
    <Sheet
      title="指令主控台"
      description="直接看 ESP32 送來的文字、手動送指令（輸入 HELP 查看全部指令）"
      onClose={onClose}
      tall
      footer={
        <form onSubmit={submit} className="flex w-full gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={connected ? '例如 GET、HELP、RANGE 12' : '連線後才能送指令'}
            aria-label="要送出的指令"
            autoCapitalize="characters"
            autoComplete="off"
            disabled={!connected}
            className="h-11 min-w-0 flex-1 rounded-control bg-fill px-3 font-mono text-body text-ink outline-none focus:ring-2 focus:ring-accent"
          />
          <Button type="submit" variant="primary" disabled={!connected || text.trim() === ''}>
            送出
          </Button>
        </form>
      }
    >
      <div className="flex h-full flex-col gap-3">
        <label className="flex items-center justify-between gap-3 text-body text-ink">
          <span>
            隱藏遙測資料
            <span className="block text-caption text-ink-3">遙測每秒 5 行，隱藏後容易看到設定與回覆</span>
          </span>
          <Switch label="隱藏遙測資料" checked={hideTelemetry} onChange={setHideTelemetry} />
        </label>
        <ol
          ref={listRef}
          aria-label="收發紀錄"
          className="min-h-48 flex-1 overflow-y-auto rounded-card bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-100"
        >
          {visible.length === 0 && <li className="text-slate-500">（還沒有訊息）</li>}
          {visible.map((e) => (
            <li key={e.id} className={e.dir === 'out' ? 'text-sky-300' : e.dir === 'info' ? 'text-amber-300' : ''}>
              <span className="text-slate-500">{formatClock(e.at)} </span>
              {e.dir === 'out' ? '→ ' : e.dir === 'in' ? '← ' : '• '}
              {e.text}
            </li>
          ))}
        </ol>
        <p className="flex gap-4 text-caption text-ink-3">
          <span>→ 網頁送出</span>
          <span>← ESP32 回覆</span>
          <span>• 系統訊息</span>
        </p>
      </div>
    </Sheet>
  );
}

const GUIDE = [
  '模式選「室內測試」，請一個人從約 6 m 外走近雷達：畫面應出現「注意」，靠近 4 m 內變「危險」。',
  '如果走近不警示、後退才警示，把「接近方向」改成「正 = 接近」。',
  '記下人走近時的「10 秒內最大能量」；再請同學騎機車從後方經過，也記下能量。',
  '把「反射能量門檻」設在兩個數字中間。',
  '模式切回「上路」，到空曠場地做實車測試，並在「紀錄」頁記錄 CSV。',
];

export function GuideSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="校正步驟"
      description="第一次使用或換了安裝位置時，照這個順序做一次"
      onClose={onClose}
      footer={
        <Button variant="primary" block onClick={onClose}>
          開始校正
        </Button>
      }
    >
      <ol className="space-y-4 pt-2">
        {GUIDE.map((s, i) => (
          <li key={s} className="flex gap-3 text-body leading-relaxed text-ink">
            <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-callout font-bold text-accent">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
