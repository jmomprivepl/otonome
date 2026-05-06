import { describe, expect, it } from 'vitest';
import { inferTimeSensitiveFromPayload } from './hitlTimeSensitivity';

describe('inferTimeSensitiveFromPayload', () => {
  it('honors explicit true / false without further inference', () => {
    expect(inferTimeSensitiveFromPayload({ timeSensitive: true }).rule).toBe('explicit_true');
    expect(inferTimeSensitiveFromPayload({ timeSensitive: true }).timeSensitive).toBe(true);
    expect(inferTimeSensitiveFromPayload({ timeSensitive: false }).rule).toBe('explicit_false');
    expect(inferTimeSensitiveFromPayload({ timeSensitive: false }).timeSensitive).toBe(false);
  });

  it('flags destructive tools', () => {
    const r = inferTimeSensitiveFromPayload({ destructive: true });
    expect(r.timeSensitive).toBe(true);
    expect(r.rule).toBe('destructive');
  });

  it('flags SLA risk under 120s', () => {
    expect(inferTimeSensitiveFromPayload({ slaSecondsRemaining: 119 }).rule).toBe('sla_breach');
    expect(inferTimeSensitiveFromPayload({ slaSecondsRemaining: 120 }).rule).toBe('none');
  });

  it('flags high risk scores', () => {
    expect(inferTimeSensitiveFromPayload({ riskScore: 0.85 }).rule).toBe('risk_score');
    expect(inferTimeSensitiveFromPayload({ riskScore: 0.84 }).rule).toBe('none');
  });

  it('flags regulated category', () => {
    expect(inferTimeSensitiveFromPayload({ category: 'regulated' }).rule).toBe('regulated_category');
    expect(inferTimeSensitiveFromPayload({ category: 'other' }).rule).toBe('none');
  });

  it('priority: destructive wins over lower rules when explicit flag absent', () => {
    expect(
      inferTimeSensitiveFromPayload({
        destructive: true,
        slaSecondsRemaining: 10,
      }).rule,
    ).toBe('destructive');
  });
});
