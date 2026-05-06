import { useEffect, useMemo, useState } from 'react';
import { useDelegationMinimizedChrome } from '@/delegation/useDelegationMinimizedChrome';
import { DelegationMinimizedStrip } from '@/components/delegation/DelegationMinimizedStrip';
import { DelegationExpandedDrawer } from '@/components/delegation/DelegationExpandedDrawer';
import { computeDelegationStripCounts } from '@/lib/delegationMonitoringCounts';
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
  const { delegationChromeHostActive } = useDelegationMinimizedChrome();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pendingAction = useKanbanStore((s) => s.pendingActionApproval);
  const pendingClarification = useKanbanStore((s) => s.pendingClarification);
  const pendingHuman = useKanbanStore((s) => s.pendingHumanReview);
  const hermes = useKanbanStore((s) => s.delegationHermesActivity);
  const dag = useKanbanStore((s) => s.activeDagRun);

  const { approvalCount, runningSopCount, activeJobCount } = useMemo(() => {
    let pendingApprovalsCount = 0;
    if (pendingAction != null) pendingApprovalsCount += 1;
    if (pendingClarification != null) pendingApprovalsCount += 1;
    if (pendingHuman != null) pendingApprovalsCount += 1;
    const { approvals, runningSops, activeJobs } = computeDelegationStripCounts({
      pendingApprovalsCount,
      hermesActivity: hermes,
      dag,
    });
    return {
      approvalCount: approvals,
      runningSopCount: runningSops,
      activeJobCount: activeJobs,
    };
  }, [pendingAction, pendingClarification, pendingHuman, hermes, dag]);

  useEffect(() => {
    const stripShowing = delegationChromeHostActive && !drawerOpen;
    if (stripShowing) {
      document.body.style.paddingBottom = '3.5rem';
    } else {
      document.body.style.paddingBottom = '';
    }
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [delegationChromeHostActive, drawerOpen]);

  useEffect(() => {
    if (!delegationChromeHostActive) setDrawerOpen(false);
  }, [delegationChromeHostActive]);

  if (!enabled || !delegationChromeHostActive) {
    return null;
  }

  return (
    <>
      {!drawerOpen ? (
        <DelegationMinimizedStrip
          approvalCount={approvalCount}
          runningSopCount={runningSopCount}
          activeJobCount={activeJobCount}
          onExpand={() => setDrawerOpen(true)}
        />
      ) : null}
      {drawerOpen ? (
        <DelegationExpandedDrawer
          sidebarCollapsed={sidebarCollapsed}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </>
  );
}
