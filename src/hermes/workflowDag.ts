import type { AgentDagEdge, AgentDagNode } from '@/types/agentDag';
import { SOP_REGISTRY } from '@/hermes/registries';

export type PersistedWorkflowSop = {
  nodes: AgentDagNode[];
  edges: AgentDagEdge[];
  registryTemplateId?: string | null;
};

/**
 * When no persisted SOP is bound to a registry template id, materialize a linear DAG from `SOP_REGISTRY`.
 */
export function buildLinearWorkflowFromRegistry(sopId: string): { nodes: AgentDagNode[]; edges: AgentDagEdge[] } | null {
  const def = SOP_REGISTRY[sopId];
  if (!def) return null;
  const nodes: AgentDagNode[] = def.steps.map((s, idx) => ({
    id: s.id,
    label: s.label,
    prompt: `Execute only this workflow step. Output concise findings.\n\nStep: ${s.label}`,
    executionTarget: 'cloudAnthropic',
    nodeKind: 'agent',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: 'responsible',
    position: { x: 40 + idx * 300, y: 0 },
  }));

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

/** Prefer persisted SOP linked via `registryTemplateId`; fallback to synthetic linear graph. */
export function resolveWorkflowGraphForSopId(
  sopId: string,
  getAgentSops?: () => PersistedWorkflowSop[],
): { nodes: AgentDagNode[]; edges: AgentDagEdge[] } | null {
  const records = getAgentSops?.() ?? [];
  const linked = records.find((r) => r.registryTemplateId === sopId);
  if (linked) {
    return { nodes: linked.nodes, edges: linked.edges };
  }
  return buildLinearWorkflowFromRegistry(sopId);
}
