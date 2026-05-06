import type { AgentDagEdge, AgentDagNode } from '@/types/agentDag';
import type {
  EmbeddedWorkflowBundleStore,
  WorkflowBundleGraphPayload,
  WorkflowBundlePin,
} from '@/types/workflowBundle';
import { GLOBAL_WORKFLOW_BUNDLE_PIN_KEY } from '@/types/workflowBundle';
import { computeWorkflowContentDigest } from '@/domain/workflowBundleDigest';
import type { PersistedWorkflowSop } from '@/hermes/workflowDag';
import { resolveWorkflowGraphForSopId } from '@/hermes/workflowDag';

export type WorkflowGraphResolutionSource = 'pinned_bundle' | 'persisted_sop' | 'registry_linear';

export interface ResolvedWorkflowExecution {
  graph: { nodes: AgentDagNode[]; edges: AgentDagEdge[] };
  /** Audit trail / Rust publish: semver label + SHA-256 of the exact graph executed. */
  bundleId: string;
  bundleVersion: string;
  contentDigest: string;
  resolution: WorkflowGraphResolutionSource;
}

export function pickWorkflowBundlePin(
  pins: Record<string, WorkflowBundlePin>,
  projectId: string | null | undefined,
): WorkflowBundlePin | null {
  if (projectId && pins[projectId]) {
    return pins[projectId];
  }
  return pins[GLOBAL_WORKFLOW_BUNDLE_PIN_KEY] ?? null;
}

/**
 * Returns the pinned catalog row when the pin targets `bundleId` and the stored digest matches the pin.
 */
export function tryPinnedBundleVersion(
  bundleId: string,
  pin: WorkflowBundlePin | null,
  embedded: EmbeddedWorkflowBundleStore,
) {
  if (!pin || pin.bundleId !== bundleId) return null;
  const row = embedded[bundleId]?.versions[pin.semver];
  if (!row || row.contentDigest !== pin.contentDigest) return null;
  return row;
}

function isPersistedSopBinding(
  sopId: string,
  getAgentSops: () => PersistedWorkflowSop[],
): boolean {
  return getAgentSops().some((r) => r.registryTemplateId === sopId);
}

/**
 * Resolve the DAG for a registry SOP run: prefer embedded bundle row matching the active/global pin;
 * else fall back to persisted `AgentSopRecord` or linear `SOP_REGISTRY` materialization.
 * Always returns semver + digest for downstream audit (digest matches the returned graph bytes).
 */
export async function resolveWorkflowGraphForSopExecution(opts: {
  sopId: string;
  platformBundleId: string | null | undefined;
  platformBundleVersion: string | null | undefined;
  projectId: string | null | undefined;
  getAgentSops: () => PersistedWorkflowSop[];
  embeddedWorkflowBundles: EmbeddedWorkflowBundleStore;
  workflowBundlePins: Record<string, WorkflowBundlePin>;
}): Promise<ResolvedWorkflowExecution> {
  const bundleId = (opts.platformBundleId ?? '').trim() || 'embedded-default';
  const pin = pickWorkflowBundlePin(opts.workflowBundlePins, opts.projectId);
  const pinned = tryPinnedBundleVersion(bundleId, pin, opts.embeddedWorkflowBundles);
  if (pinned) {
    return {
      graph: { nodes: pinned.graph.nodes, edges: pinned.graph.edges },
      bundleId: pinned.bundleId,
      bundleVersion: pinned.semver,
      contentDigest: pinned.contentDigest,
      resolution: 'pinned_bundle',
    };
  }

  const fallback = resolveWorkflowGraphForSopId(opts.sopId, opts.getAgentSops);
  if (!fallback) {
    throw new Error(`Cannot resolve workflow graph for SOP ${opts.sopId}`);
  }
  const payload: WorkflowBundleGraphPayload = {
    nodes: fallback.nodes,
    edges: fallback.edges,
  };
  const contentDigest = await computeWorkflowContentDigest(payload);
  const resolution: WorkflowGraphResolutionSource = isPersistedSopBinding(opts.sopId, opts.getAgentSops)
    ? 'persisted_sop'
    : 'registry_linear';
  const bundleVersion = (opts.platformBundleVersion ?? '').trim() || '0.0.0-unpinned';

  return {
    graph: fallback,
    bundleId,
    bundleVersion,
    contentDigest,
    resolution,
  };
}

/**
 * For publishing the current editor/playground graph: attach digest; use pinned semver when the graph
 * matches the pinned catalog row, otherwise mark as unpinned.
 */
export async function resolveBundleAuditForAdHocGraph(opts: {
  logicalBundleId?: string;
  projectId: string | null | undefined;
  graph: WorkflowBundleGraphPayload;
  embeddedWorkflowBundles: EmbeddedWorkflowBundleStore;
  workflowBundlePins: Record<string, WorkflowBundlePin>;
}): Promise<Pick<ResolvedWorkflowExecution, 'bundleId' | 'bundleVersion' | 'contentDigest'>> {
  const bundleId = (opts.logicalBundleId ?? '').trim() || 'embedded-default';
  const digest = await computeWorkflowContentDigest(opts.graph);
  const pin = pickWorkflowBundlePin(opts.workflowBundlePins, opts.projectId);
  const row = tryPinnedBundleVersion(bundleId, pin, opts.embeddedWorkflowBundles);
  if (row && row.contentDigest === digest) {
    return { bundleId, bundleVersion: row.semver, contentDigest: digest };
  }
  return { bundleId, bundleVersion: '0.0.0-unpinned', contentDigest: digest };
}
