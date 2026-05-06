import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Task } from './types';
import { agentProfiles as initialAgents, AgentProfile } from './config/agentProfiles';
import type {
  ActionPendingPayload,
  AgentDagEdge,
  AgentDagNode,
  ClarificationPayload,
  HumanReviewPayload,
} from './types/agentDag';
import type {
  EmbeddedWorkflowBundleStore,
  EmbeddedWorkflowBundleVersion,
  WorkflowBundlePin,
  WorkflowBundlePinScopeKey,
} from './types/workflowBundle';
import { isProbableSha256Hex } from './domain/workflowBundleDigest';
import type { WorkflowPublicSnapshot } from '@/hermes/tauriWorkflowRun';
import type { ActiveDagRunSnapshot, DelegationHermesActivity } from '@/types/delegationHub';
import { buildActiveDagRunFromWorkflowSnapshot } from '@/types/delegationHub';
import type { TasksWorkspaceLayout } from '@/lib/delegationShellRules';

export interface AgentSopRecord {
  id: string;
  name: string;
  nodes: AgentDagNode[];
  edges: AgentDagEdge[];
  updatedAt: number;
  /** When set, Hermes routing can execute this persisted graph instead of synthesizing steps from `SOP_REGISTRY`. */
  registryTemplateId?: string | null;
}

export type ProjectStatus = 'planned' | 'in-progress' | 'finished';

export interface Project {
  id: string;
  name: string;
  department: 'Marketing' | 'HR' | 'Finance';
  description: string;
  startDate: string;
  endDate: string;
  status?: ProjectStatus;
}

const raciRowY: Record<AgentDagNode['raciLayer'], number> = {
  responsible: 0,
  accountable: 160,
  consulted: 320,
  informed: 480,
};

function buildDefaultAgentSopRecord(): AgentSopRecord {
  const dag = initialAgentDag();
  return {
    id: 'sop-default-seed',
    name: 'Sample RACI SOP',
    nodes: dag.nodes,
    edges: dag.edges,
    updatedAt: Date.now(),
  };
}

function initialAgentDag(): { nodes: AgentDagNode[]; edges: AgentDagEdge[] } {
  return {
    nodes: [
      {
        id: 'n1',
        label: 'Prepare inputs',
        prompt: 'Gather requirements and list open questions for the stakeholder.',
        executionTarget: 'localQvac',
        requiresSystemTool: false,
        systemToolName: null,
        systemToolArgsSummary: null,
        raciLayer: 'responsible',
        position: { x: 40, y: raciRowY.responsible },
      },
      {
        id: 'n2',
        label: 'Request approval',
        prompt: 'Request formal approval from the accountable owner before any system changes.',
        executionTarget: 'localQvac',
        requiresSystemTool: true,
        systemToolName: 'email.send',
        systemToolArgsSummary: '{"to":"owner@example.com","subject":"Approval needed"}',
        raciLayer: 'accountable',
        position: { x: 320, y: raciRowY.accountable },
      },
      {
        id: 'n3',
        label: 'Cloud analysis',
        prompt: 'Perform deeper reasoning on risks and mitigations (optional cloud step).',
        executionTarget: 'cloudAnthropic',
        requiresSystemTool: false,
        systemToolName: null,
        systemToolArgsSummary: null,
        raciLayer: 'consulted',
        position: { x: 600, y: raciRowY.consulted },
      },
      {
        id: 'n4',
        label: 'Inform stakeholders',
        prompt: 'Send a concise status update to informed parties.',
        executionTarget: 'localQvac',
        requiresSystemTool: false,
        systemToolName: null,
        systemToolArgsSummary: null,
        raciLayer: 'informed',
        position: { x: 880, y: raciRowY.informed },
      },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n4' },
    ],
  };
}

