import type { HermesUiSnapshot } from '@/types/hermesOrchestration';
import type { WorkflowPublicSnapshot } from '@/hermes/tauriWorkflowRun';

/** Mirrors Hermes orchestration UI state for the Delegation Hub monitoring column (volatile; not persisted). */
export type DelegationHermesActivity = Pick<
  HermesUiSnapshot,
  'phase' | 'headline' | 'sopSteps' | 'platformRoute'
> & {
  busy: boolean;
};

/** Tauri DAG run surfaced from `workflow_state_updated` / `dag_node_event` (volatile). */
export type ActiveDagRunSnapshot = {
  runId: string;
  userRequestPreview: string;
  sopId?: string | null;
  taskId?: string | null;
  bundleId?: string | null;
  bundleVersion?: string | null;
  contentDigestPrefix?: string | null;
  completedNodes: number;
  updatedAt: number;
  lastNodeId?: string;
  lastNodePhase?: string;
  lastNodeDetail?: string;
};

/** Bridge listen payloads can be partial before the run is fully initialized. */
export function buildActiveDagRunFromWorkflowSnapshot(
  p: WorkflowPublicSnapshot,
  previous: ActiveDagRunSnapshot | null | undefined,
): ActiveDagRunSnapshot {
  const cnt = Object.keys(p.nodeOutputs ?? {}).length;
  const sameRun = previous && previous.runId === p.runId;
  const digest = p.contentDigest?.trim();
  return {
    runId: p.runId,
    userRequestPreview: clipText(p.userRequest ?? '', 96),
    sopId: p.sopId ?? null,
    taskId: p.taskId ?? null,
    bundleId: p.bundleId ?? null,
    bundleVersion: p.bundleVersion ?? null,
    contentDigestPrefix: digest && digest.length > 0 ? digest.slice(0, 12) : null,
    completedNodes: cnt,
    updatedAt: Date.now(),
    lastNodeId: sameRun ? previous!.lastNodeId : undefined,
    lastNodePhase: sameRun ? previous!.lastNodePhase : undefined,
    lastNodeDetail: sameRun ? previous!.lastNodeDetail : undefined,
  };
}

function clipText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
