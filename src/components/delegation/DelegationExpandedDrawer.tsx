import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OtonomeChat } from '@/components/OtonomeChat';
import { DelegationMonitoringColumn } from '@/components/delegation/DelegationMonitoringColumn';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

type DelegationExpandedDrawerProps = {
  sidebarCollapsed: boolean;
  onClose: () => void;
};

/**
 * §7 overlay: full hub split (Hermes + monitoring) over the workspace without unmounting the route below.
 * Backdrop + panel are siblings fixed to the **content** band (right of sidebar).
 * Enter animation: backdrop fades in; panel slides in from the right (premium motion).
 */
export function DelegationExpandedDrawer({ sidebarCollapsed, onClose }: DelegationExpandedDrawerProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const leftClass = sidebarCollapsed ? 'left-16' : 'left-64';

  const [entered, setEntered] = useState(false);

  useBodyScrollLock(true);

  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={cn('fixed bottom-0 top-0 z-[100] flex', leftClass, 'right-0')}
      role="dialog"
      aria-modal="true"
      aria-label="Delegation hub"
    >
      <button
        type="button"
        className={cn(
          'min-h-0 flex-1 cursor-default bg-slate-950/50 backdrop-blur-[2px] transition-opacity duration-300 ease-out',
          entered ? 'opacity-100' : 'opacity-0',
        )}
        aria-label="Dismiss delegation hub"
        onClick={onClose}
      />
      <div
        className={cn(
          'flex h-full w-full max-w-[min(100vw,920px)] shrink-0 flex-col border-l border-violet-200/40 bg-slate-100 shadow-2xl will-change-transform dark:border-violet-800/40 dark:bg-slate-900 md:flex-row',
          'transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          entered ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-[2] flex-col border-b border-violet-200/30 dark:border-violet-800/30 md:border-b-0 md:border-r">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-violet-200/40 px-3 py-2 dark:border-violet-800/40">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Delegation hub</p>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200/80 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 p-2">
            <OtonomeChat />
          </div>
        </div>
        <div className="flex min-h-0 w-full min-w-[min(100%,18rem)] flex-1 flex-col overflow-y-auto border-t border-violet-200/30 p-2 dark:border-violet-800/30 md:max-w-sm md:border-l md:border-t-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Monitoring</p>
          <DelegationMonitoringColumn />
        </div>
      </div>
    </div>
  );
}
