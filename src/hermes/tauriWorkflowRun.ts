/**
 * Starts a persisted DAG workflow in Tauri (graph + workflow context) and waits for completion.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AgentDagEdge, AgentDagNode } from '@/types/agentDag';

export interface WorkflowPublicSnapshot {
  runId: string;
  userRequest: string;
  sopId?: string | null;
  taskId?: string | null;
  nodeOutputs: Record<string, string>;
  humanInputs: Record<string, unknown>;
}

export interface DagRunFinishedPayload {
  ok: boolean;
  error?: string;
  runId?: string;
  workflow?: WorkflowPublicSnapshot;
}

export function toRustDagGraph(nodes: AgentDagNode[], edges: AgentDagEdge[]) {
  return {
    nodes: nodes.map(({ position: _p, ...n }) => ({
      ...n,
      nodeKind: n.nodeKind ?? 'agent',
    })),
    edges,
  };
}

export interface WorkflowRunStartInvokePayload {
  graph: ReturnType<typeof toRustDagGraph>;
  llamaOptions: Record<string, unknown> | null;
  anthropicModel?: string | null;
  userRequest?: string | null;
  sopId?: string | null;
  taskId?: string | null;
  hermesModel?: string | null;
  hermesMaxTurns?: number | null;
}

export async function runTauriWorkflowAndWait(payload: WorkflowRunStartInvokePayload): Promise<DagRunFinishedPayload> {
  return new Promise<DagRunFinishedPayload>((resolve) => {
    void (async () => {
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<DagRunFinishedPayload>('dag_run_finished', (e) => {
          unlisten?.();
          resolve(e.payload);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
        return;
      }
      try {
        await invoke('workflow_run_start', { payload });
      } catch (e) {
        unlisten?.();
        resolve({ ok: false, error: String(e) });
      }
    })();
  });
}
