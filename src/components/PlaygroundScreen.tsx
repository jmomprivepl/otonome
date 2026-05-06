import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  Boxes,
  ChevronRight,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
  FileJson,
  GitBranch,
  FileType,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { ReactFlowCommandMenu } from '@/components/ReactFlowCommandMenu';
import { useKanbanStore } from '@/store';
import { getNativeLlmPaths, isTauriRuntime } from '@/config/nativeLlm';
import { defaultLlamaSamplingPayload } from '@/llm/llamaSamplingDefaults';
import { CustomTaskNode } from '@/components/CustomTaskNode';
import type {
  AgentDagEdge,
  AgentDagNode,
  NormalizedSop,
  RaciLayer,
  SopStep,
} from '@/types/agentDag';
import type { PlaygroundBreadcrumbSeg, PlaygroundDagNode, PlaygroundNestedForest } from '@/types/playgroundWorkflow';
import { createPlaygroundNestedMockForest } from '@/data/playgroundNestedMock';
import {
  patchNodeInForest,
  replaceViewInForest,
  resolveNestedView,
  toAgentLayerSnapshot,
} from '@/lib/playgroundNestedTree';
import {
  parseDecomposeTaskResponse,
  runTaskManagerDecomposition,
  subtasksToSubGraph,
} from '@/lib/playgroundTaskManagerDecompose';
import { PlaygroundDrillProvider } from '@/contexts/playgroundWorkflowContext';
import { SopDagUpdateContext } from '@/components/sopDagUpdateContext';
import { PlaygroundRightButtonMarquee } from '@/components/PlaygroundRightButtonMarquee';
import { extractTextFromPdfArrayBuffer } from '@/lib/extractPdfText';
import './playground-flow.css';

const PLAYGROUND_FLOW_ID = 'playground-react-flow';

const ROOT_BREADCRUMB: PlaygroundBreadcrumbSeg = { id: '', label: 'Main workflow' };

const nodeTypes = { customTask: CustomTaskNode };

/** React Flow sets `pointer-events: none` on the node shell when nothing is "interactive" there; without this, locking the canvas blocks clicks into `SopDagNode` inputs. */
function noopNodeMouseEnterForPointerEvents() {}

/** Keeps a ref to the latest React Flow graph so actions outside RF (and save) see the real canvas. */
function PlaygroundFlowGraphSnapshot({
  saveRef,
}: {
  saveRef: MutableRefObject<(() => { nodes: AgentDagNode[]; edges: AgentDagEdge[] }) | null>;
}) {
  const { getNodes, getEdges } = useReactFlow();
  saveRef.current = () => {
    const rawNodes = getNodes().map(fromFlowNode);
    return toAgentLayerSnapshot(rawNodes, getEdgesFromRf(getEdges()));
  };
  return null;
}

function getEdgesFromRf(edges: Edge[]): AgentDagEdge[] {
  return edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
}

function toFlowNode(n: PlaygroundDagNode, selected: boolean): Node<PlaygroundDagNode> {
  return { id: n.id, type: 'customTask', position: n.position, selected, data: { ...n } };
}

function fromFlowNode(rf: Node<PlaygroundDagNode>): PlaygroundDagNode {
  return { ...rf.data, id: rf.id, position: rf.position };
}

function subGraphSignature(n: PlaygroundDagNode): string {
  if (!n.subGraph) return '0';
  const inner = n.subGraph.nodes.map((x) => `${x.id}:${x.label}:${x.prompt?.length ?? 0}`).join('|');
  const e = n.subGraph.edges.map((x) => `${x.source}->${x.target}`).join(',');
  return `${n.subGraph.nodes.length}:${inner}#${e}`;
}

/** Avoid new React Flow node refs when only another node changed — critical for WebView2 / Tauri responsiveness. */
function playgroundNodeDataEqual(a: PlaygroundDagNode, b: PlaygroundDagNode): boolean {
  return (
    (a.nodeKind ?? 'agent') === (b.nodeKind ?? 'agent') &&
    a.label === b.label &&
    a.prompt === b.prompt &&
    a.executionTarget === b.executionTarget &&
    a.requiresSystemTool === b.requiresSystemTool &&
    a.systemToolName === b.systemToolName &&
    a.systemToolArgsSummary === b.systemToolArgsSummary &&
    a.raciLayer === b.raciLayer &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    subGraphSignature(a) === subGraphSignature(b)
  );
}

function buildStableFlowNodes(
  dagNodes: PlaygroundDagNode[],
  selectedIds: string[],
  prev: Node<PlaygroundDagNode>[],
): Node<PlaygroundDagNode>[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return dagNodes.map((dag) => {
    const selected = selectedIds.includes(dag.id);
    const old = prevById.get(dag.id);
    if (old && old.selected === selected && playgroundNodeDataEqual(old.data as PlaygroundDagNode, dag)) {
      return old;
    }
    return toFlowNode(dag, selected);
  });
}

