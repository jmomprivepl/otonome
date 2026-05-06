import { useCallback, useEffect, useState } from 'react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import type { ManagerProfile } from '@/config/managerProfiles';
import { useKanbanStore } from '@/store';
import type { AgentProfile } from '@/config/agentProfiles';
import { getNativeLlmPaths, isTauriRuntime } from '@/config/nativeLlm';
import { buildLlamaCliTranscript } from '@/llm/formatLlamaCliTranscript';
import { applyAgentModelSampling, maxNewTokensFromAgentConfig } from '@/llm/llamaSamplingDefaults';
import {
  formatInferenceHardwareLine,
  type InferenceHardwareSnapshot,
  type NsdarRoutePreviewResponse,
  type NsdarSlotOverride,
} from '@/types/nsdar';
import type { HermesUiSnapshot } from '@/types/hermesOrchestration';
import { handleUserRequest } from '@/hermes/handleUserRequest';
import { createTauriNsdarInferenceEngine } from '@/hermes/inferenceEngines';
import { MockInferenceEngine } from '@/hermes/mockInferenceEngine';
import { NsdarChatPane, type FinetuneAgentMode, type PassState } from './NsdarChatPane';
import { NsdarMatrixPane, nextTernary, type Ternary } from './NsdarMatrixPane';
import { NsdarTelemetryPane } from './NsdarTelemetryPane';
import { OtonomeChat } from '@/components/OtonomeChat';

const LABEL = 'NSDAR';

/** When an agent is selected ("existing"), merge its `modelConfig` like `AgentsScreen → workerManager`. */
function buildLlamaBase(
  adaptersDir: string,
  baseModelOnly: boolean,
  agentModelConfig?: AgentProfile['modelConfig'],
) {
  const { exePath, modelPath } = getNativeLlmPaths();
  const ctxSize = Number(import.meta.env.VITE_LLAMA_CTX_SIZE ?? 4096);
  const merged = agentModelConfig && Object.keys(agentModelConfig).length > 0 ? agentModelConfig : undefined;
  const sampling = applyAgentModelSampling(merged);
  return {
    exePath,
    modelPath,
    baseModelOnly,
    ctxSize,
    ...sampling,
    // Satisfies `LlamaCliStartOptions.initial_prompt`; Pass 2 uses `initialPass2Prompt` from the engine.
    initialPrompt: buildLlamaCliTranscript([{ role: 'user', content: '' }]),
    maxNewTokens: maxNewTokensFromAgentConfig(merged),
    nsdarAdaptersDir: baseModelOnly ? undefined : adaptersDir.trim() || undefined,
    nsdarLayer: 0,
    nsdarFfnSuffix: 'ffn_down.weight',
  };
}

function dirname(modelPath: string): string {
  const lastFwd = modelPath.lastIndexOf('/');
  const lastBack = modelPath.lastIndexOf('\\');
  const idx = Math.max(lastFwd, lastBack);
  if (idx <= 0) return '';
  return modelPath.slice(0, idx);
}

function overridesFromState(display: Ternary[], locked: boolean[]): NsdarSlotOverride[] {
  return display.map((value, index) => ({
    index,
    value,
    locked: locked[index] ?? false,
  }));
}

