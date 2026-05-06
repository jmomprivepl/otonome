import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useKanbanStore } from '@/store';
import { isTauriRuntime } from '@/config/nativeLlm';
import { ActionApprovalModal } from '@/components/ActionApprovalModal';
import { ClarificationModal } from '@/components/ClarificationModal';
import { HumanReviewModal } from '@/components/HumanReviewModal';
import type { ActionPendingPayload, ClarificationPayload, HumanReviewPayload } from '@/types/agentDag';
import type { WorkflowPublicSnapshot } from '@/hermes/tauriWorkflowRun';
import { logTimeSensitivityResolution, withResolvedTimeSensitivity } from '@/domain/hitlTimeSensitivity';

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
        const enriched = withResolvedTimeSensitivity(e.payload);
        logTimeSensitivityResolution('action', enriched.id, enriched.timeSensitivityRule ?? 'none', enriched.timeSensitive);
        setPendingActionApproval(enriched);
      });
      const u2 = await listen<ClarificationPayload>('clarification_needed', (e) => {
        const enriched = withResolvedTimeSensitivity(e.payload);
        logTimeSensitivityResolution(
          'clarification',
          enriched.id,
          enriched.timeSensitivityRule ?? 'none',
          enriched.timeSensitive,
        );
        setPendingClarification(enriched);
      });
      const u3 = await listen<HumanReviewPayload>('workflow_human_needed', (e) => {
        const enriched = withResolvedTimeSensitivity(e.payload);
        logTimeSensitivityResolution(
          'human_review',
          enriched.id,
          enriched.timeSensitivityRule ?? 'none',
          enriched.timeSensitive,
        );
        setPendingHumanReview(enriched);
      });
      const u4 = await listen<{ nodeId: string; phase: string; detail?: string }>('dag_node_event', (e) => {
        const { nodeId, phase, detail } = e.payload;
        appendAgentDagLog(`node ${nodeId}: ${phase}${detail ? ` — ${detail}` : ''}`);
        useKanbanStore.getState().patchActiveDagRunNodeEvent({ nodeId, phase, detail });
      });
      const u5 = await listen<WorkflowPublicSnapshot>('workflow_state_updated', (e) => {
        const p = e.payload;
        const nOut = p.nodeOutputs ?? {};
        const cnt = Object.keys(nOut).length;
        appendAgentDagLog(`workflow state updated (${p.runId ?? '?'}) — ${cnt} node output(s)`);
        useKanbanStore.getState().syncActiveDagRunFromWorkflowSnapshot(p);
      });
      type DagRunFinishedPayload = {
        ok: boolean;
        error?: string;
        runId?: string;
        workflow?: WorkflowPublicSnapshot;
      };
      const u6 = await listen<DagRunFinishedPayload>('dag_run_finished', (e) => {
        const { ok, error, workflow: wf } = e.payload;
        appendAgentDagLog(ok ? 'DAG run finished OK' : `DAG run failed: ${error ?? 'unknown'}`);
        const bid = wf?.bundleId?.trim();
        const ver = wf?.bundleVersion?.trim();
        const digest = wf?.contentDigest?.trim();
        if (bid || ver || digest) {
          const digShort = digest && digest.length > 0 ? `${digest.slice(0, 12)}…` : '—';
          appendAgentDagLog(
            `  bundle audit: ${bid ?? '—'} @ ${ver ?? '—'} · digest ${digShort}`,
          );
        }
        useKanbanStore.getState().clearActiveDagRun();
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
          variant={pendingActionApproval.timeSensitive ? 'timeSensitive' : 'standard'}
          onApprove={() => void resolveApproval(true)}
          onReject={() => void resolveApproval(false)}
        />
      ) : null}
      {pendingClarification ? (
        <ClarificationModal
          payload={pendingClarification}
          variant={pendingClarification.timeSensitive ? 'timeSensitive' : 'standard'}
          onSubmit={(t) => void submitClarification(t)}
          onCancel={() => void submitClarification('user_cancelled')}
        />
      ) : null}
      {pendingHumanReview ? (
        <HumanReviewModal
          payload={pendingHumanReview}
          variant={pendingHumanReview.timeSensitive ? 'timeSensitive' : 'standard'}
          onSubmit={(approved, notes) => void submitHumanReview(approved, notes)}
        />
      ) : null}
    </>
  );
}
