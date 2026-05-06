import { useEffect, useRef, useState } from 'react';
import { X, HelpCircle } from 'lucide-react';
import type { ClarificationPayload, HitlModalVariant } from '@/types/agentDag';
import { cn } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useFocusContainment } from '@/hooks/useFocusContainment';

interface ClarificationModalProps {
  payload: ClarificationPayload;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  variant?: HitlModalVariant;
}

export function ClarificationModal({
  payload,
  onSubmit,
  onCancel,
  variant = 'standard',
}: ClarificationModalProps) {
  const [text, setText] = useState('');
  const urgent = variant === 'timeSensitive';
  const rootRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true);
  useFocusContainment(urgent, rootRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        urgent ? 'z-[110] bg-black/60 backdrop-blur-md dark:bg-black/75' : 'z-[60] bg-black/50 backdrop-blur-sm dark:bg-black/70',
      )}
    >
      {urgent ? (
        <span className="sr-only">Time-sensitive clarification required before the workflow can continue.</span>
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
              Time-sensitive — please respond
            </p>
          ) : null}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Clarification needed</h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">{payload.question}</p>
          {payload.options.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {payload.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setText(o)}
                  className="rounded-md bg-violet-100 px-2 py-1 text-xs text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          <label htmlFor="clarify-text" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Your answer
          </label>
          <textarea
            id="clarify-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 dark:focus:ring-blue-400"
          />
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(text.trim() || payload.options[0] || 'default')}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-white hover:bg-cyan-700"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
