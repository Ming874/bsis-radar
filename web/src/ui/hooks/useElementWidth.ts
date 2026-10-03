/**
 * 【UI 層】量測元素目前的寬度（跟著視窗縮放更新）。圖表用它讓 SVG 文字維持實際大小，不會在寬螢幕被放大。
 */
import { useCallback, useState, type RefCallback } from 'react';

export function useElementWidth<T extends Element>(fallback: number): [RefCallback<T>, number] {
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((el: T | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
