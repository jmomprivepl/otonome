import { useEffect, useRef, useState } from 'react';
import { X, UserCheck } from 'lucide-react';
import type { HumanReviewPayload, HitlModalVariant } from '@/types/agentDag';
import { cn } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useFocusContainment } from '@/hooks/useFocusContainment';

interface HumanReviewModalProps {
  payload: HumanReviewPayload;
  onSubmit: (approved: boolean, notes: string) => void;
  variant?: HitlModalVariant;
}

export function HumanReviewModal({ payload, onSubmit, variant = 'standard' }: HumanReviewModalProps) {
  const [notes, setNotes] = useState('');
  const urgent = variant === 'timeSensitive';
  const rootRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true);
  useFocusContainment(urgent, rootRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSubmit(false, notes);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSubmit, notes]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        urgent ? 'z-[110] bg-black/60 backdrop-blur-md dark:bg-black/75' : 'z-[70] bg-black/50 backdrop-blur-sm dark:bg-black/70',
      )}
    >
      {urgent ? (
        <span className="sr-only">Time-sensitive human review gate. Please approve or reject to unblock the workflow.</span>
      ) : null}
      <div
        className={cn(
          'mx-4 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-800',
          urgent && 'ring-2 ring-amber-400/90 shadow-2xl ring-offset-2 ring-offset-slate-950/20 dark:ring-amber-500/80',
        )}
      >
        <div className="max-h-[90vh] overflow-y-auto p-6">
          {urgent ? (
            <p className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-950 dark:border-amber-600/50 dark:bg-amber-950/50 dark:text-amber-100">
              Time-sensitive review — workflow is waiting
            </p>
          ) : null}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Human review required</h2>
            </div>
            <button
              type="button"
              onClick={() => onSubmit(false, notes)}
              className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Run <span className="font-mono">{payload.runId}</span> — node <span className="font-mono">{payload.nodeId}</span>
          </p>
          <p className="mb-4 text-sm text-gray-800 dark:text-gray-200">{payload.instructions}</p>
          <details className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-slate-600 dark:bg-slate-900/60">
            <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300">Workflow state snapshot</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-gray-600 dark:text-gray-400">
              {JSON.stringify(payload.stateSnapshot, null, 2)}
            </pre>
          </details>
          <label htmlFor="human-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Notes / edits (stored as <code className="text-xs">notes</code> in workflow state)
          </label>
          <textarea
            id="human-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
            placeholder="Approval comments, corrections, or structured notes…"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onSubmit(false, notes)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-slate-700"
            >
              Reject / stop
            </button>
            <button
              type="button"
              onClick={() => onSubmit(true, notes)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Approve &amp; continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
