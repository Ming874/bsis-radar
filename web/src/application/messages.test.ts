import { describe, expect, it } from 'vitest';
import { BRAVE_BLUETOOTH_HELP, describeAck, describeConnectionError } from './messages';

const domError = (name: string, message: string) => new DOMException(message, name);

describe('describeConnectionError', () => {
  it('使用者關掉選擇視窗：不提示', () => {
    expect(describeConnectionError(domError('NotFoundError', 'User cancelled the requestDevice() chooser.'))).toBeNull();
  });

  it('Brave 預設關閉 Web Bluetooth：要明確告訴使用者怎麼做（不能當成取消）', () => {
    expect(describeConnectionError(domError('NotFoundError', 'Web Bluetooth API globally disabled.'))).toBe(BRAVE_BLUETOOTH_HELP);
  });

  it('其他同樣叫 NotFoundError 的錯誤也要提示', () => {
    expect(describeConnectionError(domError('NotFoundError', 'Bluetooth adapter not available.'))).toContain('藍牙沒有開啟');
    expect(describeConnectionError(domError('NotFoundError', 'Bluetooth permission has been blocked.'))).toContain('權限被封鎖');
    expect(describeConnectionError(domError('NotFoundError', 'No Services matching UUID 6e400001 found in Device.'))).toContain('RadarA-ESP32');
    expect(describeConnectionError(domError('NotFoundError', 'something new'))).toContain('連線失敗');
  });

  it('其他常見錯誤', () => {
    expect(describeConnectionError(domError('SecurityError', 'x'))).toContain('HTTPS');
    expect(describeConnectionError(domError('NetworkError', 'Connection failed for unknown reason.'))).toContain('連不上 ESP32');
  });
});

describe('describeAck', () => {
  it('翻譯 ESP32 的回覆', () => {
    expect(describeAck(true, 'saved')).toContain('已儲存');
    expect(describeAck(false, 'RANGE must be 1-20')).toContain('1 ～ 20');
    expect(describeAck(false, 'settings over Bluetooth are disabled, use USB')).toContain('USB');
  });
});
