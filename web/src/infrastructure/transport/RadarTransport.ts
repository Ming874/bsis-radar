/**
 * 【基礎設施層】雷達連線介面。
 *
 * WebBluetoothTransport 實作這個介面；上層（application）只認介面，
 * 方便將來換成其他連線方式，或在測試中注入假的實作。
 */
export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface TransportState {
  status: TransportStatus;
  deviceName?: string;
  attempt?: number; // 重新連線第幾次
  error?: string;
}

export interface RadarTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** 送出一行指令（不需要自己加換行） */
  send(line: string): Promise<void>;
  /** 訂閱收到的每一行，回傳取消訂閱的函式 */
  onLine(listener: (line: string) => void): () => void;
  onState(listener: (state: TransportState) => void): () => void;
}

/** 極簡事件發送器 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}
