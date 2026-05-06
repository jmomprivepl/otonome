import { describe, expect, it } from 'vitest';
import { GLOBAL_WORKFLOW_BUNDLE_PIN_KEY } from '@/types/workflowBundle';
import { pickWorkflowBundlePin, tryPinnedBundleVersion } from '@/hermes/resolveWorkflowBundle';

describe('resolveWorkflowBundle', () => {
  it('pickWorkflowBundlePin prefers project over global', () => {
    const pins = {
      p1: { bundleId: 'b', semver: '1.0.0', contentDigest: 'a'.repeat(64) },
      [GLOBAL_WORKFLOW_BUNDLE_PIN_KEY]: { bundleId: 'g', semver: '0.1.0', contentDigest: 'b'.repeat(64) },
    };
    expect(pickWorkflowBundlePin(pins, 'p1')?.bundleId).toBe('b');
    expect(pickWorkflowBundlePin(pins, null)?.bundleId).toBe('g');
    expect(pickWorkflowBundlePin(pins, undefined)?.bundleId).toBe('g');
  });

  it('tryPinnedBundleVersion requires matching digest', () => {
    const d = 'c'.repeat(64);
    const embedded = {
      'embedded-default': {
        versions: {
          '1.0.0': {
            bundleId: 'embedded-default',
            semver: '1.0.0',
            contentDigest: d,
            installedAt: 1,
            graph: { nodes: [], edges: [] },
          },
        },
      },
    };
    const pin = { bundleId: 'embedded-default', semver: '1.0.0', contentDigest: d };
    expect(tryPinnedBundleVersion('embedded-default', pin, embedded)?.semver).toBe('1.0.0');
    expect(
      tryPinnedBundleVersion('embedded-default', { ...pin, contentDigest: 'f'.repeat(64) }, embedded),
    ).toBeNull();
  });
});
