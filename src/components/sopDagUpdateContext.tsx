import { createContext, useCallback, useContext } from 'react';
import { useKanbanStore } from '@/store';
import type { AgentDagNode } from '@/types/agentDag';

export type SopDagNodePatchFn = (id: string, patch: Partial<AgentDagNode>) => void;

/** When set (e.g. on Playground), node edits update this handler instead of the Kanban store. */
export const SopDagUpdateContext = createContext<SopDagNodePatchFn | null>(null);

export function useSopDagUpdate(): SopDagNodePatchFn {
  const override = useContext(SopDagUpdateContext);
  const updateAgentDagNode = useKanbanStore((s) => s.updateAgentDagNode);
  return useCallback(
    (id, patch) => {
      (override ?? updateAgentDagNode)(id, patch);
    },
    [override, updateAgentDagNode],
  );
}
