import { describe, expect, it } from 'vitest';
import type { WorkflowPublicSnapshot } from '@/hermes/tauriWorkflowRun';
import type { ActiveDagRunSnapshot } from './delegationHub';
import { buildActiveDagRunFromWorkflowSnapshot } from './delegationHub';

describe('buildActiveDagRunFromWorkflowSnapshot', () => {
  it('preserves last node hints when runId matches', () => {
    const prev: ActiveDagRunSnapshot = {
      runId: 'r1',
      userRequestPreview: 'x',
      completedNodes: 0,
      updatedAt: 0,
      lastNodeId: 'n1',
      lastNodePhase: 'started',
    };
    const snap: WorkflowPublicSnapshot = {
      runId: 'r1',
      userRequest: 'hello world',
      sopId: null,
      taskId: null,
      nodeOutputs: { n1: 'done' },
      humanInputs: {},
      bundleId: 'b',
      bundleVersion: '1.0.0',
      contentDigest: 'a'.repeat(64),
    };
    const next = buildActiveDagRunFromWorkflowSnapshot(snap, prev);
    expect(next.lastNodeId).toBe('n1');
    expect(next.completedNodes).toBe(1);
    expect(next.bundleId).toBe('b');
  });

  it('clears node hints when run id changes', () => {
    const prev: ActiveDagRunSnapshot = {
      runId: 'r1',
      userRequestPreview: 'x',
      completedNodes: 1,
      updatedAt: 1,
      lastNodeId: 'n1',
      lastNodePhase: 'done',
    };
    const snap: WorkflowPublicSnapshot = {
      runId: 'r2',
      userRequest: 'next',
      nodeOutputs: {},
      humanInputs: {},
    };
    const next = buildActiveDagRunFromWorkflowSnapshot(snap, prev);
    expect(next.lastNodeId).toBeUndefined();
    expect(next.runId).toBe('r2');
  });
});
