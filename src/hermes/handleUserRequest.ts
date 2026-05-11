import type {
  HermesOrchestrationResult,
  HermesTraceEvent,
  HermesUiSnapshot,
  InferenceEngine,
  RouteDecision,
  TaskContext,
} from '@/types/hermesOrchestration';
import { decideRoute as platformClassifyRoute } from '@/domain/platformContracts';
import { isTauriRuntime, getNativeLlmPaths } from '@/config/nativeLlm';
import { SOP_REGISTRY } from '@/hermes/registries';
import type { PersistedWorkflowSop } from '@/hermes/workflowDag';
import type { EmbeddedWorkflowBundleStore, WorkflowBundlePin } from '@/types/workflowBundle';
import { resolveWorkflowGraphForSopExecution } from '@/hermes/resolveWorkflowBundle';
import { runTauriWorkflowAndWait, toRustDagGraph } from '@/hermes/tauriWorkflowRun';
import { formatHermesTraceLine } from '@/hermes/formatHermesTrace';
import { defaultLlamaSamplingPayload } from '@/llm/llamaSamplingDefaults';

function buildWorkflowLlamaBundle(): Record<string, unknown> | null {
  try {
    const { exePath, modelPath } = getNativeLlmPaths();
    return {
      exePath,
      modelPath,
      ctxSize: 4096,
      ...defaultLlamaSamplingPayload(),
      initialPrompt: 'System: placeholder\nUser: hi\nAssistant: ',
      maxNewTokens: 1024,
    };
  } catch {
    return null;
  }
}

function headlineForPhase(
  phase: HermesUiSnapshot['phase'],
  _route: RouteDecision,
  sopTitle?: string,
  domainLabel?: string,
): string {
  switch (phase) {
    case 'understanding_intent':
      return 'Understanding intent…';
    case 'sop_running':
      return sopTitle ? `Executing SOP: ${sopTitle}` : 'Executing SOP…';
    case 'delegating_sub_agent':
      return domainLabel ? `Delegating to ${domainLabel} Agent…` : 'Delegating to specialist…';
    case 'direct_inference':
      return 'Processing task…';
    case 'error':
      return 'Hermes encountered an error';
    default:
      return 'Awaiting input…';
  }
}

function buildSopSteps(sopId: string): HermesUiSnapshot['sopSteps'] {
  const def = SOP_REGISTRY[sopId];
  if (!def) return null;
  return def.steps.map((s, i) => ({
    id: s.id,
    label: s.label,
    status: 'pending' as const,
    index: i + 1,
    total: def.steps.length,
  }));
}

type CheckSopRegistryResult =
  | { found: true; sopId: string; summary: string }
  | { found: false; sopId: null; summary: null; message: string };

/**
 * Tool (skill): check_sop_registry
 * Strict behavior: determine whether an SOP exists for the task.
 *
 * Today this is a simple match against the in-app `SOP_REGISTRY`.
 * (You can later replace this with embeddings / semantic search / DB-backed SOPs.)
 */
function checkSopRegistry(taskDescription: string): CheckSopRegistryResult {
  const text = taskDescription.trim();
  if (!text) return { found: false, sopId: null, summary: null, message: 'not found (empty task_description)' };

  const hay = text.toLowerCase();
  for (const sop of Object.values(SOP_REGISTRY)) {
    const corpus = [sop.title, ...sop.steps.map((s) => s.label)].join(' ').toLowerCase();
    const tokens = hay.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    const hit = tokens.some((t) => corpus.includes(t));
    if (!hit) continue;
    const summary = `SOP: ${sop.title}\nSteps:\n${sop.steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n')}`;
    return { found: true, sopId: sop.id, summary };
  }

  return { found: false, sopId: null, summary: null, message: 'not found' };
}

export type HermesProgressHandler = (snap: HermesUiSnapshot) => void;

export interface WorkflowBundleStoreSlice {
  embeddedWorkflowBundles: EmbeddedWorkflowBundleStore;
  workflowBundlePins: Record<string, WorkflowBundlePin>;
}

export interface HandleUserRequestDeps {
  engine: InferenceEngine;
  onProgress: HermesProgressHandler;
  getPersistedWorkflowSops?: () => PersistedWorkflowSop[];
  /** Bundle pins + embedded catalog; when omitted, pins resolve as empty (unpinned graphs only). */
  getWorkflowBundleContext?: () => WorkflowBundleStoreSlice;
  /** When set (e.g. Command center telemetry), each trace event is mirrored immediately with correct timestamps. */
  onTraceLog?: (line: string) => void;
}

