/** Mirrors Rust `dag_types` (serde camelCase). */

export type ExecutionTarget = 'localQvac' | 'cloudAnthropic';

export type DagNodeKind = 'agent' | 'human';

export type RaciLayer = 'responsible' | 'accountable' | 'consulted' | 'informed';

export interface AgentDagNode {
  id: string;
  label: string;
  prompt: string;
  executionTarget: ExecutionTarget;
  /** Agent nodes invoke Hermes/local worker; human nodes pause for structured review (`workflow_human_needed`). */
  nodeKind?: DagNodeKind;
  requiresSystemTool: boolean;
  systemToolName: string | null;
  systemToolArgsSummary: string | null;
  raciLayer: RaciLayer;
  position: { x: number; y: number };
}

export interface AgentDagEdge {
  id: string;
  source: string;
  target: string;
}

export interface ActionPendingPayload {
  id: string;
  toolName: string;
  argsSummary: string;
  nodeId: string | null;
}

export interface ClarificationPayload {
  id: string;
  question: string;
  options: string[];
  nodeId: string | null;
}

export interface HumanReviewPayload {
  id: string;
  runId: string;
  nodeId: string;
  instructions: string;
  stateSnapshot: Record<string, unknown>;
}

export interface SopRaci {
  r: string;
  a: string;
  c: string[];
  i: string[];
}

export interface SopStep {
  n: number;
  imperative: string;
  raci: SopRaci;
  actionKind: string;
}

export interface NormalizedSop {
  steps: SopStep[];
}
