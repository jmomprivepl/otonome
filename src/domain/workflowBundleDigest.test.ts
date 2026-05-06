import { describe, expect, it } from 'vitest';
import type { WorkflowBundleGraphPayload } from '@/types/workflowBundle';
import { computeWorkflowContentDigest, stableStringify } from './workflowBundleDigest';

describe('workflowBundleDigest', () => {
  it('stableStringify sorts object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('computeWorkflowContentDigest is deterministic for same graph', async () => {
    const g: WorkflowBundleGraphPayload = {
      nodes: [
        {
          id: 'n1',
          label: 'A',
          prompt: 'p',
          executionTarget: 'localQvac',
          requiresSystemTool: false,
          systemToolName: null,
          systemToolArgsSummary: null,
          raciLayer: 'responsible',
          position: { x: 0, y: 0 },
        },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
    };
    const a = await computeWorkflowContentDigest(g);
    const b = await computeWorkflowContentDigest(g);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
