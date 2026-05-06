import { Send, Sparkles } from 'lucide-react';
import { HermesProgressPanel } from '@/components/hermes/HermesProgressPanel';
import type { AgentProfile } from '@/config/agentProfiles';
import type { HermesUiSnapshot } from '@/types/hermesOrchestration';

export type PassState = 'idle' | 'pass1' | 'pass2';

export type FinetuneAgentMode = 'existing' | 'custom';

type Msg = { role: 'user' | 'assistant' | 'system'; content: string };

type Props = {
  messages: Msg[];
  input: string;
  setInput: (s: string) => void;
  passState: PassState;
  onPreview: () => void;
  onRun: () => void;
  busy: boolean;
  baseModelOnly?: boolean;
  /** Inline Hermes phases + SOP checklist during Execute (same strip as Pass 2 pill). */
  hermesProgress: HermesUiSnapshot | null;
  finetuneMode: FinetuneAgentMode;
  setFinetuneMode: (m: FinetuneAgentMode) => void;
  agents: AgentProfile[];
  selectedAgentId: string;
  setSelectedAgentId: (id: string) => void;
  customSystemPrompt: string;
  setCustomSystemPrompt: (s: string) => void;
};

function passLabel(state: PassState, baseModelOnly: boolean): { text: string; className: string } {
  if (state === 'pass1') {
    return {
      text: 'Pass 1: Routing & sensing…',
      className: 'text-sky-300 animate-pulse border-sky-500/50 bg-sky-950/40',
    };
  }
  if (state === 'pass2') {
    return {
      text: baseModelOnly ? 'Pass 2: Base model executing…' : 'Pass 2: Native LoRA fusion & executing…',
      className: 'text-amber-300 animate-pulse border-amber-500/50 bg-amber-950/40',
    };
  }
  return {
    text: 'Awaiting input…',
    className: 'text-slate-400 border-slate-600/50 bg-slate-900/30',
  };
}

export function NsdarChatPane({
  messages,
  input,
  setInput,
  passState,
  onPreview,
  onRun,
  busy,
  baseModelOnly = false,
  hermesProgress,
  finetuneMode,
  setFinetuneMode,
  agents,
  selectedAgentId,
  setSelectedAgentId,
  customSystemPrompt,
  setCustomSystemPrompt,
}: Props) {
  const pill = passLabel(passState, baseModelOnly);
  const showHermesPanel = busy && hermesProgress && hermesProgress.phase !== 'idle';
  const existingNeedsAgent = finetuneMode === 'existing' && !selectedAgentId;
  const canExecute = Boolean(input.trim()) && !existingNeedsAgent;
  return (
    <div className="flex flex-col h-full min-h-[320px] rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-violet-200/40 dark:border-violet-800/40 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-500 dark:text-violet-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Command center</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Choose an <strong className="text-violet-500">existing agent</strong> or a{' '}
            <strong className="text-violet-500">custom</strong> persona, enter your user message, then{' '}
            <strong className="text-violet-500">Preview</strong> (Pass 1) or <strong className="text-violet-500">Execute</strong> (Pass 2).
            Try <strong className="text-violet-500">contract</strong>, <strong className="text-violet-500">finance</strong>, or{' '}
            <strong className="text-violet-500">incident</strong> in the user message for Hermes routing demos.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
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
            </div>
          ))
        )}
      </div>
      <div className="p-3 border-t border-violet-200/40 dark:border-violet-800/40 space-y-2 bg-slate-950/20">
        {showHermesPanel ? (
          <HermesProgressPanel snapshot={hermesProgress} busy={busy} />
        ) : (
          <div
            className={`text-center text-xs font-mono py-1.5 px-2 rounded-lg border ${pill.className} transition-all duration-300`}
          >
            {pill.text}
          </div>
        )}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Agent for Pass 2</div>
          <div className="inline-flex rounded-lg border border-slate-600/50 bg-slate-900/40 p-0.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => setFinetuneMode('existing')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                finetuneMode === 'existing'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              Existing agent
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setFinetuneMode('custom')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                finetuneMode === 'custom'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              Custom agent
            </button>
          </div>
          {finetuneMode === 'existing' ? (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Profile</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-slate-600/60 bg-slate-900/50 px-2 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50"
              >
                <option value="">Select an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {existingNeedsAgent ? (
                <p className="mt-1 text-xs text-amber-400/90">Select an agent to run Execute with a profile persona.</p>
              ) : null}
            </div>
          ) : (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                Agent system prompt (optional — empty uses default Workmate-only transcript)
              </label>
              <textarea
                value={customSystemPrompt}
                onChange={(e) => setCustomSystemPrompt(e.target.value)}
                placeholder="You are … Specialized in …"
                rows={4}
                disabled={busy}
                className="w-full rounded-lg border border-slate-600/60 bg-slate-900/40 dark:bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-y min-h-[88px] disabled:opacity-50"
              />
            </div>
          )}
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">User message / task</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message routed by Hermes (Pass 1) and sent as User in Pass 2…"
            rows={3}
            disabled={busy}
            className="w-full rounded-lg border border-slate-600/60 bg-slate-900/40 dark:bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-y min-h-[72px] disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={onPreview}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            Preview (Pass 1)
          </button>
          <button
            type="button"
            disabled={busy || !canExecute}
            onClick={onRun}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            <Send className="w-4 h-4" />
            Execute (Pass 2)
          </button>
        </div>
      </div>
    </div>
  );
}
