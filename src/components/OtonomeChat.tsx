import { useCallback, useEffect, useMemo, useState } from 'react';
import { useKanbanStore } from '@/store';
import { Send, Sparkles, Terminal } from 'lucide-react';
import { isTauriRuntime } from '@/config/nativeLlm';
import { HermesProgressPanel } from '@/components/hermes/HermesProgressPanel';
import { createTauriHermesCloudInferenceEngine } from '@/hermes/inferenceEngines';
import { formatHermesTrace } from '@/hermes/formatHermesTrace';
import { MockInferenceEngine } from '@/hermes/mockInferenceEngine';
import { useHermesOrchestration } from '@/hermes/useHermesOrchestration';
import type { InferenceEngine } from '@/types/hermesOrchestration';
import { formatInferenceHardwareLine, type InferenceHardwareSnapshot } from '@/types/nsdar';

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  audit?: {
    turnsUsed: number;
    log: string[];
    model: string;
    maxTurns: number;
    routeJson?: string;
  };
};

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusLabel(busy: boolean): { text: string; className: string } {
  if (busy) {
    return {
      text: 'Otonome is planning…',
      className: 'text-sky-300 animate-pulse border-sky-500/50 bg-sky-950/40',
    };
  }
  return {
    text: 'Awaiting input…',
    className: 'text-slate-400 border-slate-600/50 bg-slate-900/30',
  };
}

