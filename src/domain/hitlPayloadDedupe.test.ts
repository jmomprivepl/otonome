import { describe, expect, it } from 'vitest';
import { isIdenticalHitlPayload, stableStringify } from './hitlPayloadDedupe';

describe('stableStringify', () => {
  it('is order-insensitive for object keys', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('handles nested records', () => {
    const a = { id: 'x', meta: { z: 1, y: 2 } };
    const b = { id: 'x', meta: { y: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

describe('isIdenticalHitlPayload', () => {
  it('returns false when previous is null', () => {
    expect(isIdenticalHitlPayload(null, { id: '1', x: 1 })).toBe(false);
  });

  it('returns true for deep-equal payloads', () => {
    const p = { id: 'a', toolName: 't', argsSummary: 's', nodeId: 'n', timeSensitive: false };
    expect(isIdenticalHitlPayload(p, { ...p })).toBe(true);
  });

  it('returns false when a field changes', () => {
    const a = { id: 'a', toolName: 't', argsSummary: 's', nodeId: null, timeSensitive: false };
    const b = { ...a, timeSensitive: true };
    expect(isIdenticalHitlPayload(a, b)).toBe(false);
  });
});
