import type { AgentDagEdge } from '@/types/agentDag';
import type { PlaygroundDagNode, PlaygroundNestedForest } from '@/types/playgroundWorkflow';

const y = { r: 0, a: 140, c: 280, i: 420 } as const;

/**
 * Level 1: Node A → Node B → Node C (high-level Human–AI process).
 * Level 2: Node B opens to 3 micro-tasks (draft, review, handoff).
 */
export function createPlaygroundNestedMockForest(): PlaygroundNestedForest {
  const nodeA: PlaygroundDagNode = {
    id: 'hl-a',
    label: 'Node A — Intake & scope',
    prompt: 'Human sets goals; AI captures requirements and constraints.',
    executionTarget: 'localQvac',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'responsible',
    position: { x: 40, y: y.r },
  };

  const subB1: PlaygroundDagNode = {
    id: 'b-micro-1',
    label: 'Draft proposal sections',
    prompt: 'AI drafts outline; human may adjust tone.',
    executionTarget: 'localQvac',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'responsible',
    position: { x: 40, y: y.r },
  };
  const subB2: PlaygroundDagNode = {
    id: 'b-micro-2',
    label: 'Human review checkpoint',
    prompt: 'Pause for structured review before wider share.',
    executionTarget: 'localQvac',
    nodeKind: 'human',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'accountable',
    position: { x: 300, y: y.a },
  };
  const subB3: PlaygroundDagNode = {
    id: 'b-micro-3',
    label: 'Package & circulate',
    prompt: 'AI formats final doc; notifies stakeholders.',
    executionTarget: 'cloudAnthropic',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'consulted',
    position: { x: 560, y: y.c },
  };

  const edgesB: AgentDagEdge[] = [
    { id: 'b-e1', source: 'b-micro-1', target: 'b-micro-2' },
    { id: 'b-e2', source: 'b-micro-2', target: 'b-micro-3' },
  ];

  const nodeB: PlaygroundDagNode = {
    id: 'hl-b',
    label: 'Node B — Draft proposal',
    prompt: 'Expand to refine the proposal via micro-tasks (sub-workflow).',
    executionTarget: 'localQvac',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'accountable',
    position: { x: 360, y: y.a },
    subGraph: {
      nodes: [subB1, subB2, subB3],
      edges: edgesB,
    },
  };

  const nodeC: PlaygroundDagNode = {
    id: 'hl-c',
    label: 'Node C — Ship & retrospect',
    prompt: 'Publish outcome; capture learnings for the next iteration.',
    executionTarget: 'localQvac',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'informed',
    position: { x: 680, y: y.i },
  };

  const edges: AgentDagEdge[] = [
    { id: 'hl-e1', source: 'hl-a', target: 'hl-b' },
    { id: 'hl-e2', source: 'hl-b', target: 'hl-c' },
  ];

  return { nodes: [nodeA, nodeB, nodeC], edges };
}
