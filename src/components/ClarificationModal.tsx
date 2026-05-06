import { useEffect, useState } from 'react';
import { X, HelpCircle } from 'lucide-react';
import type { ClarificationPayload } from '@/types/agentDag';

interface ClarificationModalProps {
  payload: ClarificationPayload;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function ClarificationModal({ payload, onSubmit, onCancel }: ClarificationModalProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60]">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Clarification needed</h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">{payload.question}</p>
          {payload.options.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-3">
              {payload.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setText(o)}
                  className="text-xs px-2 py-1 rounded-md bg-violet-100 dark:bg-violet-900/40 text-violet-900 dark:text-violet-100"
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          <label htmlFor="clarify-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Your answer
          </label>
          <textarea
            id="clarify-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
          />
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(text.trim() || payload.options[0] || 'default')}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
