import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { GitBranch, Play, Upload, FileJson, FileType } from 'lucide-react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { ReactFlowCommandMenu } from '@/components/ReactFlowCommandMenu';
import { useKanbanStore } from '@/store';
import { getNativeLlmPaths, isTauriRuntime } from '@/config/nativeLlm';
import { defaultLlamaSamplingPayload } from '@/llm/llamaSamplingDefaults';
import { SopDagNode } from '@/components/SopDagNode';
import type { AgentDagEdge, AgentDagNode, NormalizedSop } from '@/types/agentDag';
import { extractTextFromPdfArrayBuffer } from '@/lib/extractPdfText';
import { toRustDagGraph } from '@/hermes/tauriWorkflowRun';
import { invokeDagPublishGraph } from '@/hermes/dagPublishInvoke';
import { resolveBundleAuditForAdHocGraph } from '@/hermes/resolveWorkflowBundle';
import { webviewDebugLog } from '@/lib/webviewDebugLog';
import { useTauriReactFlowBlankWatchdog } from '@/lib/useTauriReactFlowBlankWatchdog';
import { TauriReactFlowViewportHeal } from '@/components/TauriReactFlowViewportHeal';

const nodeTypes = { sopDag: SopDagNode };

/** See PlaygroundScreen — keeps node shell receiving events when canvas lock turns off RF select+drag. */
function noopNodeMouseEnterForPointerEvents() {}

function toFlowNode(n: AgentDagNode, selected: boolean): Node<AgentDagNode> {
  return { id: n.id, type: 'sopDag', position: n.position, selected, data: { ...n } };
}

const raciRowY: Record<AgentDagNode['raciLayer'], number> = {
  responsible: 0,
  accountable: 160,
  consulted: 320,
  informed: 480,
};

function fromFlowNode(rf: Node<AgentDagNode>): AgentDagNode {
  return { ...rf.data, id: rf.id, position: rf.position };
}

function buildDagFromNormalizedSop(normalized: NormalizedSop): { nodes: AgentDagNode[]; edges: AgentDagEdge[] } {
  const steps = normalized.steps ?? [];
  const nodes: AgentDagNode[] = steps.map((s, idx) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `n-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 10)}`;
    const imperative = (s.imperative ?? '').trim();
    const actionKind = (s.actionKind ?? '').trim();
    const labelRaw = imperative || `Step ${s.n ?? idx + 1}`;
    const label = labelRaw.length > 44 ? `${labelRaw.slice(0, 41)}…` : labelRaw;
    const prompt = actionKind ? `${imperative}\n\nAction kind: ${actionKind}` : imperative;

    // Default all new steps to "responsible". Users can re-assign layers per node.
    const raciLayer: AgentDagNode['raciLayer'] = 'responsible';

    return {
      id,
      label,
      prompt: prompt || labelRaw,
      executionTarget: 'localQvac',
      requiresSystemTool: false,
      systemToolName: null,
      systemToolArgsSummary: null,
      raciLayer,
      position: { x: 40 + idx * 300, y: raciRowY[raciLayer] },
    };
  });

  const edges: AgentDagEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${nodes[i].id}-${nodes[i + 1].id}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    });
  }
  return { nodes, edges };
}

function buildLlamaOptions(placeholderPrompt: string) {
  const { exePath, modelPath } = getNativeLlmPaths();
  return {
    exePath,
    modelPath,
    ctxSize: 4096,
    ...defaultLlamaSamplingPayload(),
    initialPrompt: placeholderPrompt,
    maxNewTokens: 1024,
  };
}

function buildSopNormalizeLlamaOptions() {
  return { ...buildLlamaOptions('System: x\nUser: y\nAssistant: '), maxNewTokens: 3072 };
}

interface SopGraphScreenProps {
  sidebarCollapsed: boolean;
}

