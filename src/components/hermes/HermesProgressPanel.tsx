import type { HermesUiSnapshot, SopStepRunStatus } from '@/types/hermesOrchestration';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

function stepIcon(status: SopStepRunStatus) {
  if (status === 'done') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden />;
  }
  if (status === 'running') {
    return <Loader2 className="w-3.5 h-3.5 text-amber-300 animate-spin shrink-0" aria-hidden />;
  }
  return <Circle className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden />;
}

export type HermesProgressPanelProps = {
  snapshot: HermesUiSnapshot;
  busy: boolean;
};

/** Inline Hermes status + SOP checklist (no modal). */
export function HermesProgressPanel({ snapshot, busy }: HermesProgressPanelProps) {
  if (!busy || snapshot.phase === 'idle') {
    return null;
  }

  const pulse = snapshot.phase === 'understanding_intent' || snapshot.phase === 'direct_inference';
  const pillClass = pulse
    ? 'text-sky-300 animate-pulse border-sky-500/50 bg-sky-950/40'
    : snapshot.phase === 'sop_running'
      ? 'text-violet-200 border-violet-500/40 bg-violet-950/35'
      : snapshot.phase === 'delegating_sub_agent'
        ? 'text-amber-200 border-amber-500/40 bg-amber-950/35'
        : snapshot.phase === 'error'
          ? 'text-red-300 border-red-500/40 bg-red-950/35'
          : 'text-slate-400 border-slate-600/50 bg-slate-900/30';

  return (
    <div className="space-y-2" aria-live="polite">
      <div className={`text-center text-xs font-mono py-1.5 px-2 rounded-lg border ${pillClass}`}>{snapshot.headline}</div>
      {snapshot.sopSteps && snapshot.sopSteps.length > 0 ? (
        <ul className="rounded-lg border border-slate-600/50 bg-slate-900/40 px-2 py-2 space-y-1.5 max-h-[160px] overflow-y-auto">
          {snapshot.sopSteps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-[11px] text-slate-200 leading-snug">
              {stepIcon(s.status)}
              <span className={s.status === 'pending' ? 'opacity-50' : ''}>
                <span className="text-slate-500 mr-1">
                  {s.index}/{s.total}
                </span>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
