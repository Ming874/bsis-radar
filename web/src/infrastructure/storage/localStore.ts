/**
 * 【基礎設施層】localStorage 讀寫。
 * 私密瀏覽、儲存空間被封鎖時 localStorage 可能丟錯，一律包 try/catch，失敗就用預設值。
 */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不了就算了：只影響下次開啟時的偏好設定
  }
}
