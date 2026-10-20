/**
 * 【應用層】組裝根（Composition Root）：唯一知道「具體實作」的地方。
 *
 * UI 只從這裡拿 hook 與動作；要換成別的連線方式或在測試中注入假物件，只需要改這個檔案。
 */
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { checkCalibration, roundCalibration } from '../domain/calibration';
import { CsvRecorder, downloadText } from '../infrastructure/storage/csv';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';
import { DemoTransport } from '../infrastructure/transport/DemoTransport';
import { WebBluetoothTransport, isWebBluetoothAvailable } from '../infrastructure/transport/WebBluetoothTransport';
import { WakeLockManager } from '../infrastructure/wakeLock';
import { createCalibrationStore, type CalibrationState, type CalibrationStore } from './calibrationStore';
import { BRAVE_BLUETOOTH_HELP, describeAck } from './messages';
import { createRadarStore, type RadarStore } from './radarStore';
import { createSettingsStore, type SettingsStore } from './settingsStore';
import { createToastStore, type ToastStore } from './toastStore';
import { createTripStore, type SavedTrip, type TripStore } from './tripStore';

export { BRAVE_BLUETOOTH_HELP };

const TRIPS_KEY = 'bsis.trips.v1';
const CALIBRATION_KEY = 'bsis.calibration.v1';

const wakeLock = new WakeLockManager();
const now = () => Date.now();

/** 示範模式（網址加上 ?demo）：不需要硬體，用模擬的遙測展示所有畫面 */
export const isDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

export const settingsStore: StoreApi<SettingsStore> = createSettingsStore();
export const toastStore: StoreApi<ToastStore> = createToastStore();

export const radarStore: StoreApi<RadarStore> = createRadarStore({
  createBluetooth: () =>
    isDemo ? new DemoTransport() : new WebBluetoothTransport({ autoReconnect: () => settingsStore.getState().autoReconnect }),
  recorder: new CsvRecorder(),
  download: downloadText,
  now,
});

export const tripStore: StoreApi<TripStore> = createTripStore({
  now,
  loadTrips: () => loadJson<SavedTrip[]>(TRIPS_KEY, []),
  saveTrips: (trips) => saveJson(TRIPS_KEY, trips),
});

export const calibrationStore: StoreApi<CalibrationStore> = createCalibrationStore({
  now,
  load: () => loadJson<Pick<CalibrationState, 'runs' | 'lastApplied'>>(CALIBRATION_KEY, { runs: [], lastApplied: null }),
  save: (data) => saveJson(CALIBRATION_KEY, data),
});

export const useRadar = <T>(selector: (s: RadarStore) => T): T => useStore(radarStore, selector);
export const useSettings = <T>(selector: (s: SettingsStore) => T): T => useStore(settingsStore, selector);
export const useToasts = <T>(selector: (s: ToastStore) => T): T => useStore(toastStore, selector);
export const useTrip = <T>(selector: (s: TripStore) => T): T => useStore(tripStore, selector);
export const useCalibration = <T>(selector: (s: CalibrationStore) => T): T => useStore(calibrationStore, selector);

const toast = (...args: Parameters<ToastStore['push']>) => toastStore.getState().push(...args);

/** 由按鈕觸發、需要提示的操作 */
export const actions = {
  connect: () => radarStore.getState().connectBluetooth(),
  reconnectKnownDevice: async () => {
    const ok = await radarStore.getState().reconnectKnownDevice();
    if (!ok && !radarStore.getState().error) toast('info', '找不到上次的裝置', '請按「連線」重新選擇 BSIS-Speed');
  },
  disconnect: () => radarStore.getState().disconnect(),
  stopRecording: () => {
    const rows = radarStore.getState().recording.rows;
    radarStore.getState().stopRecording();
    if (rows > 0) toast('success', '已下載 CSV', `${rows} 筆資料框`);
    else toast('info', '沒有資料可以下載', '記錄期間沒有收到資料框');
  },
  finishTrip: () => {
    tripStore.getState().finish();
    toast('info', '已開始新的行程');
  },
  /** 套用校正係數；回傳是否成功送出 */
  applyCalibration: async (next: number): Promise<boolean> => {
    const config = radarStore.getState().config;
    if (!config) return false;
    const value = roundCalibration(next);
    if (checkCalibration(config.calibration, value) === 'outOfRange') {
      toast('error', '校正係數超出範圍', '必須介於 0.5 ～ 2.0；請檢查安裝角度與雷達朝向');
      return false;
    }
    const ok = await radarStore.getState().sendCommand({ type: 'calibration', factor: value });
    if (ok) calibrationStore.getState().markApplied(config.calibration, value);
    return ok;
  },
};

/** 這個瀏覽器支援哪些功能（UI 用來顯示提示或停用按鈕） */
export const capabilities = {
  bluetooth: isDemo || isWebBluetoothAvailable(),
  knownDevices: !isDemo && isWebBluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function',
  wakeLock: wakeLock.supported,
  /** Brave 預設關閉 Web Bluetooth（navigator.bluetooth 還在，但連線會被擋） */
  brave: !isDemo && typeof navigator !== 'undefined' && 'brave' in navigator,
};

let started = false;

/** 啟動背景服務：行程與校正統計、保持螢幕常亮、狀態提示（只執行一次） */
export function startServices(): void {
  if (started) return;
  started = true;

  const syncWakeLock = () => {
    const status = radarStore.getState().connection.status;
    const active = status === 'connected' || status === 'connecting' || status === 'reconnecting';
    wakeLock.setEnabled(active && settingsStore.getState().keepAwake);
  };
  settingsStore.subscribe((s, prev) => {
    if (s.keepAwake !== prev.keepAwake) syncWakeLock();
  });

  if (isDemo) void radarStore.getState().connectBluetooth(); // 示範模式直接「連上」模擬裝置

  radarStore.subscribe((s, prev) => {
    if (s.telemetry && s.telemetry !== prev.telemetry) {
      tripStore.getState().onTelemetry(s.telemetry);
      calibrationStore.getState().onTelemetry(s.telemetry, s.config?.calibration ?? null);
    }
    if (s.connection.status !== prev.connection.status) {
      syncWakeLock();
      if (s.connection.status === 'connected') toast('success', '已連線', s.connection.deviceName);
      else if (s.connection.status === 'reconnecting') toast('warning', '藍牙連線中斷', '正在自動重新連線');
      else if (s.connection.status === 'idle' && prev.connection.status === 'connected') toast('info', '已中斷連線');
    }
    if (s.legacyFirmware && s.legacyFirmware !== prev.legacyFirmware) {
      toast('error', '韌體版本過舊', `裝置執行 v${s.legacyFirmware}（後方來車偵測版），請燒錄 3.0 以上的對地測速韌體`);
    }
    if (s.lastAck && s.lastAck !== prev.lastAck) {
      toast(s.lastAck.ok ? 'success' : 'error', s.lastAck.ok ? 'ESP32 已確認' : 'ESP32 拒絕了這個設定', describeAck(s.lastAck.ok, s.lastAck.message));
    }
    if (s.error && s.error !== prev.error) {
      toast('error', '發生問題', s.error);
      radarStore.getState().clearError();
    }
  });
}