export async function handleUserRequest(
  task: TaskContext,
  deps: HandleUserRequestDeps,
): Promise<HermesOrchestrationResult> {
  const trace: HermesTraceEvent[] = [];
  let inferenceCallCount = 0;
  const { engine, onProgress, getPersistedWorkflowSops, getWorkflowBundleContext, onTraceLog } = deps;
  const pushTrace = (e: HermesTraceEvent) => {
    trace.push(e);
    onTraceLog?.(formatHermesTraceLine(e));
  };
  const user = task.userPrompt.trim();
  const correlationId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cid-${Date.now()}`;
  const platformRoute = platformClassifyRoute({ correlationId, rawText: user });
  const finetunePersona =
    typeof task.finetunePersonaSystem === 'string' && task.finetunePersonaSystem.trim().length > 0
      ? task.finetunePersonaSystem.trim()
      : null;

  const emit = (partial: Partial<HermesUiSnapshot> & Pick<HermesUiSnapshot, 'phase'>) => {
    const snap: HermesUiSnapshot = {
      phase: partial.phase,
      headline: partial.headline ?? headlineForPhase(partial.phase, { kind: 'direct' }),
      sopSteps: partial.sopSteps ?? null,
      platformRoute: {
        mode: platformRoute.mode,
        confidence: platformRoute.confidence,
        rationaleTrace: platformRoute.rationaleTrace,
        sopBundleId: platformRoute.sopBundleId,
        sopVersion: platformRoute.sopVersion,
      },
    };
    onProgress(snap);
  };

  emit({ phase: 'understanding_intent', headline: headlineForPhase('understanding_intent', { kind: 'direct' }) });
  pushTrace({
    type: 'log',
    message: `> platform_decideRoute: ${JSON.stringify({
      mode: platformRoute.mode,
      confidence: platformRoute.confidence,
      rationaleTrace: platformRoute.rationaleTrace,
      sopBundleId: platformRoute.sopBundleId ?? null,
    })}`,
  });

  let decision: RouteDecision;
  if (platformRoute.mode === 'adhoc') {
    pushTrace({
      type: 'log',
      message: '> platform_gate: ad-hoc — skipping SOP registry; Hermes runs direct inference',
    });
    decision = { kind: 'direct' };
  } else {
    pushTrace({ type: 'log', message: '> tool_call: check_sop_registry (platform flagged SOP mode)' });
    const sopCheck = checkSopRegistry(user);
    pushTrace({
      type: 'log',
      message: sopCheck.found
        ? `> tool_result: found sopId=${sopCheck.sopId}`
        : `> tool_result: ${sopCheck.message}`,
    });
    decision = sopCheck.found ? { kind: 'sop', sopId: sopCheck.sopId } : { kind: 'direct' };
    if (platformRoute.mode === 'sop' && decision.kind !== 'sop') {
      pushTrace({
        type: 'log',
        message:
          '> note: platform SOP mode but no registry SOP matched — falling back to direct inference (add keywords like contract / incident)',
      });
    }
  }
  pushTrace({ type: 'route', decision });
  pushTrace({ type: 'log', message: `> route: ${JSON.stringify(decision)}` });

  try {
    if (decision.kind === 'sop') {
      const def = SOP_REGISTRY[decision.sopId];
      if (!def) {
        throw new Error(`Unknown SOP id: ${decision.sopId}`);
      }

      if (isTauriRuntime()) {
        const bundleCtx = getWorkflowBundleContext?.() ?? {
          embeddedWorkflowBundles: {},
          workflowBundlePins: {},
        };
        const getAgentSops =
          getPersistedWorkflowSops ?? (() => [] as PersistedWorkflowSop[]);
        const resolved = await resolveWorkflowGraphForSopExecution({
          sopId: decision.sopId,
          platformBundleId: platformRoute.sopBundleId,
          platformBundleVersion: platformRoute.sopVersion,
          projectId: task.activeProjectId ?? null,
          getAgentSops,
          embeddedWorkflowBundles: bundleCtx.embeddedWorkflowBundles,
          workflowBundlePins: bundleCtx.workflowBundlePins,
        });
        const graph = resolved.graph;
        pushTrace({
          type: 'log',
          message: `> workflow_bundle: resolution=${resolved.resolution} bundleId=${resolved.bundleId} semver=${resolved.bundleVersion} digest=${resolved.contentDigest.slice(0, 12)}…`,
        });
        const sopSteps = graph.nodes.map((n, i) => ({
          id: n.id,
          label: n.label,
          status: 'pending' as const,
          index: i + 1,
          total: graph.nodes.length,
        }));
        pushTrace({ type: 'log', message: '> workflow: starting Tauri DAG orchestrator' });
        emit({
          phase: 'sop_running',
          headline: headlineForPhase('sop_running', decision, def.title),
          sopSteps: sopSteps.map((s) => ({ ...s, status: 'running' as const })),
        });

        const needsLocal = graph.nodes.some(
          (n) => (n.nodeKind ?? 'agent') === 'agent' && n.executionTarget === 'localQvac',
        );
        const llamaOptions = needsLocal ? buildWorkflowLlamaBundle() : null;
        if (needsLocal && !llamaOptions) {
          pushTrace({ type: 'log', message: '> workflow: local nodes need native LLM paths' });
        }

        const finish = await runTauriWorkflowAndWait({
          graph: toRustDagGraph(graph.nodes, graph.edges),
          llamaOptions,
          anthropicModel: null,
          userRequest: user,
          sopId: decision.sopId,
          taskId: task.taskId ?? null,
          hermesModel: null,
          hermesMaxTurns: null,
          bundleId: resolved.bundleId,
          bundleVersion: resolved.bundleVersion,
          contentDigest: resolved.contentDigest,
        });

        pushTrace({
          type: 'log',
          message: `> workflow finished ok=${finish.ok} err=${finish.error ?? ''}`,
        });

        const wf = finish.workflow;
        if (wf) {
          Object.entries(wf.nodeOutputs ?? {}).forEach(([id, text]) => {
            pushTrace({ type: 'log', message: `> node ${id}: ${String(text).slice(0, 120)}…` });
          });
        }

        const lines = wf
          ? Object.entries(wf.nodeOutputs ?? {})
              .map(([k, v]) => `**${k}**\n${v}`)
              .join('\n\n')
          : '';
        const finalText = finish.ok
          ? `DAG workflow complete: ${def.title}\n\n${lines}`.trim()
          : `DAG workflow failed: ${finish.error ?? 'unknown error'}\n\n${lines}`.trim();

        emit({
          phase: 'idle',
          headline: 'Awaiting input…',
          sopSteps: null,
        });
        return {
          finalText,
          trace,
          route: decision,
          inferenceCallCount,
          platformRoute: {
            mode: platformRoute.mode,
            confidence: platformRoute.confidence,
            rationaleTrace: platformRoute.rationaleTrace,
            sopBundleId: platformRoute.sopBundleId,
            sopVersion: platformRoute.sopVersion,
          },
        };
      }

      let accumulated = `User goal:\n${user}\n\n`;
      const sopSteps = buildSopSteps(decision.sopId)!;

      emit({
        phase: 'sop_running',
        headline: headlineForPhase('sop_running', decision, def.title),
        sopSteps: [...sopSteps],
      });

      for (let i = 0; i < def.steps.length; i++) {
        const step = def.steps[i];
        sopSteps[i] = { ...sopSteps[i], status: 'running' };
        emit({
          phase: 'sop_running',
          headline: `${headlineForPhase('sop_running', decision, def.title)} — Step ${i + 1} of ${def.steps.length}`,
          sopSteps: [...sopSteps],
        });

        const stepPrompt = `Execute only this SOP step. Output concise findings for the user.\n\nStep (${i + 1}/${def.steps.length}): ${step.label}`;
        const res = await engine.executeInference({
          prompt: stepPrompt,
          context: accumulated,
          mode: 'sop_step',
          metadata: { sopId: def.id, stepId: step.id },
          finetunePersonaSystem: finetunePersona,
        });
        accumulated += `Step ${i + 1} (${step.label}) result:\n${res.text}\n\n`;
        res.telemetry?.forEach((m) => pushTrace({ type: 'log', message: m }));
        sopSteps[i] = { ...sopSteps[i], status: 'done' };
        emit({
          phase: 'sop_running',
          headline: `${headlineForPhase('sop_running', decision, def.title)} — Step ${i + 1} of ${def.steps.length}`,
          sopSteps: [...sopSteps],
        });
      }

      const finalText = `SOP complete: ${def.title}\n\n${accumulated.trim()}`;
      emit({ phase: 'idle', headline: 'Awaiting input…', sopSteps: null });
      return {
        finalText,
        trace,
        route: decision,
        inferenceCallCount,
        platformRoute: {
          mode: platformRoute.mode,
          confidence: platformRoute.confidence,
          rationaleTrace: platformRoute.rationaleTrace,
          sopBundleId: platformRoute.sopBundleId,
          sopVersion: platformRoute.sopVersion,
        },
      };
    }

    emit({ phase: 'direct_inference', headline: headlineForPhase('direct_inference', decision), sopSteps: null });
    const res = await engine.executeInference({
      prompt: user,
      context: '',
      mode: 'direct',
      finetunePersonaSystem: finetunePersona,
    });
    inferenceCallCount += 1;
    res.telemetry?.forEach((m) => pushTrace({ type: 'log', message: m }));
    emit({ phase: 'idle', headline: 'Awaiting input…', sopSteps: null });
    return {
      finalText: res.text,
      trace,
      route: decision,
      inferenceCallCount,
      platformRoute: {
        mode: platformRoute.mode,
        confidence: platformRoute.confidence,
        rationaleTrace: platformRoute.rationaleTrace,
        sopBundleId: platformRoute.sopBundleId,
        sopVersion: platformRoute.sopVersion,
      },
    };
  } catch (e) {
    const msg = String(e);
    pushTrace({ type: 'log', message: `> error: ${msg}` });
    emit({
      phase: 'error',
      headline: headlineForPhase('error', decision),
      sopSteps: null,
    });
    emit({ phase: 'idle', headline: 'Awaiting input…', sopSteps: null });
    return {
      finalText: `Error: ${msg}`,
      trace,
      route: decision,
      inferenceCallCount,
      platformRoute: {
        mode: platformRoute.mode,
        confidence: platformRoute.confidence,
        rationaleTrace: platformRoute.rationaleTrace,
        sopBundleId: platformRoute.sopBundleId,
        sopVersion: platformRoute.sopVersion,
      },
    };
  }
}
