/**
 * 【應用層】組裝根（Composition Root）：唯一知道「具體實作」的地方。
 *
 * UI 只從這裡拿 hook 與動作；要換成別的連線方式或在測試中注入假物件，只需要改這個檔案。
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { buildBackup, parseBackup } from '../domain/backup';
import { unambiguousGroundMps } from '../domain/protocol';
import { rearSpeech } from '../domain/rear';
import { isSavedTrip, type SavedTrip } from '../domain/trip';
import { fileStamp, formatDistance, kmhToMps } from '../domain/units';
import { AlertOutput } from '../infrastructure/alertOutput';
import { pwaStore, type PwaState } from '../infrastructure/pwa/pwa';
import { CsvRecorder, downloadText, traceCsv, tripsCsv } from '../infrastructure/storage/csv';
import { loadJson, saveJson } from '../infrastructure/storage/localStore';
import { DemoTransport, demoTrips } from '../infrastructure/transport/DemoTransport';
import { WebBluetoothTransport, isWebBluetoothAvailable } from '../infrastructure/transport/WebBluetoothTransport';
import { WakeLockManager } from '../infrastructure/wakeLock';
import { BRAVE_BLUETOOTH_HELP, describeAck } from './messages';
import { createOverspeedStore, type OverspeedStore } from './overspeedStore';
import { createRadarStore, type RadarStore } from './radarStore';
import { createRearAlertStore, type RearAlertStore } from './rearAlertStore';
import { SETTINGS_STORAGE_KEY, createSettingsStore, pickSettings, settingsSnapshot, type SettingsStore } from './settingsStore';
import { createToastStore, type ToastStore } from './toastStore';
import { createTripStore, type CurrentTripRecord, type TripStore } from './tripStore';

export { BRAVE_BLUETOOTH_HELP, pwaStore };

const TRIPS_KEY = 'bsis.trips.v1';
const CURRENT_TRIP_KEY = 'bsis.trip.current.v1';
/** 網頁 3.1 以前的校正紀錄（網頁已經不做校正）：只在清除資料時一起刪掉 */
const LEGACY_CALIBRATION_KEY = 'bsis.calibration.v1';

/** 正在清除這台裝置的資料（重新載入前不要再存本次行程） */
let clearing = false;
const LOCAL_KEYS = [SETTINGS_STORAGE_KEY, TRIPS_KEY, CURRENT_TRIP_KEY, LEGACY_CALIBRATION_KEY];

const wakeLock = new WakeLockManager();
const alertOutput = new AlertOutput();
const now = () => Date.now();

/** 示範模式（網址加上 ?demo）：不需要硬體，用模擬的遙測展示所有畫面 */
export const isDemo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
/** 截圖模式（?screenshot，文件截圖用）：不跳安裝提醒與新版本通知 */
export const isScreenshot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('screenshot');

export const settingsStore: StoreApi<SettingsStore> = createSettingsStore();
export const toastStore: StoreApi<ToastStore> = createToastStore();

export interface UiState {
  /** 騎乘模式開著：保持螢幕常亮、不跳安裝提醒 */
  ride: boolean;
  /** 從任何一頁都能打開的面板 */
  sheet: 'connection' | 'install' | null;
}

/** 畫面層級的狀態 */
export const uiStore = createStore<UiState>()(() => ({ ride: false, sheet: null }));
export const openSheet = (sheet: UiState['sheet']) => uiStore.setState({ sheet });

export const radarStore: StoreApi<RadarStore> = createRadarStore({
  createBluetooth: () =>
    isDemo ? new DemoTransport() : new WebBluetoothTransport({ autoReconnect: () => settingsStore.getState().autoReconnect }),
  recorder: new CsvRecorder(),
  download: downloadText,
  now,
});

export const tripStore: StoreApi<TripStore> = createTripStore({
  now,
  // 示範模式用模擬的行程紀錄，也不存（不要混進真的紀錄）
  loadTrips: () => (isDemo ? demoTrips(now()) : loadJson<unknown[]>(TRIPS_KEY, []).filter(isSavedTrip)),
  saveTrips: (trips) => !isDemo && saveJson(TRIPS_KEY, trips),
  loadCurrent: () => (isDemo ? null : loadJson<unknown>(CURRENT_TRIP_KEY, null)),
  saveCurrent: (record: CurrentTripRecord | null) => {
    if (isDemo || clearing) return;
    if (record) saveJson(CURRENT_TRIP_KEY, record);
    else saveJson(CURRENT_TRIP_KEY, null);
  },
  speedLimitKmh: () => {
    const s = settingsStore.getState();
    return s.speedAlert ? s.speedLimitKmh : null;
  },
});

