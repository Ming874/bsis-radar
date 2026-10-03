/**
 * 【應用層】組裝根（Composition Root）：唯一知道「具體實作」的地方。
 *
 * UI 只從這裡拿 hook 與動作；要換成別的連線方式或在測試中注入假物件，只需要改這個檔案。
 */
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { ApproachEvent } from '../domain/types';
import { AlertPlayer } from '../infrastructure/alerts/AlertPlayer';
import { CsvRecorder, downloadText } from '../infrastructure/storage/csv';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';
import { WebBluetoothTransport, isWebBluetoothAvailable } from '../infrastructure/transport/WebBluetoothTransport';
import { WakeLockManager } from '../infrastructure/wakeLock';
import { playTestAlert, startAlertController } from './alertController';
import { BRAVE_BLUETOOTH_HELP, describeAck } from './messages';

export { BRAVE_BLUETOOTH_HELP };
import { createRadarStore, type RadarStore } from './radarStore';
import { createSettingsStore, type SettingsStore } from './settingsStore';
import { createToastStore, type ToastStore } from './toastStore';

const EVENTS_KEY = 'radarA.events';

const player = new AlertPlayer();
const wakeLock = new WakeLockManager();

export const settingsStore: StoreApi<SettingsStore> = createSettingsStore();
export const toastStore: StoreApi<ToastStore> = createToastStore();

export const radarStore: StoreApi<RadarStore> = createRadarStore({
  createBluetooth: () => new WebBluetoothTransport({ autoReconnect: () => settingsStore.getState().autoReconnect }),
  recorder: new CsvRecorder(),
  download: downloadText,
  loadEvents: () => loadJson<ApproachEvent[]>(EVENTS_KEY, []),
  saveEvents: (events) => saveJson(EVENTS_KEY, events),
  now: () => Date.now(),
});

export function useRadar<T>(selector: (s: RadarStore) => T): T {
  return useStore(radarStore, selector);
}

export function useSettings<T>(selector: (s: SettingsStore) => T): T {
  return useStore(settingsStore, selector);
}

export function useToasts<T>(selector: (s: ToastStore) => T): T {
  return useStore(toastStore, selector);
}

const toast = (...args: Parameters<ToastStore['push']>) => toastStore.getState().push(...args);

export const alerts = {
  /** 在使用者點擊時呼叫，解鎖聲音 */
  unlock: () => player.unlock(),
  test: () => playTestAlert(player, settingsStore.getState()),
};

/** 由按鈕觸發的操作：順便解鎖聲音（瀏覽器規定聲音要在點擊後才能播放），並給予提示 */
export const actions = {
  connectBluetooth: async () => {
    player.unlock();
    await radarStore.getState().connectBluetooth();
  },
  reconnectKnownDevice: async () => {
    player.unlock();
    const ok = await radarStore.getState().reconnectKnownDevice();
    if (!ok && !radarStore.getState().error) toast('info', '找不到上次的裝置', '請按「藍牙連線」重新選擇 RadarA-ESP32');
  },
  disconnect: () => radarStore.getState().disconnect(),
  stopRecording: () => {
    const rows = radarStore.getState().recording.rows;
    radarStore.getState().stopRecording();
    if (rows > 0) toast('success', '已下載 CSV', `共 ${rows} 筆資料，可用 Excel 開啟`);
    else toast('info', '沒有資料可以下載', '記錄期間沒有收到遙測');
  },
  exportEvents: () => {
    radarStore.getState().exportEvents();
    toast('success', '已匯出來車事件', 'CSV 檔已下載');
  },
  clearEvents: () => {
    radarStore.getState().clearEvents();
    toast('info', '已清除來車事件');
  },
};

/** 這個瀏覽器支援哪些功能（UI 用來顯示提示或停用按鈕） */
export const capabilities = {
  bluetooth: isWebBluetoothAvailable(),
  knownDevices: isWebBluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function',
  wakeLock: wakeLock.supported,
  vibration: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  speech: typeof speechSynthesis !== 'undefined',
  /** Brave 預設關閉 Web Bluetooth（navigator.bluetooth 還在，但連線會被擋） */
  brave: typeof navigator !== 'undefined' && 'brave' in navigator,
};

let started = false;

/** 啟動背景服務：警示控制、保持螢幕常亮、狀態提示（只執行一次） */
export function startServices(): void {
  if (started) return;
  started = true;
  startAlertController(radarStore, settingsStore, player);

  const syncWakeLock = () => {
    const status = radarStore.getState().connection.status;
    const active = status === 'connected' || status === 'connecting' || status === 'reconnecting';
    wakeLock.setEnabled(active && settingsStore.getState().keepAwake);
  };
  settingsStore.subscribe((s, prev) => {
    if (s.keepAwake !== prev.keepAwake) syncWakeLock();
  });

  radarStore.subscribe((s, prev) => {
    // 連線狀態改變
    if (s.connection.status !== prev.connection.status) {
      syncWakeLock();
      if (s.connection.status === 'connected') {
        toast('success', '已連線', s.connection.deviceName);
      } else if (s.connection.status === 'reconnecting') {
        toast('warning', '藍牙連線中斷', '正在自動重新連線，請確認 ESP32 有電且在附近');
      } else if (s.connection.status === 'idle' && prev.connection.status === 'connected') {
        toast('info', '已中斷連線');
      }
    }
    // ESP32 回覆 OK / ERR
    if (s.lastAck && s.lastAck !== prev.lastAck) {
      toast(s.lastAck.ok ? 'success' : 'error', s.lastAck.ok ? 'ESP32 已確認' : 'ESP32 拒絕了這個設定', describeAck(s.lastAck.ok, s.lastAck.message));
    }
    // 其他錯誤（連線失敗、送出失敗…）
    if (s.error && s.error !== prev.error) {
      toast('error', '發生問題', s.error);
      radarStore.getState().clearError();
    }
  });
}