interface KanbanStore {
  tasks: Task[];
  agents: AgentProfile[];
  editingTask: Task | null;
  selectedTask: Task | null;
  isLoggedIn: boolean;
  projects: Project[];
  activeProject: Project | null;
  /** Hybrid AI agent DAG (SOP visualizer + orchestrator). Mirrors the SOP open in the editor when set. */
  agentDagNodes: AgentDagNode[];
  agentDagEdges: AgentDagEdge[];
  /** Saved SOP definitions (persisted). */
  agentSops: AgentSopRecord[];
  /** Versioned embedded workflow bundles (persisted): logical id → semver → immutable graph + digest. */
  embeddedWorkflowBundles: EmbeddedWorkflowBundleStore;
  /** Pin (semver + digest) per scope key: project id or `GLOBAL_WORKFLOW_BUNDLE_PIN_KEY`. */
  workflowBundlePins: Record<string, WorkflowBundlePin>;
  /** When set, DAG mutations also update this entry in `agentSops`. */
  editingAgentSopId: string | null;
  agentDagLog: string[];
  pendingActionApproval: ActionPendingPayload | null;
  pendingClarification: ClarificationPayload | null;
  pendingHumanReview: HumanReviewPayload | null;
  /** Volatile: last Hermes / hub chat orchestration (for Delegation Hub monitoring). */
  delegationHermesActivity: DelegationHermesActivity | null;
  /** Volatile: in-flight Tauri DAG run snapshot from workflow events. */
  activeDagRun: ActiveDagRunSnapshot | null;
  /** Volatile: Tasks screen board vs list layout (not persisted). */
  tasksWorkspaceLayout: TasksWorkspaceLayout;
  setTasksWorkspaceLayout: (layout: TasksWorkspaceLayout) => void;
  setDelegationHermesActivity: (v: DelegationHermesActivity | null) => void;
  syncActiveDagRunFromWorkflowSnapshot: (snap: WorkflowPublicSnapshot) => void;
  patchActiveDagRunNodeEvent: (ev: { nodeId: string; phase: string; detail?: string }) => void;
  clearActiveDagRun: () => void;
  updateAgentDagNode: (id: string, patch: Partial<AgentDagNode>) => void;
  addAgentDagNode: (node: AgentDagNode) => void;
  removeAgentDagNode: (id: string) => void;
  addAgentDagEdge: (edge: AgentDagEdge) => void;
  removeAgentDagEdge: (id: string) => void;
  setPendingActionApproval: (v: ActionPendingPayload | null) => void;
  setPendingClarification: (v: ClarificationPayload | null) => void;
  setPendingHumanReview: (v: HumanReviewPayload | null) => void;
  appendAgentDagLog: (line: string) => void;
  clearAgentDagLog: () => void;
  setAgentDagState: (nodes: AgentDagNode[], edges: AgentDagEdge[]) => void;
  loadAgentSopIntoEditor: (sopId: string) => void;
  clearEditingAgentSop: () => void;
  createAgentSop: (name: string) => AgentSopRecord;
  renameAgentSop: (sopId: string, name: string) => void;
  deleteAgentSop: (sopId: string) => void;
  importPlaygroundAsNewAgentSop: (nodes: AgentDagNode[], edges: AgentDagEdge[]) => string;
  /** Overwrite a saved SOP’s graph (e.g. from Playground); keeps nested `subGraph` data in JSON. */
  updatePersistedAgentSopGraph: (
    sopId: string,
    snapshot: { nodes: AgentDagNode[]; edges: AgentDagEdge[] },
  ) => boolean;
  upsertEmbeddedWorkflowBundleVersion: (version: EmbeddedWorkflowBundleVersion) => void;
  removeEmbeddedWorkflowBundleVersion: (bundleId: string, semver: string) => void;
  setWorkflowBundlePin: (scopeKey: WorkflowBundlePinScopeKey, pin: WorkflowBundlePin | null) => void;
  setLoggedIn: (status: boolean) => void;
  setEditingTask: (task: Task | null) => void;
  setSelectedTask: (task: Task | null) => void;
  setActiveProject: (project: Project | null) => void;
  updateTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  archiveTask: (taskId: string) => void;
  updateTasks: (tasks: Task[]) => void;
  removeAgent: (taskId: string, agentId: string) => void;
  moveTask: (taskId: string, newStatus: Task['status']) => void;
  createTask: (title: string, description: string, project: string, status?: Task['status']) => Task;
  createSubtask: (task: Task) => Task;
  findTaskById: (taskId: string) => Task | undefined;
  createProject: (name: string, department: Project['department'], description: string) => Project;
}

