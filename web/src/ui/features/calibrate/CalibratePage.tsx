/**
 * 【校正】設定進度、安裝幾何、後方雷達。
 */
import { PageHeader } from '../../shell/PageHeader';
import { DeviceNotices } from '../common/DeviceNotices';
import { MountPanel } from './MountPanel';
import { RearPanel } from './RearPanel';
import { SetupChecklist } from './SetupChecklist';

export function CalibratePage() {
  return (
    <>
      <PageHeader title="校正" description="設定雷達的安裝幾何，確認後方雷達的偵測範圍" />
      <DeviceNotices />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <SetupChecklist />
          <MountPanel />
        </div>
        <div className="grid gap-6">
          <RearPanel />
        </div>
      </div>
    </>
  );
}
