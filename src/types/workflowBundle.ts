import type { AgentDagEdge, AgentDagNode } from './agentDag';

/** npm-style semver string for human-readable UI. */
export type WorkflowBundleSemver = string;

/**
 * SHA-256 digest of the canonical workflow graph JSON (UTF-8), lowercase hex, 64 characters.
 * Ground-truth for reproducibility; must match the graph stored alongside the entry.
 */
export type WorkflowContentDigest = string;

/** Payload hashed for `contentDigest`: canonical encoding of nodes + edges only. */
export interface WorkflowBundleGraphPayload {
  nodes: AgentDagNode[];
  edges: AgentDagEdge[];
}

/**
 * One immutable installed revision of a logical bundle (`bundleId`), keyed by semver in the catalog.
 */
export interface EmbeddedWorkflowBundleVersion {
  bundleId: string;
  semver: WorkflowBundleSemver;
  contentDigest: WorkflowContentDigest;
  installedAt: number;
  graph: WorkflowBundleGraphPayload;
}

/** All semvers installed for a given logical bundle id (e.g. `embedded-default`). */
export interface EmbeddedWorkflowBundleCatalog {
  versions: Record<WorkflowBundleSemver, EmbeddedWorkflowBundleVersion>;
}

/** Persisted registry: bundle id → catalog of installed versions. */
export type EmbeddedWorkflowBundleStore = Record<string, EmbeddedWorkflowBundleCatalog>;

/**
 * Pin references exactly one catalog entry by semver and ties it to the hashed payload for audit replay.
 */
export interface WorkflowBundlePin {
  bundleId: string;
  semver: WorkflowBundleSemver;
  contentDigest: WorkflowContentDigest;
}

/**
 * Keys in `workflowBundlePins`: project id from `Project.id`, or this constant for a workspace-agnostic default.
 */
export const GLOBAL_WORKFLOW_BUNDLE_PIN_KEY = '_global';

export type WorkflowBundlePinScopeKey = string;
