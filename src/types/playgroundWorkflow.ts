import type { AgentDagEdge, AgentDagNode } from '@/types/agentDag';

/** Playground-only nesting; omitted when syncing to Rust / Agent SOP. */
export interface PlaygroundSubGraph {
  nodes: PlaygroundDagNode[];
  edges: AgentDagEdge[];
}

/** Agent DAG node with optional embedded sub-workflow (Human–AI nested DAG). */
export interface PlaygroundDagNode extends AgentDagNode {
  subGraph?: PlaygroundSubGraph;
}

export interface PlaygroundNestedForest {
  nodes: PlaygroundDagNode[];
  edges: AgentDagEdge[];
}

export type PlaygroundBreadcrumbSeg = {
  /** Empty string for synthetic root segment. */
  id: string;
  label: string;
};
