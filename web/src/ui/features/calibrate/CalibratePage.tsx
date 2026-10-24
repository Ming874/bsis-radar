/**
 * 【校正】設定進度、安裝幾何、校正係數、精度驗證。
 */
import { PageHeader } from '../../shell/PageHeader';
import { DeviceNotices } from '../common/DeviceNotices';
import { AgreementPanel } from './AgreementPanel';
import { CalibrationPanel } from './CalibrationPanel';
import { MountPanel } from './MountPanel';
import { SetupChecklist } from './SetupChecklist';

export function CalibratePage() {
  return (
    <>
      <PageHeader title="校正" description="先設定安裝幾何，再用已知距離或輪速感測器校正；精度驗證即時比對雷達與輪速" />
      <DeviceNotices />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <SetupChecklist />
          <MountPanel />
        </div>
        <div className="grid gap-6">
          <CalibrationPanel />
          <AgreementPanel />
        </div>
      </div>
    </>
  );
}