function toRustGraph(nodes: (PlaygroundDagNode | AgentDagNode)[], edges: AgentDagEdge[]) {
  return {
    nodes: nodes.map((node) => {
      const { position, subGraph, ...rest } = node as PlaygroundDagNode;
      void position;
      void subGraph;
      return rest as AgentDagNode;
    }),
    edges,
  };
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

/** SOP normalize needs enough headroom for 12 steps of JSON; backend caps at 4096. */
function buildSopNormalizeLlamaOptions() {
  // 1024 is often too small (truncated JSON on real SOPs); CPU time scales roughly with this.
  return { ...buildLlamaOptions('System: x\nUser: y\nAssistant: '), maxNewTokens: 3072 };
}

const raciRowY: Record<AgentDagNode['raciLayer'], number> = {
  responsible: 0,
  accountable: 160,
  consulted: 320,
  informed: 480,
};

const NORM_NODE_X_GAP = 300;

function raciLayerFromActionKind(kind: string): RaciLayer {
  switch (kind) {
    case 'request_approval':
      return 'accountable';
    case 'inform_stakeholder':
      return 'informed';
    case 'escalate':
      return 'accountable';
    case 'document':
      return 'consulted';
    case 'execute_task':
    default:
      return 'responsible';
  }
}

function formatNormStepPrompt(step: SopStep): string {
  const { raci, imperative, actionKind } = step;
  const c = raci.c.length ? raci.c.join(', ') : '—';
  const i = raci.i.length ? raci.i.join(', ') : '—';
  return [
    imperative,
    '',
    `actionKind: ${actionKind}`,
    `R (Responsible): ${raci.r}`,
    `A (Accountable): ${raci.a}`,
    `C (Consulted): ${c}`,
    `I (Informed): ${i}`,
  ].join('\n');
}

function truncateForLabel(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** Build playground DAG nodes (sequential edges) from llama-cli normalization JSON. */
function normalizedSopToPlaygroundGraph(sop: NormalizedSop): PlaygroundNestedForest {
  const steps = sop.steps;
  const nodeIds = steps.map((_, idx) =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `norm-${crypto.randomUUID()}`
      : `norm-${Date.now()}-${idx}`,
  );

  const nodes: PlaygroundDagNode[] = steps.map((step, index) => {
    const raciLayer = raciLayerFromActionKind(step.actionKind);
    const y = raciRowY[raciLayer];
    return {
      id: nodeIds[index],
      label: `Step ${step.n}: ${truncateForLabel(step.imperative, 52)}`,
      prompt: formatNormStepPrompt(step),
      executionTarget: 'localQvac' as const,
      requiresSystemTool: false,
      systemToolName: null,
      systemToolArgsSummary: null,
      raciLayer,
      position: { x: 40 + index * NORM_NODE_X_GAP, y },
    };
  });

  const edges: AgentDagEdge[] = [];
  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    edges.push({
      id: `norm-e-${i}-${nodeIds[i]}-${nodeIds[i + 1]}`,
      source: nodeIds[i],
      target: nodeIds[i + 1],
    });
  }

  return { nodes, edges };
}

function cloneForestShallow(record: { nodes: AgentDagNode[]; edges: AgentDagEdge[] }): PlaygroundNestedForest {
  return {
    nodes: record.nodes.map((n) => ({
      ...(n as PlaygroundDagNode),
      position: { ...n.position },
    })),
    edges: record.edges.map((e) => ({ ...e })),
  };
}

/** Deep clone nested mock / forest (subGraph-safe). */
function deepCloneForest(f: PlaygroundNestedForest): PlaygroundNestedForest {
  return JSON.parse(JSON.stringify(f)) as PlaygroundNestedForest;
}

interface PlaygroundScreenProps {
  sidebarCollapsed: boolean;
}

/** Must render inside `<ReactFlow>` so `useReactFlow` is bound to this canvas. */
function PlaygroundFitViewTrigger({ nonce }: { nonce: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nonce === 0) return;
    const id = requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.2, maxZoom: 1.2 });
      } catch {
        /* ignore */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [nonce, fitView]);
  return null;
}

function PlaygroundGraphInFlowToolbar({
  dagNodes,
  onAddAgentNode,
  onDeleteSelected,
  selectedCount,
  busy,
  canvasInteractive,
  onToggleInteractive,
  syncToRust,
  runDag,
}: {
  dagNodes: PlaygroundDagNode[];
  onAddAgentNode: (agent: PlaygroundDagNode) => void;
  onDeleteSelected: () => void;
  selectedCount: number;
  busy: boolean;
  canvasInteractive: boolean;
  onToggleInteractive: () => void;
  syncToRust: () => void | Promise<void>;
  runDag: () => void | Promise<void>;
}) {
  const handleAddNode = useCallback(() => {
    const ns = dagNodes;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let position: { x: number; y: number };
    if (ns.length === 0) {
      position = { x: 120, y: 120 };
    } else {
      const maxX = ns.reduce((acc, n) => Math.max(acc, n.position.x), -Infinity);
      const avgY = ns.reduce((sum, n) => sum + n.position.y, 0) / ns.length;
      position = { x: maxX + 300, y: avgY };
    }
    const agent: PlaygroundDagNode = {
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
    onAddAgentNode(agent);
  }, [dagNodes, onAddAgentNode]);

  return (
    <div
      className="nopan nodrag nowheel pointer-events-auto absolute bottom-3 left-1/2 z-[60] -translate-x-1/2"
      role="toolbar"
      aria-label="Playground graph tools"
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
              title="Sync sandbox graph to Rust"
            >
              <Upload className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runDag()}
              className="rounded-md p-2 text-violet-600 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-violet-400 dark:hover:bg-violet-950/50"
              title="Run sandbox DAG"
            >
              <Play className="h-5 w-5" />
            </button>
          </>
        }
      />
    </div>
  );
}

