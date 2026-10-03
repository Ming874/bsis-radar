/**
 * 【基礎設施層】Web Bluetooth 連線（Nordic UART Service）。
 *
 * - connect() 必須由使用者點擊觸發（瀏覽器規定）
 * - 意外斷線會自動重連：1、2、4、8、10、10… 秒
 * - 所有寫入排隊送出（Web Bluetooth 不允許同時進行兩個 GATT 操作）
 * - 通知可能被切成 20 bytes 的片段，用 LineAssembler 組回整行
 */
import { LineAssembler } from '../../domain/lineAssembler';
import { Emitter, type RadarTransport, type TransportState } from './RadarTransport';

export const NUS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // 網頁 → ESP32
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // ESP32 → 網頁
} as const;

export const DEVICE_NAME_PREFIX = 'RadarA';
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000];
const MAX_RECONNECT_DELAY_MS = 10000;

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export interface WebBluetoothOptions {
  /** 每次斷線時才讀取，讓設定頁的開關即時生效 */
  autoReconnect: () => boolean;
}

export class WebBluetoothTransport implements RadarTransport {
  private readonly lines = new Emitter<string>();
  private readonly states = new Emitter<TransportState>();
  private readonly assembler = new LineAssembler();
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  private device: BluetoothDevice | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private manualDisconnect = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: WebBluetoothOptions) {}

  onLine(listener: (line: string) => void) {
    return this.lines.on(listener);
  }

  onState(listener: (state: TransportState) => void) {
    return this.states.on(listener);
  }

  /** 跳出瀏覽器的裝置選擇視窗並連線 */
  async connect(): Promise<void> {
    if (!isWebBluetoothAvailable()) throw new Error('這個瀏覽器不支援 Web Bluetooth');
    this.manualDisconnect = false;
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }, { services: [NUS.service] }],
      optionalServices: [NUS.service],
    });
    this.attach(device);
    await this.openGatt();
  }

  /** 重新整理頁面後，連回之前授權過的裝置（瀏覽器支援 getDevices 時才可用） */
  async reconnectKnownDevice(): Promise<boolean> {
    if (!isWebBluetoothAvailable() || typeof navigator.bluetooth.getDevices !== 'function') return false;
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.name?.startsWith(DEVICE_NAME_PREFIX));
    if (!device) return false;
    this.manualDisconnect = false;
    this.attach(device);
    await this.openGatt();
    return true;
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.clearReconnect();
    try {
      await this.tx?.stopNotifications();
    } catch {
      // 已經斷線時停止通知會失敗，可忽略
    }
    this.device?.gatt?.disconnect();
    this.rx = null;
    this.tx = null;
    this.emitState({ status: 'idle' });
  }

  send(line: string): Promise<void> {
    const task = this.writeChain.then(() => this.write(line));
    this.writeChain = task.catch(() => undefined); // 一筆失敗不影響後面排隊的
    return task;
  }

  // ------------------------------------------------------------ 內部
  private attach(device: BluetoothDevice): void {
    if (this.device && this.device !== device) {
      this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.handleDisconnected);
  }

  private async openGatt(): Promise<void> {
    const device = this.device;
    if (!device?.gatt) throw new Error('找不到藍牙裝置');
    this.emitState({ status: this.attempt > 0 ? 'reconnecting' : 'connecting', attempt: this.attempt || undefined });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(NUS.service);
    this.rx = await service.getCharacteristic(NUS.rx);
    this.tx = await service.getCharacteristic(NUS.tx);
    this.tx.addEventListener('characteristicvaluechanged', this.handleNotification);
    await this.tx.startNotifications();

    this.assembler.reset();
    this.attempt = 0;
    this.emitState({ status: 'connected' });
  }

  private readonly handleNotification = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const text = this.decoder.decode(value, { stream: true });
    for (const line of this.assembler.push(text)) this.lines.emit(line);
  };

  private readonly handleDisconnected = (): void => {
    this.tx?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.rx = null;
    this.tx = null;
    if (this.manualDisconnect) return; // disconnect() 已經回報過狀態
    if (!this.options.autoReconnect()) {
      this.emitState({ status: 'disconnected', error: '藍牙連線中斷' });
      return;
    }
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.attempt += 1;
    const delay = RECONNECT_DELAYS_MS[this.attempt - 1] ?? MAX_RECONNECT_DELAY_MS;
    this.emitState({ status: 'reconnecting', attempt: this.attempt });
    this.reconnectTimer = setTimeout(() => {
      this.openGatt().catch(() => {
        if (!this.manualDisconnect) this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async write(line: string): Promise<void> {
    const rx = this.rx;
    if (!rx) throw new Error('尚未連線');
    const data = this.encoder.encode(line.endsWith('\n') ? line : `${line}\n`);
    if (rx.properties.write) await rx.writeValueWithResponse(data);
    else await rx.writeValueWithoutResponse(data);
  }

  private emitState(state: TransportState): void {
    this.states.emit({ ...state, deviceName: this.device?.name ?? undefined });
  }
}
