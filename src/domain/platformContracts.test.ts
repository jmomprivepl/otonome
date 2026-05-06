import { describe, expect, it } from 'vitest';
import { assertRunIntent, decideRoute } from './platformContracts';

describe('platformContracts', () => {
  it('rejects invalid RunIntent payloads', () => {
    expect(() => assertRunIntent(null)).toThrow(TypeError);
    expect(() => assertRunIntent({})).toThrow(/correlationId/);
    expect(() =>
      assertRunIntent({
        correlationId: '   ',
        rawText: 'x',
      }),
    ).toThrow(/correlationId/);
    expect(() =>
      assertRunIntent({
        correlationId: 'c',
        rawText: 123 as unknown as string,
      }),
    ).toThrow(/rawText/);
    expect(() =>
      assertRunIntent({
        correlationId: 'c',
        rawText: 'x',
        workspaceId: 1 as unknown as string,
      }),
    ).toThrow(/workspaceId/);
    expect(() =>
      assertRunIntent({
        correlationId: 'c',
        rawText: 'x',
        structuredHints: null as unknown as Record<string, unknown>,
      }),
    ).toThrow(/structuredHints/);
    expect(() =>
      assertRunIntent({
        correlationId: 'c',
        rawText: 'x',
        structuredHints: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow(/structuredHints/);
    expect(() =>
      assertRunIntent({
        correlationId: 'c',
        rawText: 'x',
        structuredHints: 'nope' as unknown as Record<string, unknown>,
      }),
    ).toThrow(/structuredHints/);
    assertRunIntent({
      correlationId: 'c',
      rawText: 'x',
      structuredHints: { key: 'value' },
    });
  });

  it('defaults to adhoc routing when no SOP keywords match', () => {
    const decision = decideRoute({
      correlationId: 'cid-1',
      rawText: 'Do something ad-hoc',
    });
    expect(decision.mode).toBe('adhoc');
    expect(decision.confidence).toBe(0.55);
    expect(decision.rationaleTrace).toContain('default_adhoc');
  });

  it('routes to SOP when keywords are present', () => {
    const useSop = decideRoute({
      correlationId: 'cid-2',
      rawText: 'Please use SOP for this',
    });
    expect(useSop.mode).toBe('sop');
    expect(useSop.sopBundleId).toBe('embedded-default');
    expect(useSop.sopVersion).toBe('0.0.1');
    expect(useSop.rationaleTrace).toContain('matched_keyword:sop');

    const standardProcedure = decideRoute({
      correlationId: 'cid-3',
      rawText: 'Follow the Standard Procedure',
    });
    expect(standardProcedure.mode).toBe('sop');
  });
});