function syncActiveSopInList(
  state: KanbanStore,
  nodes: AgentDagNode[],
  edges: AgentDagEdge[],
): Pick<KanbanStore, 'agentSops'> | Record<string, never> {
  if (!state.editingAgentSopId) return {};
  return {
    agentSops: state.agentSops.map((rec) =>
      rec.id === state.editingAgentSopId ? { ...rec, nodes, edges, updatedAt: Date.now() } : rec,
    ),
  };
}

const initialTasks: Task[] = [
  {
    id: '1',
    title: 'Prepare financial report [demo]',
    description: 'Load data from the database and prepare a financial report about last quarter',
    project: 'Financial Planning',
    assignedAgents: ['dataAnalyst'],
    status: 'done',
    priority: 'low',
    dueDate: '2025-02-15',
    result: {
      type: 'spreadsheet',
      data: {
        sheets: [{
          name: 'Financial Report',
          headers: ["Category", "Value", "Owner"],
          rows: [
            ["Revenue", "$100,000", "Alice"],
            ["Expenses", "$70,000", "Bob"],
            ["Net Profit", "$30,000", "Alice"],
            ["Marketing Costs", "$10,000", "Charlie"],
            ["Operational Costs", "$15,000", "David"],
            ["Research & Development", "$5,000", "Eve"],
            ["Miscellaneous", "$2,000", "Frank"]
        ]
        }]
      }
    },
    completedDate: '2025-02-10 14:30'
  },
  { 
    id: '2', 
    title: 'Market Analysis [demo]', 
    description: 'Analyze market trends and competitor landscape',
    project: 'Q1 Marketing Campaign',
    priority: 'high',
    assignedAgents: ['researcher'],
    status: 'done',
    dueDate: '2025-02-12',
    result: {
      type: 'slides',
      data: {
        slides: [
          {
            title: 'Market Overview',
            image: '/public/workmates_logo.png',
            content: 'The current market size is estimated at $1 billion.\nGrowth rate is projected at 5% annually.\nKey drivers include technological advancements and consumer demand.'
          },
          {
            title: 'Competitor Analysis',
            content: 'Competitor A holds 30% market share.\nCompetitor B is focusing on innovation.\nCompetitor C offers lower pricing but lacks features.'
          },
          {
            title: 'Target Audience',
            content: 'Demographics: Ages 25-45, tech-savvy individuals.\nInterests: Sustainability, convenience, and quality.\nPain points: High prices and limited options.'
          },
          {
            title: 'SWOT Analysis',
            content: 'Strengths: Strong brand recognition.\nWeaknesses: Limited product range.\nOpportunities: Expanding into new markets.\nThreats: Increasing competition.'
          },
          {
            title: 'Marketing Strategies',
            content: 'Focus on digital marketing and social media engagement.\nUtilize influencers to reach target demographics.\nOffer promotions to attract new customers.'
          }
        ]
      }
    },
    completedDate: '2025-02-11 15:30'
  },
  {
    id: '3',
    title: 'Marketing Strategy [demo]',
    description: 'Analyze market trends and competitor landscape',
    project: 'Q1 Marketing Campaign',
    priority: 'high',
    assignedAgents: ['marketer'],
    status: 'done',
    dueDate: '2025-02-10',
    result: {
      type: 'text',
      data: {
        text: {
          title: 'Marketing Strategy',
          content: `
          1. Market Research:
            - Identify target demographics and industries most likely to benefit from your AI services.
            - Study competitors and analyze their strengths and weakness extrinsically.

          2. Value Proposition:
            - Define the unique benefits your AI services bring, like efficiency, predictive analysis, or automation.
            - Tailor messaging to highlight how your services solve specific problems or enhance business operations.

          3. Branding:
            - Develop a professional, modern brand identity that communicates intelligence and innovation.
            - Create a memorable agency name, logo, and tagline.

          4. Content Marketing:
            - Write blog posts and whitepapers on topics like AI in business, industry case studies, and success stories.
            - Use these resources to establish authority and provide value.

          5. Online Presence:
            - Optimize your website for SEO to improve visibility in search engines.
            - Create high-quality videos demonstrating your AI technology in action.
            - Use social media platforms to engage with your audience and build community.

          6. Email Marketing:
            - Develop an email list to keep in touch with potential clients and industry peers.
            - Craft regular newsletters featuring industry insights, company updates, and exclusive offers.

          7. Networking:
            - Attend industry events, webinars, and workshops to network with potential clients and influencers.
            - Participate in forums and online discussions related to AI.

          8. Paid Advertising:
            - Use targeted PPC campaigns on Google AdWords and social media to drive traffic to your website.
            - Consider industry-specific ads in trade magazines or on platforms like LinkedIn.

          9. Partnerships:
            - Seek strategic alliances with companies that complement your services.
            - Collaborate on projects to showcase your capabilities.

          10. Analytics and Adjustments:
            - Implement tools like Google Analytics to track user interactions and campaign effectiveness.
            - Continuously analyze performance data, adjust strategies as necessary, and scale successful tactics.

          11. Sales Process:
            - Develop an efficient sales process tailored to the B2B nature of your services.
            - Invest in sales training and coaching for your team to effectively communicate value propositions.

          12. Customer Relationship Management (CRM):
            - Use a CRM system to manage leads, track customer interactions, and enhance client relationships.
          `
        }
      }
    },
    completedDate: '2025-02-09 8:30'
  }
];