export function NsdarCommandCenter({
  sidebarCollapsed,
}: {
  sidebarCollapsed: boolean;
  officeManager: ManagerProfile | null;
  setOfficeManager: (m: ManagerProfile | null) => void;
  chatSidebarOpen: boolean;
  setChatSidebarOpen: (o: boolean) => void;
}) {
  const [engineMode, setEngineMode] = useState<'local' | 'cloud'>('local');
  const [input, setInput] = useState('');
  const [adaptersDir, setAdaptersDir] = useState(() => dirname(getNativeLlmPaths().modelPath));
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant' | 'system'; content: string }[]>([]);
  const [telemetry, setTelemetry] = useState<string[]>([]);
  const [passState, setPassState] = useState<PassState>('idle');
  const [busy, setBusy] = useState(false);
  const [hardwareStatusLine, setHardwareStatusLine] = useState('');
  const [display, setDisplay] = useState<Ternary[]>(() => Array<Ternary>(32).fill(0));
  const [locked, setLocked] = useState<boolean[]>(() => Array(32).fill(false));
  const [hermesProgress, setHermesProgress] = useState<HermesUiSnapshot | null>(null);
  const [baseModelOnly, setBaseModelOnly] = useState(false);
  const agents = useKanbanStore((s) => s.agents);
  const activeProjectId = useKanbanStore((s) => s.activeProject?.id ?? null);
  const [finetuneMode, setFinetuneMode] = useState<FinetuneAgentMode>('existing');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');

  const resolveFinetunePersona = useCallback((): string | null => {
    if (finetuneMode === 'existing') {
      const a = agents.find((x) => x.id === selectedAgentId);
      const p = a?.systemPrompt?.trim();
      return p && p.length > 0 ? p : null;
    }
    const t = customSystemPrompt.trim();
    return t.length > 0 ? t : null;
  }, [agents, customSystemPrompt, finetuneMode, selectedAgentId]);

  /** Persona text merged into the Pass 2 `System:` block (same pattern as `buildLlamaCliTranscript` + `role: system`). */
  const resolvePass2PersonaForRequest = useCallback((): string | null => resolveFinetunePersona(), [resolveFinetunePersona]);

  /** Same sampling fields Agents pass into `workerManager.runNativeGenerate` for this agent (when comparing). */
  const resolveAgentModelConfigForLlama = useCallback((): AgentProfile['modelConfig'] | undefined => {
    if (finetuneMode !== 'existing') return undefined;
    return agents.find((a) => a.id === selectedAgentId)?.modelConfig;
  }, [agents, finetuneMode, selectedAgentId]);

  const appendLog = useCallback((lines: string[]) => {
    setTelemetry((prev) => [...prev, ...lines.map((l) => `[${new Date().toLocaleTimeString()}] ${l}`)]);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const h = await invoke<InferenceHardwareSnapshot>('get_inference_hardware_snapshot');
        if (!cancelled) {
          setHardwareStatusLine(formatInferenceHardwareLine(h));
        }
      } catch {
        if (!cancelled) setHardwareStatusLine('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onCycle = useCallback((index: number) => {
    setDisplay((d) => {
      const n = [...d];
      n[index] = nextTernary(n[index] ?? 0);
      return n;
    });
    setLocked((l) => {
      const x = [...l];
      x[index] = true;
      return x;
    });
  }, []);

  const onToggleLock = useCallback((index: number) => {
    setLocked((l) => {
      const x = [...l];
      x[index] = !x[index];
      return x;
    });
  }, []);

  const onPreview = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendLog(['> Preview skipped: not running in Tauri']);
      return;
    }
    const prompt = input.trim();
    if (!prompt) return;
    if (baseModelOnly) {
      setDisplay(() => Array<Ternary>(32).fill(0));
      setLocked(() => Array(32).fill(false));
      appendLog(['> Preview: base model only (LoRA/LoFA disabled) — routing skipped.']);
      setMessages((m) => [...m, { role: 'system', content: 'Preview skipped · base model only' }]);
      return;
    }
    setBusy(true);
    setPassState('pass1');
    appendLog(['> Pass 1: routing preview…']);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const overrides = overridesFromState(display, locked);
      const llama = buildLlamaBase(adaptersDir, baseModelOnly, resolveAgentModelConfigForLlama());
      const res = await invoke<NsdarRoutePreviewResponse>('nsdar_route_preview', {
        prompt,
        label: LABEL,
        overrides,
        llama,
      });
      setDisplay((prev) => {
        const next = [...prev] as Ternary[];
        for (let i = 0; i < 32; i++) {
          if (!locked[i]) {
            const vi = res.vector[i];
            next[i] = (vi === -1 || vi === 0 || vi === 1 ? vi : 0) as Ternary;
          }
        }
        return next;
      });
      setHardwareStatusLine(formatInferenceHardwareLine(res.inferenceHardware));
      appendLog([
        formatInferenceHardwareLine(res.inferenceHardware),
        `> Router pass: ${res.elapsedMs} ms`,
        ...(res.logLines ?? []).map((l) => (l.startsWith('>') ? l : `> ${l}`)),
        res.route
          ? `> Adapter: ${res.route.adapterId} (score ${res.route.score.toFixed(3)})`
          : `> Ambiguous: ${res.ambiguity?.topAdapters.join(', ') ?? '?'}`,
        `> Vector: [${res.vector.join(', ')}]`,
      ]);
      setMessages((m) => [...m, { role: 'system', content: `Pass 1 done · ${res.elapsedMs} ms` }]);
    } catch (e) {
      appendLog([`> Error: ${String(e)}`]);
    } finally {
      setPassState('idle');
      setBusy(false);
    }
  }, [adaptersDir, appendLog, baseModelOnly, display, input, locked, resolveAgentModelConfigForLlama]);

  const onRun = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt) return;
    setBusy(true);
    setPassState('pass2');
    setHermesProgress(null);
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    appendLog([
      baseModelOnly
        ? '> Execute: base model only (no LoRA/LoFA)…'
        : '> Execute: Hermes orchestration → local LoFA+QVAC (per inference slice)…',
    ]);
    if (baseModelOnly && finetuneMode === 'existing') {
      const p = resolveFinetunePersona();
      appendLog([
        p
          ? '> Pass 2: Workmate default system + selected agent instructions in `System:` (matches Agents native transcript).'
          : '> Pass 2: Workmate default `System:` only (select an agent with a system prompt or use Custom for instructions).',
      ]);
    }
    if (baseModelOnly) {
      const agentMc = resolveAgentModelConfigForLlama();
      const s = applyAgentModelSampling(agentMc && Object.keys(agentMc).length > 0 ? agentMc : undefined);
      appendLog([
        agentMc && Object.keys(agentMc).length > 0
          ? `> Sampling/context: merged from selected agent \`modelConfig\` + canonical defaults — temp=${s.temp}, top_k=${s.topK}, top_p=${s.topP}, min_p=${s.minP}, repeat_penalty=${s.repeatPenalty}, repeat_last_n=${s.repeatLastN} (same merge as Agents → workerManager).`
          : '> Sampling/context: canonical defaults only — pick an agent (Existing) to apply the same temp/top_k as the Agents screen.',
      ]);
      appendLog([
        `> Pass 2 flags (effective): --temp ${s.temp}, --top-k ${s.topK}, --top-p ${s.topP}, --min-p ${s.minP}, --repeat-penalty ${s.repeatPenalty}, --repeat-last-n ${s.repeatLastN}, -n ${maxNewTokensFromAgentConfig(agentMc && Object.keys(agentMc).length > 0 ? agentMc : undefined)}, -c from options.`,
      ]);
    }
    try {
      if (isTauriRuntime()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const engine = createTauriNsdarInferenceEngine({
          invoke,
          buildLlama: () =>
            buildLlamaBase(adaptersDir, baseModelOnly, resolveAgentModelConfigForLlama()),
          getOverrides: () => overridesFromState(display, locked),
        });
        const orc = await handleUserRequest(
          {
            userPrompt: prompt,
            finetunePersonaSystem: resolvePass2PersonaForRequest(),
            activeProjectId: activeProjectId ?? null,
          },
          {
            engine,
            onProgress: setHermesProgress,
            getPersistedWorkflowSops: () => useKanbanStore.getState().agentSops,
            getWorkflowBundleContext: () => ({
              embeddedWorkflowBundles: useKanbanStore.getState().embeddedWorkflowBundles,
              workflowBundlePins: useKanbanStore.getState().workflowBundlePins,
            }),
            onTraceLog: (line) => appendLog([line]),
          },
        );
        setMessages((m) => [...m, { role: 'assistant', content: orc.finalText }]);
        try {
          const h = await invoke<InferenceHardwareSnapshot>('get_inference_hardware_snapshot');
          setHardwareStatusLine(formatInferenceHardwareLine(h));
        } catch {
          /* keep previous line */
        }
      } else {
        const engine = new MockInferenceEngine(140);
        const orc = await handleUserRequest(
          {
            userPrompt: prompt,
            finetunePersonaSystem: resolvePass2PersonaForRequest(),
            activeProjectId: activeProjectId ?? null,
          },
          {
            engine,
            onProgress: setHermesProgress,
            getPersistedWorkflowSops: () => useKanbanStore.getState().agentSops,
            getWorkflowBundleContext: () => ({
              embeddedWorkflowBundles: useKanbanStore.getState().embeddedWorkflowBundles,
              workflowBundlePins: useKanbanStore.getState().workflowBundlePins,
            }),
            onTraceLog: (line) => appendLog([line]),
          },
        );
        appendLog(['> (browser) mock inference only — open in Tauri for real QVAC']);
        setMessages((m) => [...m, { role: 'assistant', content: orc.finalText }]);
      }
    } catch (e) {
      appendLog([`> Error: ${String(e)}`]);
      setMessages((m) => [...m, { role: 'system', content: String(e) }]);
    } finally {
      setHermesProgress(null);
      setPassState('idle');
      setBusy(false);
    }
  }, [
    activeProjectId,
    adaptersDir,
    appendLog,
    baseModelOnly,
    display,
    finetuneMode,
    input,
    locked,
    resolveAgentModelConfigForLlama,
    resolveFinetunePersona,
    resolvePass2PersonaForRequest,
    selectedAgentId,
  ]);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed}>
        <div className="h-[calc(100vh-73px)] p-3 sm:p-4 flex flex-col xl:flex-row gap-3 sm:gap-4 max-w-[1920px] mx-auto">
          {/* Left ~50% */}
          <div className="flex-1 min-w-0 min-h-[40vh] xl:w-1/2 xl:max-w-[50%]">
            <div className="h-full flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Engine</div>
                  {hardwareStatusLine ? (
                    <div className="mt-1 font-mono text-[9px] leading-tight text-cyan-200/90 truncate" title={hardwareStatusLine}>
                      {hardwareStatusLine}
                    </div>
                  ) : null}
                </div>
                <div className="inline-flex shrink-0 rounded-lg border border-slate-600/50 bg-slate-900/30 p-1">
                  <button
                    type="button"
                    onClick={() => setEngineMode('local')}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      engineMode === 'local'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/60'
                    }`}
                  >
                    Local execution
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngineMode('cloud')}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      engineMode === 'cloud'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/60'
                    }`}
                  >
                    Otonome cloud mode
                  </button>
                </div>
              </div>

              {engineMode === 'local' ? (
                <NsdarChatPane
                  messages={messages}
                  input={input}
                  setInput={setInput}
                  passState={passState}
                  onPreview={onPreview}
                  onRun={onRun}
                  busy={busy}
                  baseModelOnly={baseModelOnly}
                  hermesProgress={hermesProgress}
                  finetuneMode={finetuneMode}
                  setFinetuneMode={setFinetuneMode}
                  agents={agents}
                  selectedAgentId={selectedAgentId}
                  setSelectedAgentId={setSelectedAgentId}
                  customSystemPrompt={customSystemPrompt}
                  setCustomSystemPrompt={setCustomSystemPrompt}
                />
              ) : (
                <OtonomeChat />
              )}
            </div>
          </div>
          {/* Right ~50%: matrix top, telemetry bottom */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0 xl:w-1/2 xl:max-w-[50%]">
            <div className="flex-1 min-h-[220px] max-h-[55vh] xl:max-h-none xl:flex-[1.1] min-w-0">
              <NsdarMatrixPane
                display={display}
                locked={locked}
                onCycle={onCycle}
                onToggleLock={onToggleLock}
              />
            </div>
            <div className="shrink-0 space-y-2">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-600/50 bg-slate-900/30 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Adapters</div>
                  <div className="text-xs text-slate-200 truncate">
                    Base model only (disable LoRA/LoFA)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={baseModelOnly}
                  onChange={(e) => setBaseModelOnly(e.target.checked)}
                  className="h-4 w-4 accent-violet-500"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500 px-1">
                NSDAR adapters directory (optional)
                <input
                  value={adaptersDir}
                  onChange={(e) => setAdaptersDir(e.target.value)}
                  placeholder="e.g. C:\path\to\adapters or ./adapters"
                  disabled={baseModelOnly}
                  className="mt-1 w-full rounded-lg border border-slate-600/60 bg-slate-900/40 px-2 py-1.5 text-xs font-mono text-slate-200"
                />
              </label>
              <div className="h-[220px] sm:h-[260px]">
                <NsdarTelemetryPane lines={telemetry} />
              </div>
            </div>
          </div>
        </div>
      </AuthenticatedWorkspaceFrame>
    </div>
  );
}
