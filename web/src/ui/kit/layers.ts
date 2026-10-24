/**
 * 【設計系統】疊在頁面上的一層（面板、騎乘模式）共用的行為：鎖住後面的頁面捲動、按返回鍵關閉。
 */
import { useEffect, useRef } from 'react';

/* ── 鎖住頁面捲動：全站共用一個計數，面板疊面板、關閉順序亂了也不會把頁面鎖死 ── */
let lockHolders = 0;
let savedOverflow = '';

export function lockScroll(): () => void {
  if (lockHolders === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockHolders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockHolders -= 1;
    if (lockHolders === 0) document.body.style.overflow = savedOverflow;
  };
}

/*
 * 返回鍵關閉：打開時在瀏覽紀錄多推一筆（網址不變），按返回只會關掉最上層的面板。
 * 用程式關掉時把自己那一筆退掉，瀏覽紀錄才不會越積越多。同一次更新裡關掉好幾層（確認後連詳情一起關）
 * 就一次退好幾筆；關掉一個又馬上打開另一個時，新的直接沿用要退掉的那一筆（不然退的時候會把新的關掉）。
 */
let pendingBack = 0;
let flushScheduled = false;

const layerOf = () => (window.history.state as { bsisLayer?: string } | null)?.bsisLayer;

function claimEntry(id: string): void {
  const state = { ...(window.history.state as object | null), bsisLayer: id };
  if (pendingBack > 0) {
    pendingBack -= 1;
    window.history.replaceState(state, '');
  } else window.history.pushState(state, '');
}

function releaseEntry(): void {
  pendingBack += 1;
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const n = pendingBack;
    pendingBack = 0;
    if (n > 0) window.history.go(-n);
  });
}

export function useBackToClose(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    claimEntry(id);
    let popped = false;
    const onPop = () => {
      if (layerOf() === id) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) releaseEntry();
    };
  }, [open]);
}
