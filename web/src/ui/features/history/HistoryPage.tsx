/**
 * 【紀錄】距離趨勢、實車測試記錄（CSV）、來車事件。電腦版分兩欄：左邊趨勢與記錄、右邊事件列表。
 */
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { actions, radarStore, useRadar } from '../../../application/container';
import type { AlertLevel, ApproachEvent } from '../../../domain/types';
import { formatClock, formatDistance, formatDuration, formatSeconds, mpsToKmh } from '../../../domain/units';
import { APP_HELP, VALUE_HELP } from '../../content/help';
import { useNow } from '../../hooks/useNow';
import {
  AlertIcon,
  Badge,
  Button,
  ConfirmSheet,
  DownloadIcon,
  HelpButton,
  ListRow,
  PageHeader,
  RecordIcon,
  Section,
  StopIcon,
  TrashIcon,
  type Tone,
} from '../../kit';
import { DistanceChart } from '../../widgets/DistanceChart';

const LEVEL: Record<AlertLevel, { text: string; tone: Tone }> = {
  0: { text: '安全', tone: 'safe' },
  1: { text: '注意', tone: 'caution' },
  2: { text: '危險', tone: 'danger' },
};

function eventSummary(e: ApproachEvent): string {
  const parts = [`持續 ${e.durationS.toFixed(1)} 秒`, `最近 ${formatDistance(e.minDistanceM)} m`];
  if (e.maxClosingMps !== null) parts.push(`最快 ${mpsToKmh(e.maxClosingMps).toFixed(0)} km/h`);
  if (e.minTtcS !== null) parts.push(`TTC ${formatSeconds(e.minTtcS)} 秒`);
  return parts.join('・');
}

function RecordingRow() {
  const { recording, connected } = useRadar(
    useShallow((s) => ({ recording: s.recording, connected: s.connection.status === 'connected' })),
  );
  const now = useNow();
  const elapsed = recording.startedAt === null ? 0 : Math.max(0, (now - recording.startedAt) / 1000);

  return recording.active ? (
    <ListRow
      icon={<RecordIcon />}
      tone="danger"
      title={`記錄中 ${formatDuration(elapsed)}`}
      description={`已記錄 ${recording.rows.toLocaleString()} 筆`}
      accessory={
        <Button size="sm" variant="destructive" onClick={() => actions.stopRecording()}>
          <StopIcon className="h-4 w-4" />
          停止並下載
        </Button>
      }
    />
  ) : (
    <ListRow
      icon={<RecordIcon />}
      tone="neutral"
      title="記錄原始資料"
      description={connected ? APP_HELP.recording.short : '連線後才能記錄'}
      accessory={
        <Button size="sm" variant="primary" disabled={!connected} onClick={() => radarStore.getState().startRecording()}>
          開始
        </Button>
      }
    />
  );
}

export function HistoryPage() {
  const { history, warnRangeM, events } = useRadar(
    useShallow((s) => ({ history: s.history, warnRangeM: s.config?.warnRangeM ?? 15, events: s.events })),
  );
  const [confirmClear, setConfirmClear] = useState(false);
  const closeConfirm = useCallback(() => setConfirmClear(false), []);

  return (
    <div className="space-y-6">
      <PageHeader title="紀錄" subtitle="距離趨勢、實車測試資料與來車事件" />

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Section
            title="距離趨勢（最近 60 秒）"
            action={<HelpButton help={VALUE_HELP.chart} />}
            footer={`黃色虛線 = 警示距離 ${warnRangeM} m；彩色點 = 當時正在警示`}
          >
            <div className="px-2 pt-3 pb-1">
              <DistanceChart points={history} warnRangeM={warnRangeM} />
            </div>
          </Section>

          <Section title="實車測試" action={<HelpButton help={APP_HELP.recording} />} footer="停止後會自動下載 CSV，可用 Excel 計算偵測成功率。">
            <RecordingRow />
          </Section>
        </div>

        <div className="lg:col-span-5">
          <Section
            title={`來車事件（${events.length}）`}
            action={<HelpButton help={APP_HELP.events} />}
            footer={events.length > 0 ? '事件保存在這個瀏覽器裡，最多 200 筆。' : undefined}
          >
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-body font-semibold text-ink">還沒有紀錄</p>
                <p className="mt-1 text-callout text-ink-2">有來車警示時，會自動把每一次記成一筆。</p>
              </div>
            ) : (
              <>
                {events.map((e) => {
                  const level = LEVEL[e.maxLevel];
                  return (
                    <ListRow
                      key={e.id}
                      icon={<AlertIcon />}
                      tone={level.tone}
                      title={<span className="tabular">{formatClock(e.startedAt)}</span>}
                      description={eventSummary(e)}
                      accessory={<Badge tone={level.tone}>{level.text}</Badge>}
                    />
                  );
                })}
                <ListRow icon={<DownloadIcon />} title="匯出 CSV" onClick={() => actions.exportEvents()} />
                <ListRow icon={<TrashIcon />} destructive title="清除全部事件" onClick={() => setConfirmClear(true)} />
              </>
            )}
          </Section>
        </div>
      </div>

      {confirmClear && (
        <ConfirmSheet
          title="清除全部來車事件？"
          message="會刪除這個瀏覽器保存的所有來車事件，無法復原。需要的話請先匯出 CSV。"
          confirmLabel="清除"
          destructive
          onConfirm={() => actions.clearEvents()}
          onClose={closeConfirm}
        />
      )}
    </div>
  );
}
