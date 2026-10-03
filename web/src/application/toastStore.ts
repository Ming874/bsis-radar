/**
 * 【應用層】畫面上方的提示訊息（成功、資訊、警告、錯誤），幾秒後自動消失。
 */
import { createStore } from 'zustand/vanilla';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface ToastStore {
  toasts: Toast[];
  push: (tone: ToastTone, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const DURATION_MS: Record<ToastTone, number> = { success: 3000, info: 3500, warning: 5000, error: 7000 };
const MAX_VISIBLE = 3;

export function createToastStore() {
  let nextId = 0;
  const store = createStore<ToastStore>()((set, get) => ({
    toasts: [],
    push: (tone, title, detail) => {
      const id = ++nextId;
      // 同樣的訊息連續出現（例如一次套用好幾個設定）只留最新一則
      const same = (t: Toast) => t.tone === tone && t.title === title && t.detail === detail;
      set((s) => ({ toasts: [...s.toasts.filter((t) => !same(t)).slice(-(MAX_VISIBLE - 1)), { id, tone, title, detail }] }));
      setTimeout(() => get().dismiss(id), DURATION_MS[tone]);
    },
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }));
  return store;
}
