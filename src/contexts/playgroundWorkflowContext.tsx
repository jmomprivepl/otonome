/* Context module: exporting hooks alongside the provider is intentional. */
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react';

export type PlaygroundDrillApi = {
  /** Enter the sub-workflow of a node on the current canvas (must define subGraph). */
  drillInto: (containerNodeId: string) => void;
  /**
   * Task Manager agent — decompose parent step into a new linear sub-workflow (mutation in forest).
   * No-op when the node already has a sub-workflow.
   */
  createSubworkflowFromAgent: (nodeId: string) => Promise<void>;
};

const PlaygroundDrillContext = createContext<PlaygroundDrillApi | null>(null);

export function PlaygroundDrillProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: PlaygroundDrillApi;
}) {
  return <PlaygroundDrillContext.Provider value={value}>{children}</PlaygroundDrillContext.Provider>;
}

export function usePlaygroundDrill(): PlaygroundDrillApi | null {
  return useContext(PlaygroundDrillContext);
}

export function useRequirePlaygroundDrill(): PlaygroundDrillApi {
  const api = useContext(PlaygroundDrillContext);
  if (!api) {
    throw new Error('useRequirePlaygroundDrill must run under PlaygroundDrillProvider');
  }
  return api;
}
