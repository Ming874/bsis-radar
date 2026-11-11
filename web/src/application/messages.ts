/**
 * 【應用層】把 ESP32 的英文回覆與瀏覽器的藍牙錯誤，翻成使用者看得懂的繁體中文。
 */

const ACK_TEXT: Array<[RegExp, string]> = [
  [/^saved$/i, '已儲存到 ESP32，斷電也不會消失'],
  [/^applied \(flash save failed\)/i, '已套用，但存入 ESP32 失敗；重新開機後會恢復舊設定'],
  [/^reboot$/i, 'ESP32 重新開機中，約 5 秒後恢復'],
  [/^commands:/i, '可用指令已列在主控台'],
  [/^ANGLE must be/i, '安裝角度必須介於 15° ～ 75°'],
  [/^HEIGHT must be/i, '安裝高度必須介於 0.15 ～ 1.50 m'],
  [/^DIR must be/i, '雷達朝向只能是朝後（1）或朝前（-1）'],
  [/^MODEL must be/i, '速度模型只能是 0（固定角度）或 1（距離幾何）'],
  [/^CAL must be/i, '校正係數必須介於 0.5 ～ 2.0'],
  [/^RTHR must be/i, '雷達門檻必須是 1 ～ 50 的整數'],
  [/^WHEEL must be/i, '輪周長必須是 1000 ～ 3000 的整數（mm）'],
  [/^VMAX must be/i, '雷達測速上限必須介於 2 ～ 20 m/s'],
  [/^missing or bad value/i, '指令缺少數值或格式不正確'],
  [/^unknown command/i, 'ESP32 不認得這個指令；輸入 HELP 可查看可用指令'],
  [/^settings over Bluetooth are disabled/i, 'ESP32 已關閉「藍牙修改設定」，請改用 USB 序列埠修改'],
];

/** ESP32 的 OK / ERR 回覆 → 繁中說明 */
export function describeAck(ok: boolean, message: string): string {
  for (const [pattern, text] of ACK_TEXT) if (pattern.test(message)) return text;
  return ok ? `ESP32 回覆：${message}` : `ESP32 回報錯誤：${message}`;
}

export const BRAVE_BLUETOOTH_HELP =
  'Brave 瀏覽器預設關閉藍牙功能（Web Bluetooth）。請改用 Chrome；或在 Brave 網址列輸入 brave://flags，搜尋「Web Bluetooth」，改成 Enabled 後重新開啟 Brave。';

/**
 * 藍牙連線錯誤 → 繁中說明；只有「使用者自己關掉選擇視窗」才回傳 null（不需要提示）。
 * 注意：瀏覽器很多不同的錯誤都叫 NotFoundError，必須看訊息內容分辨，不能一律當成取消。
 */
export function describeConnectionError(e: unknown): string | null {
  const name = e instanceof DOMException ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);

  if (/globally disabled|API is disabled|not enabled/i.test(message)) return BRAVE_BLUETOOTH_HELP;
  if (/adapter not available|adapter is not available/i.test(message)) return '手機的藍牙沒有開啟，請先開啟藍牙再連線';
  if (/permission/i.test(message) && /blocked|denied|disallowed/i.test(message)) {
    return '瀏覽器的藍牙權限被封鎖：請到「網站設定」允許藍牙；Android 也要在系統設定允許瀏覽器使用「附近裝置」';
  }
  if (/No Services matching UUID|getPrimaryService|No Characteristics/i.test(message)) {
    return '找不到雷達服務：選到的裝置可能不是 BSIS-Speed';
  }
  if (/cancel/i.test(message)) return null; // 使用者關掉選擇視窗
  if (name === 'SecurityError') return '瀏覽器拒絕使用藍牙：網頁必須用 HTTPS 開啟';
  if (name === 'NotAllowedError') return '瀏覽器沒有藍牙權限，請到網站設定允許「藍牙」';
  if (name === 'NetworkError' || /GATT Server is disconnected|connection failed/i.test(message)) {
    return '連不上 ESP32：請確認有電、距離夠近，再試一次';
  }
  if (name === 'InvalidStateError' || /already in progress/i.test(message)) return '藍牙正忙，請稍後再試';
  if (name === 'NotSupportedError') return '這支手機不支援需要的藍牙功能';
  if (/不支援 Web Bluetooth/.test(message)) return message;
  return `連線失敗：${message}`;
}

/** 送指令失敗 → 繁中說明 */
export function describeSendError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/尚未連線|not connected|GATT Server is disconnected/i.test(message)) return '尚未連線，指令沒有送出';
  if (/already in progress/i.test(message)) return '藍牙正忙，請稍後再送一次';
  return `指令送出失敗：${message}`;
}
