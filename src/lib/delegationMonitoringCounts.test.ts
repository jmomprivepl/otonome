import { describe, expect, it } from 'vitest';
import type { ActiveDagRunSnapshot, DelegationHermesActivity } from '@/types/delegationHub';
import { computeDelegationStripCounts } from './delegationMonitoringCounts';

function dagStub(): ActiveDagRunSnapshot {
  return {
    runId: 'r1',
    userRequestPreview: 'x',
    completedNodes: 0,
    updatedAt: 0,
  };
}

function hermesStub(partial: Partial<DelegationHermesActivity>): DelegationHermesActivity {
  return {
    phase: 'idle',
    headline: '',
    sopSteps: [],
    platformRoute: null,
    busy: false,
    ...partial,
  };
}

describe('computeDelegationStripCounts', () => {
  it('counts sop_running as one running Sop', () => {
    const counts = computeDelegationStripCounts({
      pendingApprovalsCount: 0,
      hermesActivity: hermesStub({ busy: true, phase: 'sop_running' }),
      dag: null,
    });
    expect(counts.runningSops).toBe(1);
    expect(counts.activeJobs).toBe(0);
    expect(counts.approvals).toBe(0);
  });

  it('bumps activeJobs when a DAG snapshot is present', () => {
    const counts = computeDelegationStripCounts({
      pendingApprovalsCount: 0,
      hermesActivity: hermesStub({ busy: false, phase: 'idle' }),
      dag: dagStub(),
    });
    expect(counts.activeJobs).toBe(1);
    expect(counts.runningSops).toBe(0);
  });

  it('returns zeros except approvals when Hermes is idle and there is no DAG', () => {
    const counts = computeDelegationStripCounts({
      pendingApprovalsCount: 2,
      hermesActivity: hermesStub({ busy: false, phase: 'idle' }),
      dag: null,
    });
    expect(counts.approvals).toBe(2);
    expect(counts.runningSops).toBe(0);
    expect(counts.activeJobs).toBe(0);
  });
});