function initialPlaygroundForest(): PlaygroundNestedForest {
  if (typeof window === 'undefined') return createPlaygroundNestedMockForest();
  const urlId = new URLSearchParams(window.location.search).get('sop');
  if (!urlId) return deepCloneForest(createPlaygroundNestedMockForest());
  const rec = useKanbanStore.getState().agentSops.find((s) => s.id === urlId);
  if (!rec) return deepCloneForest(createPlaygroundNestedMockForest());
  return cloneForestShallow(rec);
}

function PlaygroundInner({ sidebarCollapsed }: PlaygroundScreenProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sopIdFromUrl = searchParams.get('sop');
  const agentSops = useKanbanStore((s) => s.agentSops);

  const flowMountHostRef = useRef<HTMLDivElement>(null);
  const [flowPixelSize, setFlowPixelSize] = useState<{ width: number; height: number } | null>(null);
  const [flowRenderReady, setFlowRenderReady] = useState(false);
  const [webviewRepaintGuardOn, setWebviewRepaintGuardOn] = useState(false);
  const webviewBlankFixCooldownRef = useRef(0);
  const webviewBlankConsecutiveRef = useRef(0);
  useEffect(() => {
    const t = window.setTimeout(() => setFlowRenderReady(true), 100);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    const host = flowMountHostRef.current;
    if (!host) return;
    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      const cr = e?.contentRect;
      if (!cr) return;

      // Keep React Flow wrapper in sync with real pixels. WebView2 can drift if this is "auto".
      const width = Math.max(1, Math.floor(cr.width));
      const height = Math.max(1, Math.floor(cr.height));
      setFlowPixelSize({ width, height });

      // If the host collapses during drag, React Flow can "lose" the viewport and appear blank.
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!webviewRepaintGuardOn) return;
    const host = flowMountHostRef.current;
    if (!host) return;

    const viewport = host.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) return;

    let tick = 0;
    const id = window.setInterval(() => {
      // Nudge compositor without touching layout/transform math.
      // WebView2 can drop transformed layers; toggling a trivial filter forces repaint.
      tick += 1;
      viewport.style.filter = tick % 2 === 0 ? 'opacity(0.99999)' : 'opacity(1)';
    }, 120);
    return () => {
      window.clearInterval(id);
      viewport.style.filter = '';
    };
  }, [webviewRepaintGuardOn]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!webviewRepaintGuardOn) return;

    const host = flowMountHostRef.current;
    if (!host) return;
    const viewport = host.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) return;

    const forceRepaint = () => {
      const now = Date.now();
      if (now - webviewBlankFixCooldownRef.current < 1000) return;
      webviewBlankFixCooldownRef.current = now;
      try {
        const prevDisplay = viewport.style.display;
        viewport.style.display = 'none';
        void viewport.offsetHeight;
        viewport.style.display = prevDisplay;
      } catch {
        /* ignore */
      }
    };

    const interval = window.setInterval(() => {
      try {
        const hostRect = host.getBoundingClientRect();
        if (hostRect.width < 20 || hostRect.height < 20) return;

        const nodeEl = host.querySelector<HTMLElement>('.react-flow__node');
        if (!nodeEl) return;

        const nodeRect = nodeEl.getBoundingClientRect();
        const blankLikely = nodeRect.width <= 1 || nodeRect.height <= 1;
        if (!blankLikely) {
          webviewBlankConsecutiveRef.current = 0;
          return;
        }

        webviewBlankConsecutiveRef.current += 1;
        if (webviewBlankConsecutiveRef.current < 2) return;

        const vpRect = viewport.getBoundingClientRect();
        const cs = window.getComputedStyle(viewport);
        console.error('='.repeat(140));
        console.error('WEBVIEW2 RENDER FAILURE: REACTFLOW BLANK FRAME DETECTED');
        console.error('hostRect:', { w: hostRect.width, h: hostRect.height });
        console.error('viewportRect:', { w: vpRect.width, h: vpRect.height });
        console.error('nodeRect:', { w: nodeRect.width, h: nodeRect.height });
        console.error('viewport styles:', {
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          transform: cs.transform,
          filter: cs.filter,
          willChange: cs.willChange,
        });
        console.error('='.repeat(140));

        forceRepaint();
      } catch {
        /* ignore */
      }
    }, 220);

    return () => window.clearInterval(interval);
  }, [webviewRepaintGuardOn]);
  useLayoutEffect(() => {
    const host = flowMountHostRef.current;
    if (!host) return;

    let raf = 0;
    let attempts = 0;

    const measure = () => {
      attempts += 1;
      const r = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(r.width));
      const height = Math.max(1, Math.floor(r.height));

      // WebView2/Tauri: on first mount this can be 0x0 for a frame; retry a few times.
      if ((r.width <= 1 || r.height <= 1) && attempts < 6) {
        raf = requestAnimationFrame(measure);
        return;
      }
      setFlowPixelSize({ width, height });
    };

    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [forest, setForest] = useState<PlaygroundNestedForest>(initialPlaygroundForest);
  const forestRef = useRef(forest);
  useEffect(() => {
    forestRef.current = forest;
  }, [forest]);

  const [navigationTrail, setNavigationTrail] = useState<PlaygroundBreadcrumbSeg[]>(() => [ROOT_BREADCRUMB]);

  const drillPath = useMemo(() => navigationTrail.slice(1).map((s) => s.id), [navigationTrail]);

  const drillPathRef = useRef(drillPath);
  useEffect(() => {
    drillPathRef.current = drillPath;
  }, [drillPath]);

  const { nodes: dagNodes, edges: dagEdges } = useMemo(
    () => resolveNestedView(forest, drillPath),
    [forest, drillPath],
  );

  // If the current drill path becomes invalid (transient or permanent), avoid rendering a blank canvas.
  // We snap back to the main workflow rather than letting the view go empty and "look cleared".
  const lastInvalidDrillKeyRef = useRef<string>('');
  useEffect(() => {
    if (drillPath.length === 0) return;
    if (dagNodes.length > 0) return;
    if (forest.nodes.length === 0) return;

    const key = drillPath.join('>');
    // Fire once per invalid path (prevents render loops / UI hangs).
    if (lastInvalidDrillKeyRef.current === key) return;
    lastInvalidDrillKeyRef.current = key;
    setNavigationTrail([ROOT_BREADCRUMB]);
    setSelectedIds([]);
    // Avoid fitView / logging here; those can amplify loops when ReactFlow is remounting.
  }, [dagNodes.length, drillPath, forest.nodes.length]);

  const flowGraphRef = useRef<(() => { nodes: AgentDagNode[]; edges: AgentDagEdge[] }) | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const importPlaygroundAsNewAgentSop = useKanbanStore((s) => s.importPlaygroundAsNewAgentSop);
  const updatePersistedAgentSopGraph = useKanbanStore((s) => s.updatePersistedAgentSopGraph);
  /** When set, playground forest was already seeded from `/playground?sop=…` — do not overwrite on unrelated Kanban updates. */
  const forestHydratedFromSopUrlRef = useRef<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const getSandboxGraph = useCallback(() => {
    return flowGraphRef.current?.() ?? toAgentLayerSnapshot(dagNodes, dagEdges);
  }, [dagNodes, dagEdges]);

  const appendLog = useCallback((line: string) => {
    setLogLines((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  const sopRecordFromUrl = useMemo(
    () => (sopIdFromUrl ? agentSops.find((s) => s.id === sopIdFromUrl) : undefined),
    [sopIdFromUrl, agentSops],
  );

  const [sopInput, setSopInput] = useState('');
  const [normalizedPreview, setNormalizedPreview] = useState<NormalizedSop | null>(null);
  const [busy, setBusy] = useState(false);
  const sopPdfInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [canvasInteractive, setCanvasInteractive] = useState(true);

  const drillInto = useCallback(
    (containerNodeId: string) => {
      const node = dagNodes.find((n) => n.id === containerNodeId);
      if (!node?.subGraph) return;
      setNavigationTrail((t) => [...t, { id: node.id, label: node.label }]);
      setSelectedIds([]);
      setFitNonce((n) => n + 1);
    },
    [dagNodes],
  );

  const createSubworkflowFromAgent = useCallback(
    async (nodeId: string) => {
      const pathAtStart = [...drillPathRef.current];
      const snapshot = forestRef.current;
      const layer = resolveNestedView(snapshot, pathAtStart);
      const node = layer.nodes.find((n) => n.id === nodeId);
      if (!node) {
        appendLog(`Create sub-workflow: node not found on this canvas (depth snapshot).`);
        return;
      }
      if ((node.subGraph?.nodes.length ?? 0) > 0) return;

      const labelForLog = node.label;
      try {
        appendLog(`Task Manager is decomposing "${node.label}"…`);
        const raw = await runTaskManagerDecomposition({ title: node.label, description: node.prompt });
        const subtasks = parseDecomposeTaskResponse(raw);
        const subGraph = subtasksToSubGraph(subtasks, node.raciLayer);
        let appliedOk = false;
        setForest((prev) => {
          const next = patchNodeInForest(prev, pathAtStart, nodeId, { subGraph });
          appliedOk = Boolean(
            resolveNestedView(next, pathAtStart).nodes.find((t) => t.id === nodeId)?.subGraph?.nodes?.length,
          );
          return next;
        });
        if (appliedOk) {
          appendLog(`Created sub-workflow with ${subtasks.length} step(s) under "${labelForLog}".`);
          setFitNonce((n) => n + 1);
        } else {
          appendLog(
            `Sub-workflow generation finished but nothing was attached (canvas depth or IDs changed during generation). Drill back to where you started and try again.`,
          );
        }
      } catch (err) {
        appendLog(`Sub-workflow creation failed: ${String(err)}`);
      }
    },
    [appendLog],
  );

  const drillApi = useMemo(
    () => ({ drillInto, createSubworkflowFromAgent }),
    [drillInto, createSubworkflowFromAgent],
  );

  const navigateBreadcrumbTo = useCallback((index: number) => {
    setNavigationTrail((t) => t.slice(0, index + 1));
    setSelectedIds([]);
    setFitNonce((n) => n + 1);
  }, []);

  useLayoutEffect(() => {
    if (!sopIdFromUrl) {
      forestHydratedFromSopUrlRef.current = null;
      return;
    }
    if (forestHydratedFromSopUrlRef.current === sopIdFromUrl) return;

    const rec = useKanbanStore.getState().agentSops.find((s) => s.id === sopIdFromUrl);
    if (!rec) {
      appendLog(`No SOP found for id in URL (it may have been deleted).`);
      forestHydratedFromSopUrlRef.current = null;
      navigate('/playground', { replace: true });
      return;
    }

    forestHydratedFromSopUrlRef.current = sopIdFromUrl;
    setForest(cloneForestShallow(rec));
    setNavigationTrail([ROOT_BREADCRUMB]);
    setSelectedIds([]);
    setFitNonce((n) => n + 1);
    appendLog(`Loaded saved SOP: ${rec.name}`);
  }, [sopIdFromUrl, navigate, appendLog]);

  const flowNodesRef = useRef<Node<PlaygroundDagNode>[]>([]);
  const nodes = useMemo(() => {
    const next = buildStableFlowNodes(dagNodes, selectedIds, flowNodesRef.current);
    flowNodesRef.current = next;
    return next;
  }, [dagNodes, selectedIds]);

  const flowEdgesRef = useRef<Edge[]>([]);
  const edges: Edge[] = useMemo(() => {
    const prev = flowEdgesRef.current;
    const prevById = new Map(prev.map((e) => [e.id, e]));
    const next = dagEdges.map((e) => {
      const old = prevById.get(e.id);
      if (old && old.source === e.source && old.target === e.target) {
        return old;
      }
      return { id: e.id, source: e.source, target: e.target };
    });
    flowEdgesRef.current = next;
    return next;
  }, [dagEdges]);

  const isTauri = isTauriRuntime();

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // STRICT MONITOR: if React Flow emits a bogus coordinate, log the exact event.
    for (const c of changes) {
      // Only log structural changes that can actually remove/blank the graph.
      if (c.type === 'remove' || c.type === 'reset') {
        console.error('='.repeat(140));
        console.error('REACTFLOW STRUCTURAL CHANGE');
        console.error('change.type:', c.type, 'nodeId:', c.id);
        console.log('onNodesChange event (raw):', c);
        console.error('='.repeat(140));
      }

      // Dimensions changes are normal; only log if they are clearly broken.
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

    // IMPORTANT: use functional `setDagNodes` updates here.
    // During drags, React Flow can emit many `onNodesChange` events in quick succession; if we
    // rebuild `applyNodeChanges` from a stale `dagNodes` closure, we can accidentally drop nodes.
    setSelectedIds((prevSelected) => {
      const nextSel = new Set(prevSelected);
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) nextSel.add(c.id);
          else nextSel.delete(c.id);
        }
      }

      // We persist ONLY position updates during drag/move.
      // React Flow can emit other change types (reset/remove/add) during internal re-init which can
      // accidentally wipe a controlled graph if we rebuild nodes from those changes.
      const posChanges = changes.filter((c) => c.type === 'position') as Array<
        NodeChange & { type: 'position'; position?: { x: number; y: number } }
      >;
      if (posChanges.length) {
        setForest((prevForest) => {
          const path = drillPathRef.current;
          const { nodes: sliceNodes, edges: sliceEdges } = resolveNestedView(prevForest, path);
          // Defensive: if the current drill path no longer resolves (e.g. transient state during
          // node updates), do not overwrite the entire workflow slice with an empty graph.
          if (path.length > 0 && sliceNodes.length === 0) {
            return prevForest;
          }
          const byId = new Map(posChanges.map((c) => [c.id, c.position]));
          const newNodes = sliceNodes.map((n) => {
            const p = byId.get(n.id);
            if (!p) return n;
            // Ignore malformed position payloads, but leave a log breadcrumb so we know it happened.
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
              console.error('nodeId:', n.id, 'position:', p);
              console.log('onNodesChange batch (raw):', posChanges);
              console.error('='.repeat(140));
              return n;
            }
            if (p.x === n.position.x && p.y === n.position.y) return n;
            return { ...n, position: { x: p.x, y: p.y } };
          });
          return replaceViewInForest(prevForest, path, newNodes, sliceEdges);
        });
      }

      return [...nextSel];
    });
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setForest((prevForest) => {
      const path = drillPathRef.current;
      const { nodes: sliceNodes, edges: sliceEdges } = resolveNestedView(prevForest, path);
      if (path.length > 0 && sliceNodes.length === 0) return prevForest;
      const safeChanges = changes.filter((c) => c.type !== 'reset');
      if (safeChanges.length === 0) return prevForest;
      const fe = sliceEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
      const next = applyEdgeChanges(safeChanges, fe);
      const mapped: AgentDagEdge[] = next.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      }));
      return replaceViewInForest(prevForest, path, sliceNodes, mapped);
    });
  }, []);

  const onConnect = useCallback((c: Connection) => {
    setForest((prevForest) => {
      const path = drillPathRef.current;
      const { nodes: sliceNodes, edges: sliceEdges } = resolveNestedView(prevForest, path);
      if (path.length > 0 && sliceNodes.length === 0) return prevForest;
      const fe = sliceEdges.map((e) => ({ id: e.id, source: e.source, target: e.target }));
      const withNew = addEdge(c, fe);
      const mapped: AgentDagEdge[] = withNew.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      }));
      return replaceViewInForest(prevForest, path, sliceNodes, mapped);
    });
  }, []);

  const syncToRust = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendLog('Sync skipped: not in Tauri');
      return;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const { nodes, edges } = getSandboxGraph();
    try {
      await invoke('dag_publish_graph', { graph: toRustGraph(nodes, edges) });
      appendLog('Sandbox graph published to Rust orchestrator');
    } catch (e) {
      appendLog(`dag_publish_graph error: ${String(e)}`);
    }
  }, [getSandboxGraph, appendLog]);

  const runDag = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendLog('Run skipped: not in Tauri');
      return;
    }
    setBusy(true);
    const { invoke } = await import('@tauri-apps/api/core');
    const { nodes, edges } = getSandboxGraph();
    try {
      await invoke('dag_publish_graph', { graph: toRustGraph(nodes, edges) });
      const needsLocal = nodes.some((n) => n.executionTarget === 'localQvac');
      const llamaOptions = needsLocal
        ? buildLlamaOptions('System: placeholder\nUser: hi\nAssistant: ')
        : null;
      await invoke('dag_run_start', {
        args: {
          llamaOptions,
          anthropicModel: null,
        },
      });
      appendLog('Sandbox DAG run started');
    } catch (e) {
      appendLog(`dag_run_start error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [getSandboxGraph, appendLog]);

  const normalizeSop = useCallback(async () => {
    if (!isTauriRuntime()) {
      appendLog('Normalize skipped: not in Tauri');
      return;
    }
    if (!sopInput.trim()) return;
    setBusy(true);
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const options = buildSopNormalizeLlamaOptions();
      appendLog(
        `Normalizing with llama-cli (max ${options.maxNewTokens} new tokens; on CPU this can take several minutes — the UI stays busy until llama-cli finishes or errors)…`,
      );
      const result = await invoke<NormalizedSop>('sop_normalize', {
        rawSop: sopInput,
        options,
      });
      setNormalizedPreview(result);
      const nextForest = normalizedSopToPlaygroundGraph(result);
      setForest(nextForest);
      setNavigationTrail([ROOT_BREADCRUMB]);
      setSelectedIds([]);
      setFitNonce((n) => n + 1);
      appendLog(
        `SOP normalized: ${result.steps.length} steps — workflow updated on the playground canvas.`,
      );
    } catch (e) {
      setNormalizedPreview(null);
      appendLog(`sop_normalize error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [sopInput, appendLog]);

  const onSopPdfSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        appendLog('Please choose a PDF file (.pdf).');
        return;
      }
      setBusy(true);
      try {
        const buf = await file.arrayBuffer();
        const { text, numPages } = await extractTextFromPdfArrayBuffer(buf);
        if (!text.trim()) {
          appendLog(
            `PDF "${file.name}" has no extractable text (${numPages} page(s)). It may be scanned images only — paste text or use OCR elsewhere.`,
          );
          return;
        }
        setSopInput(text);
        appendLog(`Loaded PDF "${file.name}": ${numPages} page(s), ${text.length} characters into the SOP box.`);
      } catch (err) {
        appendLog(`PDF import error: ${String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [appendLog],
  );

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const drop = new Set(selectedIds);
    setForest((prev) => {
      const path = drillPathRef.current;
      const { nodes: sliceNodes, edges: sliceEdges } = resolveNestedView(prev, path);
      const nextNodes = sliceNodes.filter((n) => !drop.has(n.id));
      const nextEdges = sliceEdges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
      return replaceViewInForest(prev, path, nextNodes, nextEdges);
    });
    setSelectedIds([]);
  }, [selectedIds]);

  const resetSandbox = useCallback(() => {
    setForest(deepCloneForest(createPlaygroundNestedMockForest()));
    setNavigationTrail([ROOT_BREADCRUMB]);
    setSelectedIds([]);
    setNormalizedPreview(null);
    forestHydratedFromSopUrlRef.current = null;
    setFitNonce((n) => n + 1);
    navigate('/playground', { replace: true });
    appendLog('Sandbox reset to nested demo workflow');
  }, [appendLog, navigate]);

  const copyToAgentSop = useCallback(() => {
    const { nodes, edges } = getSandboxGraph();
    const id = importPlaygroundAsNewAgentSop(nodes, edges);
    appendLog('Saved a new SOP from this sandbox (From Playground). Opening editor…');
    navigate(`/agent-sop/edit/${id}`);
  }, [getSandboxGraph, importPlaygroundAsNewAgentSop, appendLog, navigate]);

  const savePlaygroundToLoadedSop = useCallback(() => {
    if (!sopIdFromUrl) {
      appendLog('Save: open a saved SOP from Agent SOP first (URL ?sop=…) or use “Save copy to SOP list”.');
      return;
    }
    const ok = updatePersistedAgentSopGraph(sopIdFromUrl, forest);
    if (ok) {
      const name =
        useKanbanStore.getState().agentSops.find((s) => s.id === sopIdFromUrl)?.name ?? sopIdFromUrl;
      appendLog(`Saved workflow to “${name}”.`);
    } else {
      appendLog(`Save failed: no SOP found for that id — reload from Agent SOP or save a copy.`);
    }
  }, [appendLog, sopIdFromUrl, forest, updatePersistedAgentSopGraph]);

  const addPlaygroundNode = useCallback((agent: PlaygroundDagNode) => {
    setForest((prev) => {
      const path = drillPathRef.current;
      const { nodes: sliceNodes, edges: sliceEdges } = resolveNestedView(prev, path);
      return replaceViewInForest(prev, path, [...sliceNodes, agent], sliceEdges);
    });
  }, []);

  const updatePlaygroundNode = useCallback((nodeId: string, patch: Partial<AgentDagNode>) => {
    setForest((prev) => patchNodeInForest(prev, drillPathRef.current, nodeId, patch as Partial<PlaygroundDagNode>));
  }, []);

  const onRightMarqueeCommit = useCallback((ids: string[], e: MouseEvent) => {
    if (e.shiftKey) {
      setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
    } else {
      setSelectedIds(ids);
    }
  }, []);

  return (
    <div
      className={`min-h-screen transition-all duration-300 ${
        sidebarCollapsed ? 'ml-16' : 'ml-64'
      }`}
    >
      <Header sidebarCollapsed={sidebarCollapsed} showAgents={false} />
      <main className="flex h-[calc(100vh-1rem)] flex-col gap-4 px-4 pb-8 pt-[88px]">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold text-gray-900 dark:text-white">
            <span className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-violet-600" />
              Playground
            </span>
            {sopIdFromUrl && sopRecordFromUrl ? (
              <span className="text-base font-normal text-violet-700 dark:text-violet-300">
                — {sopRecordFromUrl.name}
                <Link
                  to={`/agent-sop/edit/${encodeURIComponent(sopIdFromUrl)}`}
                  className="ml-2 text-sm font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
                >
                  Open in graph editor
                </Link>
              </span>
            ) : null}
          </h1>
          <div className="max-w-2xl space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <p>
              Sandbox React Flow canvas. Open a saved SOP from{' '}
              <Link to="/agent-sop" className="font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">
                Agent SOP
              </Link>{' '}
              to load it here via the list. Changes stay in this session unless you{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">Save</span> back to that SOP or use{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">Save copy to SOP list</span> to add a new
              entry under Agent SOP.
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              <span className="font-medium text-gray-800 dark:text-gray-200">Nested workflows:</span>{' '}
              nodes without a sub-workflow can use <span className="font-medium text-violet-700 dark:text-violet-300">Create sub-workflow</span>{' '}
              (Task Manager). Those with one show <span className="font-medium text-violet-700 dark:text-violet-300">View sub-workflow</span> —
              open the inner graph; use breadcrumbs (top-left of the canvas) to go back up.
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              <span className="font-medium text-gray-800 dark:text-gray-200">Canvas:</span> click a node to
              select; drag from handles to connect.{' '}
              <span className="font-medium text-violet-700 dark:text-violet-300">Right-drag</span> on the
              background to box-select (hold <kbd className="rounded bg-gray-200 px-1 dark:bg-slate-600">Shift</kbd>{' '}
              to add). Right-click fields on a node for quick edit.
            </p>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-3">
          <div
            ref={flowMountHostRef}
            className={`relative min-h-[420px] rounded-xl border border-violet-200/50 bg-white/40 dark:border-blue-800/50 dark:bg-slate-900/40 xl:col-span-2 ${
              isTauri ? 'overflow-visible' : 'overflow-hidden'
            }`}
          >
            <SopDagUpdateContext.Provider value={updatePlaygroundNode}>
              <PlaygroundDrillProvider value={drillApi}>
                <nav
                  className={`pointer-events-auto absolute left-3 top-3 z-[55] flex max-w-[min(100%-1.5rem,28rem)] flex-wrap items-center gap-0.5 rounded-lg border border-violet-300/40 bg-white/95 px-2 py-1.5 text-xs shadow-md dark:border-violet-800/50 dark:bg-slate-900/95 ${
                    isTauri ? '' : 'backdrop-blur-sm'
                  }`}
                  aria-label="Workflow depth"
                >
                  {navigationTrail.map((seg, idx) => (
                    <span key={`${seg.id || 'root'}-${idx}`} className="inline-flex max-w-full items-center gap-0.5">
                      {idx > 0 ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-400 dark:text-violet-500" aria-hidden />
                      ) : null}
                      <button
                        type="button"
                        title={idx === navigationTrail.length - 1 ? 'Current level' : 'Go to this level'}
                        className={`truncate rounded-md px-2 py-1 text-left font-medium transition ${
                          idx === navigationTrail.length - 1
                            ? 'cursor-default text-gray-900 dark:text-gray-100'
                            : 'text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950/60'
                        }`}
                        onClick={() => navigateBreadcrumbTo(idx)}
                      >
                        {seg.label}
                      </button>
                    </span>
                  ))}
                </nav>
                {flowRenderReady ? (
                  <ReactFlow
                    id={PLAYGROUND_FLOW_ID}
                    key={`${sopIdFromUrl ?? 'sandbox'}-${navigationTrail.map((s) => s.id).join('/')}`}
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeDragStart={() => {
                      if (isTauri) setWebviewRepaintGuardOn(true);
                    }}
                    onNodeDragStop={() => {
                      if (isTauri) setWebviewRepaintGuardOn(false);
                    }}
                    onNodeMouseEnter={noopNodeMouseEnterForPointerEvents}
                    nodeTypes={nodeTypes}
                    nodesDraggable={canvasInteractive}
                    nodesConnectable={canvasInteractive}
                    nodesFocusable={false}
                    elementsSelectable={canvasInteractive}
                    selectNodesOnDrag={false}
                    deleteKeyCode={null}
                    // WebView2/Tauri: virtualization can cull nodes incorrectly if viewport math glitches.
                    onlyRenderVisibleElements={!isTauri}
                    elevateNodesOnSelect={!isTauri}
                    autoPanOnNodeDrag={!isTauri}
                    autoPanOnConnect={!isTauri}
                    nodeDragThreshold={isTauri ? 0 : undefined}
                    fitView
                    className="playground-flow absolute inset-0 bg-transparent"
                    style={
                      flowPixelSize
                        ? { width: `${flowPixelSize.width}px`, height: `${flowPixelSize.height}px` }
                        : undefined
                    }
                    proOptions={{ hideAttribution: true }}
                    onPaneContextMenu={(e) => e.preventDefault()}
                    defaultEdgeOptions={{
                      style: { stroke: '#7c3aed', strokeWidth: 2.25 },
                      animated: false,
                    }}
                    connectionLineStyle={{ stroke: '#a78bfa', strokeWidth: 2.5 }}
                    minZoom={0.2}
                    maxZoom={1.8}
                    onMove={(_, viewport) => {
                      const { x, y, zoom } = viewport;
                      const bad =
                        typeof x !== 'number' ||
                        typeof y !== 'number' ||
                        typeof zoom !== 'number' ||
                        Number.isNaN(x) ||
                        Number.isNaN(y) ||
                        Number.isNaN(zoom) ||
                        !Number.isFinite(x) ||
                        !Number.isFinite(y) ||
                        !Number.isFinite(zoom) ||
                        Math.abs(x) > 50_000 ||
                        Math.abs(y) > 50_000 ||
                        zoom <= 0 ||
                        zoom > 10;
                      if (bad) {
                        console.error('='.repeat(140));
                        console.error('MATH FAILURE: VIEWPORT TRANSFORM BROKE');
                        console.error('viewport:', viewport);
                        console.error('flowPixelSize:', flowPixelSize);
                        console.error('='.repeat(140));
                      }
                    }}
                  >
                    <PlaygroundFlowGraphSnapshot saveRef={flowGraphRef} />
                    <PlaygroundFitViewTrigger nonce={fitNonce} />
                    <Background gap={20} size={1} />
                    {isTauri ? null : <MiniMap zoomable pannable />}
                    <PlaygroundRightButtonMarquee
                      rootId={PLAYGROUND_FLOW_ID}
                      onCommit={onRightMarqueeCommit}
                      disabled={!canvasInteractive}
                    />
                    <PlaygroundGraphInFlowToolbar
                      dagNodes={dagNodes}
                      onAddAgentNode={addPlaygroundNode}
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
              </PlaygroundDrillProvider>
            </SopDagUpdateContext.Provider>
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap gap-2 rounded-xl border border-violet-200/50 bg-white/60 p-3 dark:border-blue-800/50 dark:bg-slate-800/60">
              <button
                type="button"
                onClick={resetSandbox}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 dark:hover:bg-slate-600"
              >
                <RotateCcw className="h-4 w-4" />
                Reset sandbox
              </button>
              <button
                type="button"
                onClick={copyToAgentSop}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
                title="Add this graph as a new SOP and open it in the editor"
              >
                <GitBranch className="h-4 w-4" />
                Save copy to SOP list
              </button>
              <button
                type="button"
                disabled={!sopIdFromUrl}
                onClick={savePlaygroundToLoadedSop}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400 bg-white px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent dark:border-violet-600 dark:bg-slate-800 dark:text-violet-100 dark:hover:bg-violet-950/40 dark:disabled:border-slate-600 dark:disabled:text-slate-500"
                title={
                  sopIdFromUrl
                    ? 'Overwrite the SOP opened from the URL with the full nested workflow from this sandbox'
                    : 'Open a saved SOP via Agent SOP to enable Save'
                }
              >
                <Save className="h-4 w-4" />
                Save
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-violet-200/50 bg-white/60 p-3 dark:border-blue-800/50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                <FileJson className="h-4 w-4" />
                RACI SOP normalizer (local qvac)
              </div>
              <textarea
                value={sopInput}
                onChange={(e) => setSopInput(e.target.value)}
                placeholder="Paste a messy SOP, or load a PDF (text layer). Preview JSON without touching Agent SOP."
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
                  <Sparkles className="h-4 w-4" />
                  Normalize with llama-cli
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
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">Playground log</span>
                <button
                  type="button"
                  onClick={() => setLogLines([])}
                  className="text-xs text-violet-600 dark:text-violet-400"
                >
                  Clear
                </button>
              </div>
              <pre className="flex-1 overflow-auto whitespace-pre-wrap font-mono text-xs text-gray-700 dark:text-gray-300">
                {logLines.length ? logLines.join('\n') : 'Sync, run, normalize, and copy actions log here.'}
              </pre>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function PlaygroundScreen(props: PlaygroundScreenProps) {
  return (
    <ReactFlowProvider>
      <PlaygroundInner {...props} />
    </ReactFlowProvider>
  );
}