const initialProjects: Project[] = [
  { 
    id: '1', 
    name: 'Q1 Marketing Campaign', 
    department: 'Marketing',
    description: 'Comprehensive marketing campaign for Q1 2025 focusing on product launch and brand awareness.',
    startDate: '2025-01-01',
    endDate: '2025-03-31'
  },
  { 
    id: '2', 
    name: 'HR Recruitment Drive', 
    department: 'HR',
    description: 'Major recruitment initiative to expand our engineering and design teams.',
    startDate: '2025-02-01',
    endDate: '2025-04-30'
  },
  { 
    id: '3', 
    name: 'Financial Planning', 
    department: 'Finance',
    description: 'Annual financial planning and budget allocation for all departments.',
    startDate: '2025-01-15',
    endDate: '2025-02-28'
  }
];

const defaultAgentSopRecord = buildDefaultAgentSopRecord();

const KANBAN_STORAGE_KEY = 'workmates-kanban-v1';

const defaultAgents = () => Object.keys(initialAgents).map((k) => initialAgents[k]);

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set, get) => ({
  tasks: initialTasks,
  agents: defaultAgents(),
  editingTask: null,
  selectedTask: null,
  isLoggedIn: false,
  projects: initialProjects,
  activeProject: initialProjects[0],
  agentSops: [defaultAgentSopRecord],
  embeddedWorkflowBundles: {},
  workflowBundlePins: {},
  editingAgentSopId: null,
  agentDagNodes: defaultAgentSopRecord.nodes,
  agentDagEdges: defaultAgentSopRecord.edges,
  agentDagLog: [],
  pendingActionApproval: null,
  pendingClarification: null,
  pendingHumanReview: null,
  delegationHermesActivity: null,
  activeDagRun: null,
  tasksWorkspaceLayout: 'board',
  setTasksWorkspaceLayout: (layout) => set({ tasksWorkspaceLayout: layout }),
  setDelegationHermesActivity: (v) => set({ delegationHermesActivity: v }),
  syncActiveDagRunFromWorkflowSnapshot: (snap) =>
    set((s) => {
      if (!snap.runId?.trim()) return s;
      return {
        activeDagRun: buildActiveDagRunFromWorkflowSnapshot(snap, s.activeDagRun),
      };
    }),
  patchActiveDagRunNodeEvent: (ev) =>
    set((s) => {
      if (!s.activeDagRun) return s;
      return {
        activeDagRun: {
          ...s.activeDagRun,
          lastNodeId: ev.nodeId,
          lastNodePhase: ev.phase,
          lastNodeDetail: ev.detail,
          updatedAt: Date.now(),
        },
      };
    }),
  clearActiveDagRun: () => set({ activeDagRun: null }),
  updateAgentDagNode: (id, patch) =>
    set((state) => {
      const agentDagNodes = state.agentDagNodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
      return {
        agentDagNodes,
        ...syncActiveSopInList(state, agentDagNodes, state.agentDagEdges),
      };
    }),
  addAgentDagNode: (node) =>
    set((state) => {
      const agentDagNodes = [...state.agentDagNodes, node];
      return {
        agentDagNodes,
        ...syncActiveSopInList(state, agentDagNodes, state.agentDagEdges),
      };
    }),
  removeAgentDagNode: (id) =>
    set((state) => {
      const agentDagNodes = state.agentDagNodes.filter((n) => n.id !== id);
      const agentDagEdges = state.agentDagEdges.filter((e) => e.source !== id && e.target !== id);
      return {
        agentDagNodes,
        agentDagEdges,
        ...syncActiveSopInList(state, agentDagNodes, agentDagEdges),
      };
    }),
  addAgentDagEdge: (edge) =>
    set((state) => {
      if (state.agentDagEdges.some((e) => e.id === edge.id)) return state;
      const agentDagEdges = [...state.agentDagEdges, edge];
      return {
        agentDagEdges,
        ...syncActiveSopInList(state, state.agentDagNodes, agentDagEdges),
      };
    }),
  removeAgentDagEdge: (edgeId) =>
    set((state) => {
      const agentDagEdges = state.agentDagEdges.filter((e) => e.id !== edgeId);
      return {
        agentDagEdges,
        ...syncActiveSopInList(state, state.agentDagNodes, agentDagEdges),
      };
    }),
  setPendingActionApproval: (v) => set({ pendingActionApproval: v }),
  setPendingClarification: (v) => set({ pendingClarification: v }),
  setPendingHumanReview: (v) => set({ pendingHumanReview: v }),
  appendAgentDagLog: (line) =>
    set((state) => ({ agentDagLog: [...state.agentDagLog, `[${new Date().toLocaleTimeString()}] ${line}`] })),
  clearAgentDagLog: () => set({ agentDagLog: [] }),
  setAgentDagState: (nodes, edges) =>
    set((state) => ({
      agentDagNodes: nodes,
      agentDagEdges: edges,
      ...syncActiveSopInList(state, nodes, edges),
    })),
  loadAgentSopIntoEditor: (sopId) =>
    set((state) => {
      const sop = state.agentSops.find((s) => s.id === sopId);
      if (!sop) return state;
      return {
        editingAgentSopId: sopId,
        agentDagNodes: sop.nodes,
        agentDagEdges: sop.edges,
      };
    }),
  clearEditingAgentSop: () => set({ editingAgentSopId: null }),
  createAgentSop: (name) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sop-${Date.now()}`;
    const record: AgentSopRecord = {
      id,
      name: name.trim() || 'Untitled SOP',
      nodes: [],
      edges: [],
      updatedAt: Date.now(),
    };
    set((s) => ({ agentSops: [...s.agentSops, record] }));
    return record;
  },
  renameAgentSop: (sopId, name) =>
    set((state) => ({
      agentSops: state.agentSops.map((s) =>
        s.id === sopId ? { ...s, name: name.trim() || 'Untitled SOP', updatedAt: Date.now() } : s,
      ),
    })),
  deleteAgentSop: (sopId) =>
    set((state) => {
      const agentSops = state.agentSops.filter((s) => s.id !== sopId);
      if (state.editingAgentSopId === sopId) {
        const fallback = agentSops[0];
        return {
          agentSops,
          editingAgentSopId: null,
          agentDagNodes: fallback?.nodes ?? [],
          agentDagEdges: fallback?.edges ?? [],
        };
      }
      return { agentSops };
    }),
  updatePersistedAgentSopGraph: (sopId, snapshot) => {
    let ok = false;
    set((state) => {
      if (!state.agentSops.some((s) => s.id === sopId)) return state;
      ok = true;
      const nodesCopy = JSON.parse(JSON.stringify(snapshot.nodes)) as AgentDagNode[];
      const edgesCopy = snapshot.edges.map((e) => ({ ...e }));
      const agentSops = state.agentSops.map((rec) =>
        rec.id !== sopId
          ? rec
          : { ...rec, nodes: nodesCopy, edges: edgesCopy, updatedAt: Date.now() },
      );
      if (state.editingAgentSopId === sopId) {
        return { agentSops, agentDagNodes: nodesCopy, agentDagEdges: edgesCopy };
      }
      return { agentSops };
    });
    return ok;
  },
  upsertEmbeddedWorkflowBundleVersion: (version) => {
    if (!isProbableSha256Hex(version.contentDigest)) {
      throw new Error(
        'workflow bundle version requires contentDigest: 64-char lowercase SHA-256 hex of the canonical graph',
      );
    }
    if (version.bundleId.trim() === '' || version.semver.trim() === '') {
      throw new Error('workflow bundle version requires non-empty bundleId and semver');
    }
    const installedAt = version.installedAt ?? Date.now();
    const next: EmbeddedWorkflowBundleVersion = { ...version, installedAt };
    set((state) => {
      const prevCatalog = state.embeddedWorkflowBundles[version.bundleId];
      const versions = {
        ...(prevCatalog?.versions ?? {}),
        [version.semver]: next,
      };
      return {
        embeddedWorkflowBundles: {
          ...state.embeddedWorkflowBundles,
          [version.bundleId]: { versions },
        },
      };
    });
  },
  removeEmbeddedWorkflowBundleVersion: (bundleId, semver) =>
    set((state) => {
      const catalog = state.embeddedWorkflowBundles[bundleId];
      if (!catalog?.versions[semver]) return state;
      const rest = { ...catalog.versions };
      delete rest[semver];
      const nextStore = { ...state.embeddedWorkflowBundles };
      if (Object.keys(rest).length === 0) {
        delete nextStore[bundleId];
      } else {
        nextStore[bundleId] = { versions: rest };
      }
      return { embeddedWorkflowBundles: nextStore };
    }),
  setWorkflowBundlePin: (scopeKey, pin) =>
    set((state) => {
      if (!pin) {
        const next = { ...state.workflowBundlePins };
        delete next[scopeKey];
        return { workflowBundlePins: next };
      }
      if (!isProbableSha256Hex(pin.contentDigest)) {
        throw new Error('workflow bundle pin requires contentDigest: 64-char lowercase SHA-256 hex');
      }
      return {
        workflowBundlePins: { ...state.workflowBundlePins, [scopeKey]: pin },
      };
    }),
  importPlaygroundAsNewAgentSop: (nodes, edges) => {
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sop-${Date.now()}`;
    const nodesCopy = JSON.parse(JSON.stringify(nodes)) as AgentDagNode[];
    const edgesCopy = JSON.parse(JSON.stringify(edges)) as AgentDagEdge[];
    const record: AgentSopRecord = {
      id,
      name: 'From Playground',
      nodes: nodesCopy,
      edges: edgesCopy,
      updatedAt: Date.now(),
    };
    set((s) => ({
      agentSops: [...s.agentSops, record],
      editingAgentSopId: id,
      agentDagNodes: nodesCopy,
      agentDagEdges: edgesCopy,
    }));
    return id;
  },
  setLoggedIn: (status) => set({ isLoggedIn: status }),
  setActiveProject: (project: Project | null) => set({ activeProject: project }),
  setEditingTask: (task) => set({ editingTask: task }),
  setSelectedTask: (task) => set({ selectedTask: task }),
  updateTask: (updatedTask) =>
    set((state) => {
      const existingTask = state.tasks.find(t => t.id === updatedTask.id);
      if (!existingTask) {
        // This is a new task, add it to the list
        return { tasks: [...state.tasks, updatedTask] };
      }
      // This is an existing task, update it
      return {
        tasks: state.tasks.map((task) =>
          task.id === updatedTask.id ? updatedTask : task
        )
      };
    }),
  deleteTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      editingTask: state.editingTask?.id === taskId ? null : state.editingTask,
      selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask,
    })),
  archiveTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, archived: true } : t)),
      editingTask: state.editingTask?.id === taskId ? null : state.editingTask,
      selectedTask: state.selectedTask?.id === taskId ? null : state.selectedTask,
    })),
  updateTasks: (tasks) => set({ tasks }),
  removeAgent: (taskId, agentId) => set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? { ...t, assignedAgents: t.assignedAgents.filter((id) => id !== agentId) }
        : t
    )
  })),
  moveTask: (taskId, newStatus) => set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, status: newStatus } : t
    )
  })),
  createTask: (title, description, project, status = 'draft') => {
    
    let taskExists = false;
    const tasks = get().tasks;

    for (let t = 0; t < tasks.length; t++) {
      if (tasks[t].title === title && tasks[t].description === description) {
        taskExists = true;
        break;
      }
    }

    const resolvedProject = (() => {
      const p = typeof project === 'string' ? project.trim() : '';
      if (p) return p;
      const ap = get().activeProject?.name;
      if (ap) return ap;
      return get().projects[0]?.name ?? '';
    })();

    const resolvedStatus: Task['status'] = (() => {
      const s = String(status ?? '').trim().toLowerCase();
      if (s === 'draft') return 'draft';
      if (s === 'todo' || s === 'to do' || s === 'to-do') return 'todo';
      if (s === 'inprogress' || s === 'in_progress' || s === 'in progress') return 'inProgress';
      if (s === 'done' || s === 'completed' || s === 'complete') return 'done';
      return 'draft';
    })();

    const newTask: Task = {
      id: crypto.randomUUID(),
      title,
      description,
      project: resolvedProject,
      status: resolvedStatus,
      priority: 'medium',
      dueDate: new Date().toISOString().split('T')[0],
      assignedAgents: [],
      result: undefined,
      completedDate: undefined
    };

    if (!taskExists) {
      set((state) => ({
        tasks: [...state.tasks, newTask]
      }));
    }
    return newTask;
    
  },
  createSubtask: (task: Task) => {
    set((state) => ({
      tasks: [...state.tasks, task]
    }));
    return task;
  },
  findTaskById: (taskId: string) => get().tasks.find(t => t.id === taskId),
  createProject: (name, department, description) => {
    const today = new Date().toISOString().split('T')[0];
    const threeMonthsLater = new Date();
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
    const endDate = threeMonthsLater.toISOString().split('T')[0];
    
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      department,
      description,
      startDate: today,
      endDate: endDate,
      status: 'planned'
    };
    
    set((state) => ({
      projects: [...state.projects, newProject],
      activeProject: newProject
    }));
    
    return newProject;
  }
}),
    {
      name: KANBAN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tasks: state.tasks,
        projects: state.projects,
        activeProject: state.activeProject,
        agents: state.agents,
        agentSops: state.agentSops,
        agentDagNodes: state.agentDagNodes,
        agentDagEdges: state.agentDagEdges,
        embeddedWorkflowBundles: state.embeddedWorkflowBundles,
        workflowBundlePins: state.workflowBundlePins,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<KanbanStore>;
        const projects = p.projects !== undefined ? p.projects : current.projects;
        let activeProject =
          p.activeProject !== undefined ? p.activeProject : current.activeProject;
        if (activeProject && !projects.some((pr) => pr.id === activeProject!.id)) {
          activeProject = projects[0] ?? null;
        }

        const dagNodes =
          p.agentDagNodes !== undefined ? p.agentDagNodes : current.agentDagNodes;
        const dagEdges =
          p.agentDagEdges !== undefined ? p.agentDagEdges : current.agentDagEdges;

        let agentSops: AgentSopRecord[];
        if (p.agentSops !== undefined && Array.isArray(p.agentSops) && p.agentSops.length > 0) {
          agentSops = p.agentSops;
        } else if (dagNodes.length > 0) {
          agentSops = [
            {
              id: `sop-migrated-${Date.now()}`,
              name: 'Default SOP',
              nodes: dagNodes,
              edges: dagEdges,
              updatedAt: Date.now(),
            },
          ];
        } else {
          agentSops = current.agentSops;
        }

        return {
          ...current,
          ...p,
          projects,
          activeProject,
          tasks: p.tasks !== undefined ? p.tasks : current.tasks,
          agents: p.agents !== undefined ? p.agents : current.agents,
          agentSops,
          agentDagNodes: dagNodes,
          agentDagEdges: dagEdges,
          embeddedWorkflowBundles:
            p.embeddedWorkflowBundles !== undefined
              ? p.embeddedWorkflowBundles
              : current.embeddedWorkflowBundles,
          workflowBundlePins:
            p.workflowBundlePins !== undefined ? p.workflowBundlePins : current.workflowBundlePins,
          editingAgentSopId: null,
        };
      },
    },
  ),
);