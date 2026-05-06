import type { HermesTraceEvent } from '@/types/hermesOrchestration';

/** One Audit-trail line (matches `formatHermesTrace` entries). */
export function formatHermesTraceLine(e: HermesTraceEvent): string {
  return e.type === 'log' ? e.message : `> route decision: ${JSON.stringify(e.decision)}`;
}

export function formatHermesTrace(events: HermesTraceEvent[]): string[] {
  return events.map(formatHermesTraceLine);
}
