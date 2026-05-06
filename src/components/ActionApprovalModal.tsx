import { useEffect, useRef } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import type { ActionPendingPayload, HitlModalVariant } from '@/types/agentDag';
import { cn } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useFocusContainment } from '@/hooks/useFocusContainment';

interface ActionApprovalModalProps {
  payload: ActionPendingPayload;
  onApprove: () => void;
  onReject: () => void;
  variant?: HitlModalVariant;
}

export function ActionApprovalModal({
  payload,
  onApprove,
  onReject,
  variant = 'standard',
}: ActionApprovalModalProps) {
  const urgent = variant === 'timeSensitive';
  const rootRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true);
  useFocusContainment(urgent, rootRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onReject]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-describedby="action-approval-desc"
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        urgent ? 'z-[110] bg-black/60 backdrop-blur-md dark:bg-black/75' : 'z-[60] bg-black/50 backdrop-blur-sm dark:bg-black/70',
      )}
    >
      {urgent ? (
        <span className="sr-only">Time-sensitive approval. Background interaction is blocked until you respond.</span>
      ) : null}
      <div
        className={cn(
          'mx-4 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-800',
          urgent && 'ring-2 ring-amber-400/90 shadow-2xl ring-offset-2 ring-offset-slate-950/20 dark:ring-amber-500/80',
        )}
      >
        <div className="p-6">
          {urgent ? (
            <p className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-600/50 dark:bg-amber-950/50 dark:text-amber-100">
              Time-sensitive — please review now
            </p>
          ) : null}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Approve system action</h2>
            </div>
            <button
              type="button"
              onClick={onReject}
              className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          <p id="action-approval-desc" className="mb-2 text-sm text-gray-600 dark:text-gray-300">
            The orchestrator wants to run a system-level tool. Review and approve or reject.
          </p>
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-600 dark:bg-slate-900/50">
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-200">Tool</span>
              <p className="font-mono text-gray-900 dark:text-gray-100">{payload.toolName}</p>
            </div>
            {payload.nodeId ? (
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-200">Node</span>
                <p className="font-mono text-gray-900 dark:text-gray-100">{payload.nodeId}</p>
              </div>
            ) : null}
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-200">Arguments summary</span>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-gray-800 dark:text-gray-200">
                {payload.argsSummary}
              </pre>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onReject}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-slate-700"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