/** 超速時依設定響兩聲、震動 */
export const overspeedStore: StoreApi<OverspeedStore> = createOverspeedStore({
  alert: () => {
    const s = settingsStore.getState();
    if (s.alertSound) alertOutput.chime();
    if (s.alertVibrate) alertOutput.vibrate();
  },
});

/** 後方來車：依設定響（注意柔和兩聲、危險急促四聲）、震動、語音 */
export const rearAlertStore: StoreApi<RearAlertStore> = createRearAlertStore({
  cue: (cue) => {
    const s = settingsStore.getState();
    if (s.rearSound) alertOutput.rearChime(cue);
    if (s.rearVibrate) alertOutput.rearVibrate(cue);
    if (s.rearVoice) alertOutput.speak(rearSpeech(cue));
  },
});

export const useRadar = <T>(selector: (s: RadarStore) => T): T => useStore(radarStore, selector);
export const useSettings = <T>(selector: (s: SettingsStore) => T): T => useStore(settingsStore, selector);
export const useToasts = <T>(selector: (s: ToastStore) => T): T => useStore(toastStore, selector);
export const useTrip = <T>(selector: (s: TripStore) => T): T => useStore(tripStore, selector);
export const useOverspeed = <T>(selector: (s: OverspeedStore) => T): T => useStore(overspeedStore, selector);
export const useRearAlert = <T>(selector: (s: RearAlertStore) => T): T => useStore(rearAlertStore, selector);
export const usePwa = <T>(selector: (s: PwaState) => T): T => useStore(pwaStore, selector);
export const useUi = <T>(selector: (s: UiState) => T): T => useStore(uiStore, selector);

const toast = (...args: Parameters<ToastStore['push']>) => toastStore.getState().push(...args);

export interface ImportSummary {
  trips: number;
  skipped: number;
}

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
    const saved = tripStore.getState().finish();
    if (saved) {
      const d = formatDistance(saved.distanceM);
      toast('success', '行程已儲存', `${d.value} ${d.unit}，在「行程」頁可以看速度曲線`);
    } else toast('info', '已開始新的行程', '不到 50 m 的行程不儲存');
  },
  /** 設定頁的「測試」：依目前設定響一次、震動一次（點擊當下呼叫，順便解鎖聲音） */
  previewAlert: async () => {
    const s = settingsStore.getState();
    if (s.alertVibrate) alertOutput.vibrate();
    if (s.alertSound) {
      await alertOutput.unlock();
      alertOutput.chime();
    }
  },
  /** 後方來車提示的「測試」 */
  previewRearAlert: async (cue: 'caution' | 'danger') => {
    const s = settingsStore.getState();
    if (s.rearVibrate) alertOutput.rearVibrate(cue);
    if (s.rearSound) {
      await alertOutput.unlock();
      alertOutput.rearChime(cue);
    }
    if (s.rearVoice) alertOutput.speak(rearSpeech(cue));
  },
  exportTripsCsv: () => {
    const trips = tripStore.getState().trips;
    if (trips.length === 0) return;
    downloadText(`bsis-trips_${fileStamp(now())}.csv`, tripsCsv(trips));
    toast('success', '已下載行程紀錄', `${trips.length} 筆`);
  },
  exportTraceCsv: (trip: SavedTrip) => {
    downloadText(`bsis-trip_${fileStamp(trip.startedAt)}.csv`, traceCsv(trip));
  },
  /** 備份這台裝置上的設定與行程 */
  exportBackup: () => {
    const file = buildBackup({ settings: { ...settingsSnapshot(settingsStore.getState()) }, trips: tripStore.getState().trips }, now(), __APP_VERSION__);
    downloadText(`bsis-backup_${fileStamp(now())}.json`, JSON.stringify(file), 'application/json');
    toast('success', '已下載備份檔', `${file.trips.length} 筆行程`);
  },
  /** 清除這台裝置上的設定與行程，然後重新載入 */
  clearLocalData: () => {
    clearing = true;
    try {
      LOCAL_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      // 讀不到就沒有東西要清
    }
    window.location.reload();
  },
  /** 匯入備份：設定取代、行程合併；檔案不對時回傳錯誤訊息 */
  importBackup: (text: string): ImportSummary | string => {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed.error;
    const { backup } = parsed;
    settingsStore.getState().update(pickSettings(backup.settings));
    const trips = tripStore.getState().importTrips(backup.trips);
    toast('success', '已匯入備份', `新增 ${trips} 筆行程${parsed.skipped ? `；略過 ${parsed.skipped} 筆格式不對的資料` : ''}`);
    return { trips, skipped: parsed.skipped };
  },
};

