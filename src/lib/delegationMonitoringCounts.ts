import type { ActiveDagRunSnapshot, DelegationHermesActivity } from '@/types/delegationHub';

export type DelegationStripCounts = {
  approvals: number;
  runningSops: number;
  activeJobs: number;
};

export function computeDelegationStripCounts(input: {
  pendingApprovalsCount: number;
  hermesActivity: DelegationHermesActivity | null;
  dag: ActiveDagRunSnapshot | null;
}): DelegationStripCounts {
  const sopFromHermes =
    Boolean(input.hermesActivity?.busy && input.hermesActivity.phase === 'sop_running');
  const hermesBusyNonSop = Boolean(
    input.hermesActivity?.busy &&
      input.hermesActivity.phase !== 'idle' &&
      input.hermesActivity.phase !== 'sop_running',
  );
  const jobsFromDag = input.dag ? 1 : 0;
  const jobs = jobsFromDag + (hermesBusyNonSop ? 1 : 0);

  return {
    approvals: input.pendingApprovalsCount,
    runningSops: sopFromHermes ? 1 : 0,
    activeJobs: jobs,
  };
}