/**
 * Must be a child of `<ReactFlow>` so it lives in the RF wrapper (correct stacking + `nopan`/`nodrag`).
 * Adds nodes via `addNodes()` so the controlled `onNodesChange` path runs (direct zustand-only adds can desync RF).
 */
function SopGraphInFlowToolbar({
  onDeleteSelected,
  selectedCount,
  busy,
  canvasInteractive,
  onToggleInteractive,
  syncToRust,
  runDag,
}: {
  onDeleteSelected: () => void;
  selectedCount: number;
  busy: boolean;
  canvasInteractive: boolean;
  onToggleInteractive: () => void;
  syncToRust: () => void | Promise<void>;
  runDag: () => void | Promise<void>;
}) {
  const { addNodes } = useReactFlow();

  const handleAddNode = useCallback(() => {
    const ns = useKanbanStore.getState().agentDagNodes;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `n-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let position: { x: number; y: number };
    if (ns.length === 0) {
      position = { x: 120, y: 120 };
    } else {
      const maxX = ns.reduce((acc, n) => Math.max(acc, n.position.x), -Infinity);
      const avgY = ns.reduce((sum, n) => sum + n.position.y, 0) / ns.length;
      position = { x: maxX + 300, y: avgY };
    }
    const agent: AgentDagNode = {
      id,
      label: 'New step',
      prompt: 'Describe what this node does.',
      executionTarget: 'localQvac',
      requiresSystemTool: false,
      systemToolName: null,
      systemToolArgsSummary: null,
      raciLayer: 'responsible',
      position,
    };
    const rfNode: Node<AgentDagNode> = {
      id: agent.id,
      type: 'sopDag',
      position: agent.position,
      data: { ...agent },
    };
    addNodes(rfNode);
  }, [addNodes]);

  return (
    <div
      className="nopan nodrag nowheel pointer-events-auto absolute bottom-3 left-1/2 z-[60] -translate-x-1/2"
      role="toolbar"
      aria-label="Graph tools"
    >
      <ReactFlowCommandMenu
        onAddNode={handleAddNode}
        onDeleteSelected={onDeleteSelected}
        selectedCount={selectedCount}
        enableGrouping={false}
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        interactive={canvasInteractive}
        onToggleInteractive={onToggleInteractive}
        trailing={
          <>
            <button
              type="button"
              onClick={() => void syncToRust()}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/80"
              title="Sync graph to Rust"
            >
              <Upload className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runDag()}
              className="rounded-md p-2 text-violet-600 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-400 dark:hover:bg-violet-950/50"
              title="Run DAG"
            >
              <Play className="h-5 w-5" />
            </button>
          </>
        }
      />
    </div>
  );
}

function SopGraphInner({ sidebarCollapsed }: SopGraphScreenProps) {
  const { sopId } = useParams<{ sopId: string }>();
  const navigate = useNavigate();
  const loadAgentSopIntoEditor = useKanbanStore((s) => s.loadAgentSopIntoEditor);
  const clearEditingAgentSop = useKanbanStore((s) => s.clearEditingAgentSop);
  const agentSops = useKanbanStore((s) => s.agentSops);
  const agentDagNodes = useKanbanStore((s) => s.agentDagNodes);
  const agentDagEdges = useKanbanStore((s) => s.agentDagEdges);
  const agentDagLog = useKanbanStore((s) => s.agentDagLog);
  const clearAgentDagLog = useKanbanStore((s) => s.clearAgentDagLog);
  const appendAgentDagLog = useKanbanStore((s) => s.appendAgentDagLog);

  const activeSopMeta = useMemo(
    () => (sopId ? agentSops.find((s) => s.id === sopId) : undefined),
    [agentSops, sopId],
  );

  useEffect(() => {
    if (!sopId) {
      navigate('/agent-sop', { replace: true });
      return;
    }
    const exists = useKanbanStore.getState().agentSops.some((s) => s.id === sopId);
    if (!exists) {
      navigate('/agent-sop', { replace: true });
      return;
    }
    loadAgentSopIntoEditor(sopId);
    return () => clearEditingAgentSop();
  }, [sopId, navigate, loadAgentSopIntoEditor, clearEditingAgentSop]);

  const [sopInput, setSopInput] = useState('');
  const [normalizedPreview, setNormalizedPreview] = useState<NormalizedSop | null>(null);
  const [busy, setBusy] = useState(false);
  const sopPdfInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canvasInteractive, setCanvasInteractive] = useState(true);
  const [flowRenderReady, setFlowRenderReady] = useState(false);
  const [flowRecoveryNonce, setFlowRecoveryNonce] = useState(0);
  const bumpRfRemount = useCallback(() => setFlowRecoveryNonce((n) => n + 1), []);
  const [tauriRfHealNonce, setTauriRfHealNonce] = useState(0);
  const bumpTauriRfHeal = useCallback(() => setTauriRfHealNonce((n) => n + 1), []);
  const lastMoveHealAtRef = useRef(0);
  useEffect(() => {
    const t = window.setTimeout(() => setFlowRenderReady(true), 100);
    return () => window.clearTimeout(t);
  }, []);

  const flowMountHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = flowMountHostRef.current;
    if (!host) return;
    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const cr = e?.contentRect;
      if (!cr) return;
      if (cr.width < 20 || cr.height < 20) {
        console.error('='.repeat(140));
        console.error('RENDER FAILURE: REACTFLOW HOST COLLAPSED');
        console.error('host size:', { width: cr.width, height: cr.height });
        console.error('='.repeat(140));
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const nodes = useMemo(
    () => agentDagNodes.map((n) => toFlowNode(n, selectedIds.includes(n.id))),
    [agentDagNodes, selectedIds],
  );
  const edges: Edge[] = useMemo(
    () => agentDagEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    [agentDagEdges],
  );

  const isTauri = isTauriRuntime();

  useEffect(() => {
    if (!isTauri) return;
    void webviewDebugLog('sop_graph_open', { sopId: sopId ?? '' });
  }, [isTauri, sopId]);

  useTauriReactFlowBlankWatchdog({
    label: 'sop_graph',
    flowRenderReady,
    hostRef: flowMountHostRef,
    reactNodeCount: nodes.length,
    recoveryNonce: flowRecoveryNonce,
    onRemount: bumpRfRemount,
  });

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // STRICT MONITOR: log bogus coordinates with the exact change event.
    for (const c of changes) {
      if (c.type === 'remove' || c.type === 'reset') {
        console.error('='.repeat(140));
        console.error('REACTFLOW STRUCTURAL CHANGE');
        console.error('change.type:', c.type, 'nodeId:', c.id);
        console.log('onNodesChange event (raw):', c);
        console.error('='.repeat(140));
      }

      if (c.type === 'dimensions') {
        const anyC = c as unknown as Record<string, unknown>;
        const d = (anyC.dimensions ?? anyC) as unknown as { width?: unknown; height?: unknown };
        const w = typeof d?.width === 'number' ? d.width : undefined;
        const h = typeof d?.height === 'number' ? d.height : undefined;
        const badDim =
          w == null ||
          h == null ||
          Number.isNaN(w) ||
          Number.isNaN(h) ||
          !Number.isFinite(w) ||
          !Number.isFinite(h) ||
          w <= 0 ||
          h <= 0 ||
          w > 10_000 ||
          h > 10_000;
        if (badDim) {
          console.error('='.repeat(140));
          console.error('RENDER FAILURE: NODE DIMENSIONS BAD');
          console.error('nodeId:', c.id);
          console.error('dimensions:', d);
          console.log('onNodesChange event (raw):', c);
          console.error('='.repeat(140));
        }
      }
      if (c.type !== 'position') continue;
      const p = (c as NodeChange & { position?: { x?: number; y?: number } }).position;
      if (!p) continue;
      const bad =
        typeof p.x !== 'number' ||
        typeof p.y !== 'number' ||
        Number.isNaN(p.x) ||
        Number.isNaN(p.y) ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 50_000 ||
        Math.abs(p.y) > 50_000;
      if (bad) {
        console.error('='.repeat(140));
        console.error('MATH FAILURE: NODE BECAME NaN');
        console.error('nodeId:', c.id, 'position:', p);
        console.log('onNodesChange event (raw):', c);
        console.error('='.repeat(140));
      }
    }

    // Same rationale as Playground: avoid rebuilding from stale graph snapshots during fast drags.
    setSelectedIds((prevSelected) => {
      const nextSel = new Set(prevSelected);
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) nextSel.add(c.id);
          else nextSel.delete(c.id);
        }
      }

      const structural = changes.filter((c) => c.type !== 'select');
      if (structural.length) {
        useKanbanStore.setState((s) => {
          const rfNodes = s.agentDagNodes.map((n) => toFlowNode(n, nextSel.has(n.id)));
          const nextRf = applyNodeChanges(structural, rfNodes);
          for (const c of structural) {
            if (c.type === 'remove') nextSel.delete(c.id);
          }
          const newNodes = nextRf.map(fromFlowNode);
          const ids = new Set(newNodes.map((n) => n.id));
          const newEdges = s.agentDagEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
          s.setAgentDagState(newNodes, newEdges);
          return {};
        });
      }

      return [...nextSel];
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const state = useKanbanStore.getState();
    const fe = state.agentDagEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    const next = applyEdgeChanges(changes, fe);
    const mapped: AgentDagEdge[] = next.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
    state.setAgentDagState(state.agentDagNodes, mapped);
  }, []);

  const onConnect = useCallback((c: Connection) => {
    const state = useKanbanStore.getState();
    const fe = state.agentDagEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
    const withNew = addEdge(c, fe);
    const mapped: AgentDagEdge[] = withNew.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));
    state.setAgentDagState(state.agentDagNodes, mapped);
  }, []);

  const syncToRust = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendAgentDagLog('Sync skipped: not in Tauri');
      return;
    }
    const state = useKanbanStore.getState();
    try {
      const audit = await resolveBundleAuditForAdHocGraph({
        projectId: state.activeProject?.id ?? null,
        graph: { nodes: state.agentDagNodes, edges: state.agentDagEdges },
        embeddedWorkflowBundles: state.embeddedWorkflowBundles,
        workflowBundlePins: state.workflowBundlePins,
      });
      await invokeDagPublishGraph({
        graph: toRustDagGraph(state.agentDagNodes, state.agentDagEdges),
        bundleId: audit.bundleId,
        bundleVersion: audit.bundleVersion,
        contentDigest: audit.contentDigest,
      });
      appendAgentDagLog('Graph published to Rust orchestrator');
    } catch (e) {
      appendAgentDagLog(`dag_publish_graph error: ${String(e)}`);
    }
  }, [appendAgentDagLog]);

  const runDag = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendAgentDagLog('Run skipped: not in Tauri');
      return;
    }
    setBusy(true);
    const { invoke } = await import('@tauri-apps/api/core');
    const state = useKanbanStore.getState();
    try {
      const audit = await resolveBundleAuditForAdHocGraph({
        projectId: state.activeProject?.id ?? null,
        graph: { nodes: state.agentDagNodes, edges: state.agentDagEdges },
        embeddedWorkflowBundles: state.embeddedWorkflowBundles,
        workflowBundlePins: state.workflowBundlePins,
      });
      await invokeDagPublishGraph({
        graph: toRustDagGraph(state.agentDagNodes, state.agentDagEdges),
        bundleId: audit.bundleId,
        bundleVersion: audit.bundleVersion,
        contentDigest: audit.contentDigest,
      });
      const needsLocal = state.agentDagNodes.some((n) => n.executionTarget === 'localQvac');
      const llamaOptions = needsLocal
        ? buildLlamaOptions(
            'System: placeholder\nUser: hi\nAssistant: ',
          )
        : null;
      await invoke('dag_run_start', {
        args: {
          llamaOptions,
          anthropicModel: null,
        },
      });
      appendAgentDagLog('DAG run started');
    } catch (e) {
      appendAgentDagLog(`dag_run_start error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [appendAgentDagLog]);

  const normalizeSop = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendAgentDagLog('Normalize skipped: not in Tauri');
      return;
    }
    if (!sopInput.trim()) return;
    setBusy(true);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const options = buildSopNormalizeLlamaOptions();
      const result = await invoke<NormalizedSop>('sop_normalize', {
        rawSop: sopInput,
        options,
      });
      setNormalizedPreview(result);
      appendAgentDagLog(`SOP normalized: ${result.steps.length} steps`);
    } catch (e) {
      setNormalizedPreview(null);
      appendAgentDagLog(`sop_normalize error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [sopInput, appendAgentDagLog]);

  const onSopPdfSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        appendAgentDagLog('Please choose a PDF file (.pdf).');
        return;
      }
      setBusy(true);
      try {
        const buf = await file.arrayBuffer();
        const { text, numPages } = await extractTextFromPdfArrayBuffer(buf);
        if (!text.trim()) {
          appendAgentDagLog(
            `PDF "${file.name}" has no extractable text (${numPages} page(s)). It may be scanned images only.`,
          );
          return;
        }
        setSopInput(text);
        appendAgentDagLog(`Loaded PDF "${file.name}": ${numPages} page(s), ${text.length} characters into the SOP box.`);
      } catch (err) {
        appendAgentDagLog(`PDF import error: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [appendAgentDagLog],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const state = useKanbanStore.getState();
    const drop = new Set(selectedIds);
    const newNodes = state.agentDagNodes.filter((n) => !drop.has(n.id));
    const newEdges = state.agentDagEdges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
    state.setAgentDagState(newNodes, newEdges);
    setSelectedIds([]);
  }, [selectedIds]);

  const applyNormalizedToGraph = useCallback(() => {
    if (!normalizedPreview) return;
    const { nodes: newNodes, edges: newEdges } = buildDagFromNormalizedSop(normalizedPreview);
    useKanbanStore.getState().setAgentDagState(newNodes, newEdges);
    setSelectedIds([]);
    appendAgentDagLog(`Applied normalized SOP to graph: ${newNodes.length} node(s), ${newEdges.length} edge(s)`);
  }, [normalizedPreview, appendAgentDagLog]);

  return (
    <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed} showAgents={false}>
      <main className="flex h-[calc(100vh-73px)] min-h-0 flex-col gap-4 px-4 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/agent-sop"
            className="text-sm font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200"
          >
            ← SOP list
          </Link>
          <h1 className="mr-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <GitBranch className="h-5 w-5 text-violet-600" />
            {activeSopMeta?.name ?? 'SOP'}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Toolbar: add, fit, zoom, lock, delete, sync, run. Edits save to this SOP.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-3">
          <div
            ref={flowMountHostRef}
            className={`relative min-h-[420px] rounded-xl border border-violet-200/50 bg-white/40 dark:border-blue-800/50 dark:bg-slate-900/40 xl:col-span-2 ${
              isTauriRuntime() ? 'overflow-visible' : 'overflow-hidden'
            }`}
          >
            {flowRenderReady ? (
              <ReactFlow
                key={`${sopId}-r${flowRecoveryNonce}`}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStart={() => {
                  if (isTauri) void webviewDebugLog('sop_graph_node_drag_start', { nodes: nodes.length, sopId });
                }}
                onNodeDragStop={() => {
                  if (isTauri) {
                    void webviewDebugLog('sop_graph_node_drag_stop', {
                      nodes: nodes.length,
                      sopId,
                      remount: true,
                    });
                    bumpRfRemount();
                  }
                }}
                onMoveEnd={() => {
                  if (!isTauri) return;
                  const now = Date.now();
                  if (now - lastMoveHealAtRef.current < 500) return;
                  lastMoveHealAtRef.current = now;
                  bumpTauriRfHeal();
                }}
                onNodeMouseEnter={noopNodeMouseEnterForPointerEvents}
                nodeTypes={nodeTypes}
                nodesDraggable={canvasInteractive}
                nodesConnectable={canvasInteractive}
                nodesFocusable={false}
                elementsSelectable={canvasInteractive}
                deleteKeyCode={null}
                fitView
                // WebView2: same as playground — immediate drag + remount on drag stop.
                nodeDragThreshold={isTauri ? 0 : undefined}
                className="absolute inset-0 bg-transparent"
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                {isTauri ? <TauriReactFlowViewportHeal nonce={tauriRfHealNonce} /> : null}
                <MiniMap />
                {nodes.length === 0 ? (
                  <div className="pointer-events-none absolute inset-0 z-[40] flex items-center justify-center p-6">
                    <div className="rounded-xl border border-slate-200 bg-white/90 p-4 text-center text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
                      This SOP has no diagram yet. Paste/load a SOP on the right, normalize it, then apply it to the graph.
                    </div>
                  </div>
                ) : null}
                <SopGraphInFlowToolbar
                  onDeleteSelected={deleteSelected}
                  selectedCount={selectedIds.length}
                  busy={busy}
                  canvasInteractive={canvasInteractive}
                  onToggleInteractive={() => setCanvasInteractive((v) => !v)}
                  syncToRust={syncToRust}
                  runDag={runDag}
                />
              </ReactFlow>
            ) : (
              <div className="absolute inset-0 bg-transparent" />
            )}
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-xl border border-violet-200/50 bg-white/60 p-3 dark:border-blue-800/50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                <FileJson className="h-4 w-4" />
                RACI SOP normalizer (local qvac)
              </div>
              <textarea
                value={sopInput}
                onChange={(e) => setSopInput(e.target.value)}
                placeholder="Paste a messy SOP or load a PDF (text layer); the local model returns structured JSON steps."
                rows={6}
                className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-slate-700"
              />
              <input
                ref={sopPdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(ev) => void onSopPdfSelected(ev)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sopPdfInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 dark:hover:bg-slate-600"
                >
                  <FileType className="h-4 w-4" />
                  Load PDF
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void normalizeSop()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm text-white hover:bg-cyan-700 disabled:opacity-50"
                >
                  Normalize with llama-cli
                </button>
                <button
                  type="button"
                  disabled={busy || !normalizedPreview}
                  onClick={applyNormalizedToGraph}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                  title={normalizedPreview ? 'Convert normalized JSON into a graph' : 'Normalize first to enable'}
                >
                  Apply to graph
                </button>
              </div>
              {normalizedPreview ? (
                <pre className="max-h-40 overflow-auto rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
                  {JSON.stringify(normalizedPreview, null, 2)}
                </pre>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-violet-200/50 bg-white/60 p-3 dark:border-blue-800/50 dark:bg-slate-800/60">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Run log</span>
                <button
                  type="button"
                  onClick={() => clearAgentDagLog()}
                  className="text-xs text-violet-600 dark:text-violet-400"
                >
                  Clear
                </button>
              </div>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap font-mono text-xs text-gray-700 dark:text-gray-300">
                {agentDagLog.length ? agentDagLog.join('\n') : 'Events from the orchestrator appear here.'}
              </pre>
            </div>
          </div>
        </div>
      </main>
    </AuthenticatedWorkspaceFrame>
  );
}

export function SopGraphScreen(props: SopGraphScreenProps) {
  return (
    <ReactFlowProvider>
      <SopGraphInner {...props} />
    </ReactFlowProvider>
  );
}
