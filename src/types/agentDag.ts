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

/**
 * §8.2–8.3 optional fields from Tauri (camelCase) or inferred in `AgentHitlBridge` when absent.
 * `timeSensitivityRule` records which product rule fired for analytics/tuning.
 */
export interface HitlSensitivityMeta {
  /** When true, HITL modal uses elevated prominence; item remains in monitoring column too (not a second queue). */
  timeSensitive?: boolean;
  timeSensitivityRule?: string;
  destructive?: boolean;
  category?: string;
  slaSecondsRemaining?: number;
  riskScore?: number;
}

export interface ActionPendingPayload extends HitlSensitivityMeta {
  id: string;
  toolName: string;
  argsSummary: string;
  nodeId: string | null;
}

export interface ClarificationPayload extends HitlSensitivityMeta {
  id: string;
  question: string;
  options: string[];
  nodeId: string | null;
}

export interface HumanReviewPayload extends HitlSensitivityMeta {
  id: string;
  runId: string;
  nodeId: string;
  instructions: string;
  stateSnapshot: Record<string, unknown>;
}

/** §8.2 HITL modal presentation: time-sensitive items stack above the §7 drawer (`z-[110]`) with ring + stronger backdrop. */
export type HitlModalVariant = 'standard' | 'timeSensitive';

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