export function OtonomeChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [localRouterHardware, setLocalRouterHardware] = useState<string>('');

  const [model, setModel] = useState('');
  const [maxTurnsText, setMaxTurnsText] = useState('16');

  const maxTurns = useMemo(() => {
    const n = Number.parseInt(maxTurnsText, 10);
    if (!Number.isFinite(n)) return 16;
    return Math.max(1, Math.min(64, n));
  }, [maxTurnsText]);

  const inferenceEngine: InferenceEngine = useMemo(() => {
    if (!isTauriRuntime()) {
      return new MockInferenceEngine(140);
    }
    return {
      executeInference: async (req) => {
        const { invoke } = await import('@tauri-apps/api/core');
        const inner = createTauriHermesCloudInferenceEngine({ invoke, model, maxTurns });
        return inner.executeInference(req);
      },
    };
  }, [model, maxTurns]);

  const getPersistedWorkflowSops = useCallback(() => useKanbanStore.getState().agentSops, []);

  const { snapshot, busy, runUserPrompt } = useHermesOrchestration(inferenceEngine, {
    getPersistedWorkflowSops,
  });
  const pill = statusLabel(busy);
  const showHermesPanel = busy && snapshot.phase !== 'idle';

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const h = await invoke<InferenceHardwareSnapshot>('get_inference_hardware_snapshot');
        if (!cancelled) {
          setLocalRouterHardware(formatInferenceHardwareLine(h));
        }
      } catch {
        if (!cancelled) setLocalRouterHardware('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshHardware = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const h = await invoke<InferenceHardwareSnapshot>('get_inference_hardware_snapshot');
      setLocalRouterHardware(formatInferenceHardwareLine(h));
    } catch {
      setLocalRouterHardware('');
    }
  }, []);

  const onSubmit = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    setInput('');
    setMessages((m) => [...m, { id: newId(), role: 'user', content: prompt }]);

    const result = await runUserPrompt({ userPrompt: prompt });
    const logLines = formatHermesTrace(result.trace);

    setMessages((m) => [
      ...m,
      {
        id: newId(),
        role: 'assistant',
        content: result.finalText,
        audit: {
          turnsUsed: result.inferenceCallCount,
          log: logLines,
          model: model.trim() || (isTauriRuntime() ? '(backend default)' : 'mock-engine'),
          maxTurns,
          routeJson: JSON.stringify(result.route),
        },
      },
    ]);

    void refreshHardware();
  }, [busy, input, maxTurns, model, refreshHardware, runUserPrompt]);

  return (
    <div className="flex flex-col h-full min-h-[320px] rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-violet-200/40 dark:border-violet-800/40 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-500 dark:text-violet-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Otonome (Cloud Mode)</h2>
      </div>

      {localRouterHardware ? (
        <div className="px-4 py-2 border-b border-slate-700/40 bg-slate-950/40 font-mono text-[10px] text-cyan-200/90 leading-snug">
          {localRouterHardware}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Hermes routes your request (SOP, specialist, or direct), then runs the cloud agent loop per inference slice.
            Try prompts containing <strong className="text-violet-500">contract</strong>, <strong className="text-violet-500">finance</strong>, or{' '}
            <strong className="text-violet-500">incident</strong> to see inline progress. Outside Tauri, a mock engine drives the checklist.
            Expand <strong className="text-violet-500">Audit trail</strong> for orchestration logs.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg px-3 py-2 max-w-[95%] ${
                m.role === 'user'
                  ? 'ml-auto bg-violet-600/20 text-slate-900 dark:text-slate-100 border border-violet-500/30'
                  : m.role === 'assistant'
                    ? 'mr-auto bg-slate-900/50 text-slate-100 border border-slate-600/50'
                    : 'mx-auto text-center text-xs text-slate-500 border border-dashed border-slate-600/50 py-1'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">{m.role}</div>
              <div className="whitespace-pre-wrap">{m.content}</div>

              {m.role === 'assistant' && m.audit ? (
                <div className="mt-2">
                  <div className="text-[11px] text-slate-300/80 font-mono">
                    inferenceCalls={m.audit.turnsUsed} · model={m.audit.model} · maxTurns={m.audit.maxTurns}
                    {m.audit.routeJson ? (
                      <span className="block mt-0.5 text-slate-400/90 break-all">route={m.audit.routeJson}</span>
                    ) : null}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-xs text-slate-200/90 hover:text-slate-100 inline-flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-cyan-300" />
                      Audit trail
                    </summary>
                    <div className="mt-2 rounded-lg border border-slate-700/80 bg-slate-950/90 overflow-hidden shadow-inner">
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/80 bg-slate-900/95">
                        <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="text-xs font-medium text-slate-300 tracking-wide">TERMINAL VIEW</span>
                      </div>
                      <div
                        className="max-h-[280px] overflow-y-auto p-3 font-mono text-[11px] sm:text-xs text-emerald-400/95 leading-relaxed"
                        aria-live="polite"
                      >
                        {m.audit.log.length === 0 ? (
                          <span className="text-slate-500">&gt; (empty)</span>
                        ) : (
                          m.audit.log.map((line, i) => (
                            <div key={`${m.id}-log-${i}`} className="whitespace-pre-wrap break-all">
                              {line}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </details>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-violet-200/40 dark:border-violet-800/40 space-y-2 bg-slate-950/20">
        {showHermesPanel ? (
          <HermesProgressPanel snapshot={snapshot} busy={busy} />
        ) : (
          <div className={`text-center text-xs font-mono py-1.5 px-2 rounded-lg border ${pill.className}`}>{pill.text}</div>
        )}

        <details className="rounded-lg border border-slate-600/50 bg-slate-900/30 px-3 py-2">
          <summary className="cursor-pointer select-none text-xs text-slate-300 hover:text-slate-200">
            Advanced settings
          </summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">
              Model (empty = backend default)
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-20250514"
                className="mt-1 w-full rounded-lg border border-slate-600/60 bg-slate-900/40 px-2 py-1.5 text-xs font-mono text-slate-200"
              />
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">
              Max turns (1–64)
              <input
                value={maxTurnsText}
                onChange={(e) => setMaxTurnsText(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-lg border border-slate-600/60 bg-slate-900/40 px-2 py-1.5 text-xs font-mono text-slate-200"
              />
            </label>
          </div>
        </details>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Task or prompt…"
          rows={3}
          disabled={busy}
          className="w-full rounded-lg border border-slate-600/60 bg-slate-900/40 dark:bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-y min-h-[72px] disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void onSubmit();
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={() => void onSubmit()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
            title="Submit (Ctrl/Cmd+Enter)"
          >
            <Send className="w-4 h-4" />
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
