import { useEffect, type RefObject } from 'react';

/**
 * Minimal focus loop for modal dialogs (Tab cycles inside `rootRef`).
 * Used for §8 time-sensitive HITL prominence when a full focus-trap library is not installed.
 */
export function useFocusContainment(active: boolean, rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;

    const getFocusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = getFocusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement as Node)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [active, rootRef]);
}
