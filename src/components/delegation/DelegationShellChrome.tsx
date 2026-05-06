import { useEffect, useMemo, useState } from 'react';
import { useDelegationMinimizedChrome } from '@/delegation/useDelegationMinimizedChrome';
import { DelegationMinimizedStrip } from '@/components/delegation/DelegationMinimizedStrip';
import { DelegationExpandedDrawer } from '@/components/delegation/DelegationExpandedDrawer';
import { useKanbanStore } from '@/store';

type DelegationShellChromeProps = {
  /** Mirrors onboarded + logged-in gating from `App`. */
  enabled: boolean;
  sidebarCollapsed: boolean;
};

/**
 * §7 Global chrome: minimized bottom strip on focus-class + narrow routes; expand opens drawer overlay.
 * Does not wrap routes — underlying screen stays mounted (board / graph state preserved).
 */
export function DelegationShellChrome({ enabled, sidebarCollapsed }: DelegationShellChromeProps) {
  const { showMinimizedStrip } = useDelegationMinimizedChrome();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pendingAction = useKanbanStore((s) => s.pendingActionApproval);
  const pendingClarification = useKanbanStore((s) => s.pendingClarification);
  const pendingHuman = useKanbanStore((s) => s.pendingHumanReview);
  const hermes = useKanbanStore((s) => s.delegationHermesActivity);
  const dag = useKanbanStore((s) => s.activeDagRun);

  const { approvalCount, runningSopCount, activeJobCount } = useMemo(() => {
    let approvals = 0;
    if (pendingAction != null) approvals += 1;
    if (pendingClarification != null) approvals += 1;
    if (pendingHuman != null) approvals += 1;
    const sopRunning = Boolean(hermes?.busy && hermes.phase === 'sop_running');
    const runningSops = sopRunning ? 1 : 0;
    const hermesBusyOther = Boolean(
      hermes?.busy && hermes.phase !== 'idle' && hermes.phase !== 'sop_running',
    );
    const jobs = (dag ? 1 : 0) + (hermesBusyOther ? 1 : 0);
    return { approvalCount: approvals, runningSopCount: runningSops, activeJobCount: jobs };
  }, [pendingAction, pendingClarification, pendingHuman, hermes, dag]);

  useEffect(() => {
    if (showMinimizedStrip) {
      document.body.style.paddingBottom = '3.5rem';
    } else {
      document.body.style.paddingBottom = '';
    }
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [showMinimizedStrip]);

  useEffect(() => {
    if (!showMinimizedStrip) setDrawerOpen(false);
  }, [showMinimizedStrip]);

  if (!enabled || !showMinimizedStrip) {
    return null;
  }

  return (
    <>
      <DelegationMinimizedStrip
        approvalCount={approvalCount}
        runningSopCount={runningSopCount}
        activeJobCount={activeJobCount}
        onExpand={() => setDrawerOpen(true)}
      />
      {drawerOpen ? (
        <DelegationExpandedDrawer
          sidebarCollapsed={sidebarCollapsed}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </>
  );
}
