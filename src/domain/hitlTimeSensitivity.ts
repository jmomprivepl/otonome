/**
 * Delegation Hub §8.3 — product rules for when an HITL item is **time-sensitive**
 * (column + escalation modal). Centralize heuristics when the backend omits `timeSensitive`.
 */

export type TimeSensitivityRule =
  | 'explicit_true'
  | 'explicit_false'
  | 'destructive'
  | 'sla_breach'
  | 'risk_score'
  | 'regulated_category'
  | 'none';

export type HitlSensitivityInput = {
  timeSensitive?: boolean;
  destructive?: boolean;
  /** Org policy tag; `regulated` marks regulated/sensitive workflows (spec §8.3.2). */
  category?: string;
  slaSecondsRemaining?: number;
  riskScore?: number;
};

export function inferTimeSensitiveFromPayload(p: HitlSensitivityInput): {
  timeSensitive: boolean;
  rule: TimeSensitivityRule;
} {
  if (p.timeSensitive === true) {
    return { timeSensitive: true, rule: 'explicit_true' };
  }
  if (p.timeSensitive === false) {
    return { timeSensitive: false, rule: 'explicit_false' };
  }
  if (p.destructive) {
    return { timeSensitive: true, rule: 'destructive' };
  }
  if (p.slaSecondsRemaining != null && p.slaSecondsRemaining < 120) {
    return { timeSensitive: true, rule: 'sla_breach' };
  }
  if (p.riskScore != null && p.riskScore >= 0.85) {
    return { timeSensitive: true, rule: 'risk_score' };
  }
  if (p.category === 'regulated') {
    return { timeSensitive: true, rule: 'regulated_category' };
  }
  return { timeSensitive: false, rule: 'none' };
}

export function withResolvedTimeSensitivity<T extends HitlSensitivityInput>(
  payload: T,
): T & { timeSensitive: boolean; timeSensitivityRule?: TimeSensitivityRule } {
  const { timeSensitive, rule } = inferTimeSensitiveFromPayload(payload);
  const next = {
    ...payload,
    timeSensitive,
  } as T & { timeSensitive: boolean; timeSensitivityRule?: TimeSensitivityRule };
  if (rule !== 'none') {
    next.timeSensitivityRule = rule;
  }
  return next;
}

export function logTimeSensitivityResolution(
  kind: 'action' | 'clarification' | 'human_review',
  id: string,
  rule: TimeSensitivityRule,
  timeSensitive: boolean,
): void {
  // Structured log for analytics / tuning (spec §8.3).
  console.info('[delegation.hitl:timeSensitivity]', { kind, id, rule, timeSensitive });
}
