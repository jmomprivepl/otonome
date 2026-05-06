import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

export type SopDagFieldContextExtraAction = {
  label: string;
  onSelect: () => void;
};

type SopDagNodeFieldContextMenuProps = {
  /** Shown in the menu, e.g. "step title", "prompt" */
  fieldLabel: string;
  children: ReactNode;
  /** Invoked when the user picks "Edit …" (focus control, open picker, etc.) */
  onRequestEdit: () => void;
  /** Optional second row (e.g. expanded editor for long text) */
  extraActions?: SopDagFieldContextExtraAction[];
};

export function SopDagNodeFieldContextMenu({
  fieldLabel,
  children,
  onRequestEdit,
  extraActions,
}: SopDagNodeFieldContextMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);

    let removePointer: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      const onPointerDown = (e: PointerEvent) => {
        if (menuRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      removePointer = () => document.removeEventListener('pointerdown', onPointerDown, true);
    });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      removePointer?.();
    };
  }, [open]);

  const itemClass =
    'block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-violet-50 dark:text-gray-100 dark:hover:bg-slate-700';

  const stopMenuPointerBubble = useCallback((e: SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  /**
   * Run the action and close on primary mousedown (before click), with preventDefault so the
   * button does not take focus — keeps the browser/WebView2 user-activation chain for focusing
   * inputs inside the node. Deferred focus after unmount loses activation and often no-ops.
   */
  const activatePrimaryMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>, fn: () => void) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
      queueMicrotask(() => setOpen(false));
    },
    [],
  );

  return (
    <>
      <div className="nodrag" onContextMenu={onContextMenu}>
        {children}
      </div>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${fieldLabel} field menu`}
              className="fixed z-[10000] min-w-[11rem] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
              style={{ left: pos.x, top: pos.y }}
              onContextMenu={(e) => e.preventDefault()}
              onMouseDown={stopMenuPointerBubble}
              onPointerDown={stopMenuPointerBubble}
              onPointerUp={stopMenuPointerBubble}
              onClick={stopMenuPointerBubble}
            >
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                onMouseDown={(e) => activatePrimaryMouseDown(e, onRequestEdit)}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  onRequestEdit();
                  setOpen(false);
                }}
              >
                Edit {fieldLabel}…
              </button>
              {extraActions?.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  className={itemClass}
                  onMouseDown={(e) => activatePrimaryMouseDown(e, a.onSelect)}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    a.onSelect();
                    setOpen(false);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
