import { useEffect } from 'react';

let lockCount = 0;
let storedOverflow = '';
let storedPaddingRight = '';

/**
 * Prevents background scrolling (e.g. while a modal or overlay drawer is open).
 * Ref-counted so nested overlays (e.g. HITL modal over §7 drawer) restore scroll only when all close.
 * Compensates for scrollbar width to avoid layout shift when `overflow: hidden` is applied.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    lockCount += 1;
    if (lockCount === 1) {
      const html = document.documentElement;
      const body = document.body;
      storedOverflow = body.style.overflow;
      storedPaddingRight = body.style.paddingRight;
      const scrollbarGap = window.innerWidth - html.clientWidth;
      body.style.overflow = 'hidden';
      if (scrollbarGap > 0) {
        body.style.paddingRight = `${scrollbarGap}px`;
      }
    }
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        const body = document.body;
        body.style.overflow = storedOverflow;
        body.style.paddingRight = storedPaddingRight;
      }
    };
  }, [locked]);
}