/** 這個瀏覽器支援哪些功能（UI 用來顯示提示或停用按鈕） */
export const capabilities = {
  bluetooth: isDemo || isWebBluetoothAvailable(),
  knownDevices: !isDemo && isWebBluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function',
  wakeLock: wakeLock.supported,
  alertSound: alertOutput.soundSupported,
  vibrate: alertOutput.vibrateSupported,
  speech: alertOutput.speechSupported,
  /** Brave 預設關閉 Web Bluetooth（navigator.bluetooth 還在，但連線會被擋） */
  brave: !isDemo && typeof navigator !== 'undefined' && 'brave' in navigator,
  fullscreen: typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function',
};

let started = false;

/** 啟動背景服務：超速判斷、行程統計、保持螢幕常亮、狀態提示（只執行一次） */
export function startServices(): void {
  if (started) return;
  started = true;

  const syncWakeLock = () => {
    const status = radarStore.getState().connection.status;
    const active = status === 'connected' || status === 'connecting' || status === 'reconnecting' || uiStore.getState().ride;
    wakeLock.setEnabled(active && settingsStore.getState().keepAwake);
  };
  settingsStore.subscribe((s, prev) => {
    if (s.keepAwake !== prev.keepAwake) syncWakeLock();
    if (s.speedAlert !== prev.speedAlert || s.speedLimitKmh !== prev.speedLimitKmh) overspeedStore.getState().reset();
    if (s.rearAlert !== prev.rearAlert) rearAlertStore.getState().reset();
  });
  uiStore.subscribe((s, prev) => s.ride !== prev.ride && syncWakeLock());

  if (isDemo) void radarStore.getState().connectBluetooth(); // 示範模式直接「連上」模擬裝置

  // 上次沒結束的行程：接續或自動存進紀錄，提示一次
  const trip = tripStore.getState();
  if (trip.resumed) {
    const d = formatDistance(trip.current.distanceM);
    toast('info', '接續上次的行程', `已累計 ${d.value} ${d.unit}；要重新開始請按「結束行程」`);
  } else if (trip.autoSaved) {
    toast('info', '上次的行程已存進紀錄', '超過 2 小時沒有接續，這次從 0 開始');
  }

  // 網頁被關掉、切到背景：馬上存本次行程；正在記錄 CSV 時離開要確認
  const persist = () => tripStore.getState().persist();
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && persist());
  window.addEventListener('beforeunload', (e) => {
    if (radarStore.getState().recording.active) e.preventDefault();
  });

  radarStore.subscribe((s, prev) => {
    if (s.telemetry && s.telemetry !== prev.telemetry) {
      const settings = settingsStore.getState();
      if (settings.speedAlert) {
        const c = s.config;
        const unambiguous = c ? unambiguousGroundMps(c.radialLimitMps, c.angleDeg, c.calibration) : null;
        overspeedStore.getState().onTelemetry(s.telemetry, kmhToMps(settings.speedLimitKmh), unambiguous);
      }
      tripStore.getState().onTelemetry(s.telemetry, overspeedStore.getState().active);
    }
    if (s.rear && s.rear !== prev.rear) {
      if (settingsStore.getState().rearAlert) rearAlertStore.getState().onRear(s.rear);
      tripStore.getState().onRear(s.rear);
    }
    // 後方雷達資料中斷、斷線：下一次等級上升要重新提示
    if ((s.rearStale && !prev.rearStale) || (s.connection.status !== 'connected' && prev.connection.status === 'connected')) {
      rearAlertStore.getState().reset();
    }
    if (s.rear?.online === false && prev.rear?.online === true) {
      toast('warning', '後方雷達離線', 'ESP32 收不到 LD2451 的資料，正在重試');
    }
    // 沒有資料時不能說還在超速（速度頁另外顯示「資料中斷」）
    if ((s.stale && !prev.stale) || (s.connection.status !== 'connected' && prev.connection.status === 'connected')) {
      overspeedStore.getState().reset();
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
