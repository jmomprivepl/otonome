function selectRangeWhenFocused(el: HTMLInputElement | HTMLTextAreaElement) {
  queueMicrotask(() => {
    if (document.activeElement !== el) return;
    try {
      el.select();
    } catch {
      /* ignore */
    }
  });
}

type ApplyOpts = {
  /** Only the first user-gesture pass should open the native select picker; retries would re-enter showPicker and freeze the UI. */
  allowSelectPicker: boolean;
};

function applyFocusAndSelection(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, opts: ApplyOpts) {
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && (el.type === 'text' || el.type === 'search' || el.type === '')) {
    selectRangeWhenFocused(el);
  } else if (el instanceof HTMLTextAreaElement) {
    selectRangeWhenFocused(el);
  } else if (el instanceof HTMLSelectElement && opts.allowSelectPicker && document.activeElement === el) {
    const anySel = el as HTMLSelectElement & { showPicker?: () => void };
    if (typeof anySel.showPicker === 'function') {
      try {
        anySel.showPicker();
      } catch {
        /* ignore — security / unsupported */
      }
    }
  }
}

/** Focus and select text; opens native select picker at most once (first successful focus). */
export function focusFieldForEditing(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
) {
  if (!el) return;
  applyFocusAndSelection(el, { allowSelectPicker: true });
  if (document.activeElement === el) return;

  requestAnimationFrame(() => {
    if (document.activeElement === el) return;
    applyFocusAndSelection(el, { allowSelectPicker: false });
  });
}
