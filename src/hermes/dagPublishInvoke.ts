import type { RustDagGraph } from '@/hermes/tauriWorkflowRun';

export type DagPublishInvokePayload = {
  graph: RustDagGraph;
  bundleId?: string;
  bundleVersion?: string;
  contentDigest?: string;
};

export async function invokeDagPublishGraph(payload: DagPublishInvokePayload): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('dag_publish_graph', { payload });
}
