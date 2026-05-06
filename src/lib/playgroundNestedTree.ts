import type { AgentDagEdge, AgentDagNode } from '@/types/agentDag';
import type { PlaygroundDagNode, PlaygroundNestedForest, PlaygroundSubGraph } from '@/types/playgroundWorkflow';

export function resolveNestedView(forest: PlaygroundNestedForest, drillPath: string[]): PlaygroundNestedForest {
  if (drillPath.length === 0) {
    return { nodes: forest.nodes, edges: forest.edges };
  }
  let currentNodes = forest.nodes;
  for (let depth = 0; depth < drillPath.length; depth += 1) {
    const nodeId = drillPath[depth];
    const node = currentNodes.find((n) => n.id === nodeId);
    if (!node?.subGraph) {
      return { nodes: [], edges: [] };
    }
    if (depth === drillPath.length - 1) {
      return {
        nodes: node.subGraph.nodes.map((n) => ({ ...n, position: { ...n.position } })),
        edges: node.subGraph.edges.map((e) => ({ ...e })),
      };
    }
    currentNodes = node.subGraph.nodes;
  }
  return { nodes: [], edges: [] };
}

function patchSubGraph(
  sub: PlaygroundSubGraph,
  restPath: string[],
  nodeId: string,
  patch: Partial<PlaygroundDagNode>,
): PlaygroundSubGraph {
  if (restPath.length === 0) {
    return {
      ...sub,
      nodes: sub.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    };
  }
  const [head, ...tail] = restPath;
  return {
    ...sub,
    nodes: sub.nodes.map((n) => {
      if (n.id !== head || !n.subGraph) return n;
      return { ...n, subGraph: patchSubGraph(n.subGraph, tail, nodeId, patch) };
    }),
  };
}

export function patchNodeInForest(
  forest: PlaygroundNestedForest,
  drillPath: string[],
  nodeId: string,
  patch: Partial<PlaygroundDagNode>,
): PlaygroundNestedForest {
  if (drillPath.length === 0) {
    return {
      ...forest,
      nodes: forest.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    };
  }
  const [head, ...rest] = drillPath;
  return {
    ...forest,
    nodes: forest.nodes.map((n) => {
      if (n.id !== head || !n.subGraph) return n;
      return {
        ...n,
        subGraph: patchSubGraph(n.subGraph, rest, nodeId, patch),
      };
    }),
  };
}

function replaceSubGraphSlice(
  sub: PlaygroundSubGraph,
  restPath: string[],
  nextNodes: PlaygroundDagNode[],
  nextEdges: AgentDagEdge[],
): PlaygroundSubGraph {
  if (restPath.length === 0) {
    return { nodes: nextNodes, edges: nextEdges };
  }
  const [head, ...tail] = restPath;
  return {
    ...sub,
    nodes: sub.nodes.map((n) => {
      if (n.id !== head || !n.subGraph) return n;
      return {
        ...n,
        subGraph: replaceSubGraphSlice(n.subGraph, tail, nextNodes, nextEdges),
      };
    }),
  };
}

export function replaceViewInForest(
  forest: PlaygroundNestedForest,
  drillPath: string[],
  nextNodes: PlaygroundDagNode[],
  nextEdges: AgentDagEdge[],
): PlaygroundNestedForest {
  if (drillPath.length === 0) {
    return { nodes: nextNodes, edges: nextEdges };
  }
  const [head, ...rest] = drillPath;
  return {
    ...forest,
    nodes: forest.nodes.map((n) => {
      if (n.id !== head || !n.subGraph) return n;
      if (rest.length === 0) {
        return { ...n, subGraph: { nodes: nextNodes, edges: nextEdges } };
      }
      return {
        ...n,
        subGraph: replaceSubGraphSlice(n.subGraph, rest, nextNodes, nextEdges),
      };
    }),
  };
}

/** Drop playground-only nesting for Rust / Agent SOP. */
export function stripPlaygroundNodeForAgent(node: PlaygroundDagNode): AgentDagNode {
  const { subGraph, ...rest } = node;
  void subGraph;
  return rest as AgentDagNode;
}

export function toAgentLayerSnapshot(nodes: PlaygroundDagNode[], edges: AgentDagEdge[]) {
  return {
    nodes: nodes.map((n) => stripPlaygroundNodeForAgent(n)),
    edges,
  };
}
