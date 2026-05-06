import { useSyncExternalStore } from 'react';

function subscribeMaxWidth(px: number, onStoreChange: () => void) {
  const mq = window.matchMedia(`(max-width: ${px}px)`);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getSnapshotMaxWidth(px: number) {
  return window.matchMedia(`(max-width: ${px}px)`).matches;
}

function getServerSnapshot() {
  return false;
}

/** True when viewport width is at or below the breakpoint (spec §7 default 1280px). */
export function useViewportNarrow(maxWidthPx: number): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMaxWidth(maxWidthPx, onChange),
    () => getSnapshotMaxWidth(maxWidthPx),
    getServerSnapshot,
  );
}
