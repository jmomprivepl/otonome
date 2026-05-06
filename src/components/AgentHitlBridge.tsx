import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useKanbanStore } from '@/store';
import { isTauriRuntime } from '@/config/nativeLlm';
import { ActionApprovalModal } from '@/components/ActionApprovalModal';
import { ClarificationModal } from '@/components/ClarificationModal';
import { HumanReviewModal } from '@/components/HumanReviewModal';
import type { ActionPendingPayload, ClarificationPayload, HumanReviewPayload } from '@/types/agentDag';

export function AgentHitlBridge() {
  const isLoggedIn = useKanbanStore((s) => s.isLoggedIn);
  const pendingActionApproval = useKanbanStore((s) => s.pendingActionApproval);
  const pendingClarification = useKanbanStore((s) => s.pendingClarification);
  const pendingHumanReview = useKanbanStore((s) => s.pendingHumanReview);
  const setPendingActionApproval = useKanbanStore((s) => s.setPendingActionApproval);
  const setPendingClarification = useKanbanStore((s) => s.setPendingClarification);
  const setPendingHumanReview = useKanbanStore((s) => s.setPendingHumanReview);
  const appendAgentDagLog = useKanbanStore((s) => s.appendAgentDagLog);

  useEffect(() => {
    if (!isLoggedIn || !isTauriRuntime()) return;

    const setup = (async () => {
      const u1 = await listen<ActionPendingPayload>('action_pending_approval', (e) => {
        setPendingActionApproval(e.payload);
      });
      const u2 = await listen<ClarificationPayload>('clarification_needed', (e) => {
        setPendingClarification(e.payload);
      });
      const u3 = await listen<HumanReviewPayload>('workflow_human_needed', (e) => {
        setPendingHumanReview(e.payload);
      });
      const u4 = await listen<{ nodeId: string; phase: string; detail?: string }>('dag_node_event', (e) => {
        const { nodeId, phase, detail } = e.payload;
        appendAgentDagLog(`node ${nodeId}: ${phase}${detail ? ` — ${detail}` : ''}`);
      });
      type WorkflowSnap = {
        runId?: string;
        nodeOutputs?: Record<string, string>;
      };
      const u5 = await listen<WorkflowSnap>('workflow_state_updated', (e) => {
        const nOut = e.payload.nodeOutputs ?? {};
        const cnt = Object.keys(nOut).length;
        appendAgentDagLog(
          `workflow state updated (${e.payload.runId ?? '?'}) — ${cnt} node output(s)`,
        );
      });
      const u6 = await listen<{ ok: boolean; error?: string }>('dag_run_finished', (e) => {
        const { ok, error } = e.payload;
        appendAgentDagLog(ok ? 'DAG run finished OK' : `DAG run failed: ${error ?? 'unknown'}`);
      });
      return [u1, u2, u3, u4, u5, u6] as const;
    })();

    return () => {
      void setup.then((unsubs) => unsubs.forEach((u) => u()));
    };
  }, [
    isLoggedIn,
    setPendingActionApproval,
    setPendingClarification,
    setPendingHumanReview,
    appendAgentDagLog,
  ]);

  const resolveApproval = async (approved: boolean) => {
    if (!pendingActionApproval) return;
    const { id } = pendingActionApproval;
    setPendingActionApproval(null);
    if (!isTauriRuntime()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('hitl_resolve_action', { id, approved });
    } catch (err) {
      console.error(err);
      appendAgentDagLog(`HITL resolve error: ${String(err)}`);
    }
  };

  const submitClarification = async (response: string) => {
    if (!pendingClarification) return;
    const { id } = pendingClarification;
    setPendingClarification(null);
    if (!isTauriRuntime()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('hitl_submit_clarification', { id, response });
    } catch (err) {
      console.error(err);
      appendAgentDagLog(`Clarification submit error: ${String(err)}`);
    }
  };

  const submitHumanReview = async (approved: boolean, notes: string) => {
    if (!pendingHumanReview) return;
    const { id } = pendingHumanReview;
    setPendingHumanReview(null);
    if (!isTauriRuntime()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const reply =
      notes.trim().length > 0 ? ({ notes: notes.trim() } as Record<string, unknown>) : {};
    try {
      await invoke('hitl_submit_human_review', {
        id,
        approved,
        reply,
      });
    } catch (err) {
      console.error(err);
      appendAgentDagLog(`Human review submit error: ${String(err)}`);
    }
  };

  return (
    <>
      {pendingActionApproval ? (
        <ActionApprovalModal
          payload={pendingActionApproval}
          onApprove={() => void resolveApproval(true)}
          onReject={() => void resolveApproval(false)}
        />
      ) : null}
      {pendingClarification ? (
        <ClarificationModal
          payload={pendingClarification}
          onSubmit={(t) => void submitClarification(t)}
          onCancel={() => void submitClarification('user_cancelled')}
        />
      ) : null}
      {pendingHumanReview ? (
        <HumanReviewModal
          payload={pendingHumanReview}
          onSubmit={(approved, notes) => void submitHumanReview(approved, notes)}
        />
      ) : null}
    </>
  );
}
