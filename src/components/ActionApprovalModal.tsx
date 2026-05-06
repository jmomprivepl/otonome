import { useEffect } from 'react';
import { X, ShieldAlert } from 'lucide-react';
import type { ActionPendingPayload } from '@/types/agentDag';

interface ActionApprovalModalProps {
  payload: ActionPendingPayload;
  onApprove: () => void;
  onReject: () => void;
}

export function ActionApprovalModal({ payload, onApprove, onReject }: ActionApprovalModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onReject]);

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Approve system action</h2>
            </div>
            <button
              type="button"
              onClick={onReject}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
            The orchestrator wants to run a system-level tool. Review and approve or reject.
          </p>
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-slate-900/50 p-3 text-sm space-y-2">
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
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onReject}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onApprove}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white"
            >
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
