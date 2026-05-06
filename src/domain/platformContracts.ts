export type RunIntent = {
  correlationId: string;
  workspaceId?: string;
  rawText: string;
  structuredHints?: Record<string, unknown>;
};

export type RouteMode = 'sop' | 'adhoc';

export type RouteDecision = {
  mode: RouteMode;
  sopBundleId?: string;
  sopVersion?: string;
  entryNodeId?: string;
  confidence: number;
  rationaleTrace: string[];
};

export function assertRunIntent(input: unknown): asserts input is RunIntent {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('RunIntent must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o.correlationId !== 'string' || o.correlationId.trim().length === 0) {
    throw new TypeError('RunIntent.correlationId must be a non-empty string');
  }
  if (typeof o.rawText !== 'string') {
    throw new TypeError('RunIntent.rawText must be a string');
  }
  if (o.workspaceId !== undefined && typeof o.workspaceId !== 'string') {
    throw new TypeError('RunIntent.workspaceId must be a string when provided');
  }
}

/** Phase-1 placeholder classifier */
export function decideRoute(intent: RunIntent): RouteDecision {
  const t = intent.rawText.trim().toLowerCase();
  const trace: string[] = ['decideRoute:placeholder_v1'];
  if (t.includes('use sop') || t.includes('standard procedure')) {
    return {
      mode: 'sop',
      sopBundleId: 'embedded-default',
      sopVersion: '0.0.1',
      confidence: 0.85,
      rationaleTrace: [...trace, 'matched_keyword:sop'],
    };
  }
  return {
    mode: 'adhoc',
    confidence: 0.55,
    rationaleTrace: [...trace, 'default_adhoc'],
  };
}
