import { Lock, Unlock } from 'lucide-react';
import { NSDAR_PARAM_META, type NsdarParamMeta } from './nsdarParamMeta';

export type Ternary = -1 | 0 | 1;

type Props = {
  display: Ternary[];
  locked: boolean[];
  onCycle: (index: number) => void;
  onToggleLock: (index: number) => void;
};

function ledClasses(v: Ternary): string {
  if (v === -1) return 'bg-red-600/90 shadow-[0_0_12px_rgba(220,38,38,0.45)] text-white';
  if (v === 1) return 'bg-cyan-400/95 shadow-[0_0_14px_rgba(34,211,238,0.5)] text-slate-900';
  return 'bg-slate-600/70 text-slate-200';
}

function ParamCell({
  meta,
  value,
  isLocked,
  onCycle,
  onToggleLock,
}: {
  meta: NsdarParamMeta;
  value: Ternary;
  isLocked: boolean;
  onCycle: () => void;
  onToggleLock: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all duration-200
        ${
          isLocked
            ? 'border-amber-500/60 bg-amber-950/20'
            : 'border-slate-600/50 bg-slate-900/40 hover:border-violet-500/40'
        }`}
    >
      <button
        type="button"
        onClick={onCycle}
        title={meta.tooltip}
        className={`flex-1 min-w-0 text-left flex items-center gap-2 rounded-md transition-transform duration-150 active:scale-[0.98]`}
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-mono font-bold transition-all duration-200 ${ledClasses(value)}`}
        >
          {value}
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] text-slate-500 font-mono">P{meta.paramNumber}</span>
          <span className="block text-xs text-slate-200 truncate">{meta.shortLabel}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={`shrink-0 p-1.5 rounded-md transition-colors ${
          isLocked ? 'text-amber-400 bg-amber-900/30' : 'text-slate-500 hover:text-slate-300'
        }`}
        title={isLocked ? 'Unlock (follow router on next preview)' : 'Lock value'}
      >
        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5 opacity-60" />}
      </button>
    </div>
  );
}

function GridSection({ title, items, display, locked, onCycle, onToggleLock }: Props & { title: string; items: NsdarParamMeta[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-violet-400/90 border-b border-violet-800/40 pb-1">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((meta) => (
          <ParamCell
            key={meta.index}
            meta={meta}
            value={display[meta.index] ?? 0}
            isLocked={locked[meta.index] ?? false}
            onCycle={() => onCycle(meta.index)}
            onToggleLock={() => onToggleLock(meta.index)}
          />
        ))}
      </div>
    </div>
  );
}

export function NsdarMatrixPane(props: Props) {
  const apqc = NSDAR_PARAM_META.filter((m) => m.group === 'apqc');
  const ops = NSDAR_PARAM_META.filter((m) => m.group === 'ops');
  const future = NSDAR_PARAM_META.filter((m) => m.group === 'future');
  return (
    <div className="flex flex-col gap-4 h-full min-h-0 overflow-y-auto rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-white/40 dark:bg-slate-800/40 backdrop-blur-sm p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Neuro-Symbolic matrix</h2>
        <span className="text-[10px] font-mono text-slate-500">32 ternary · click value to cycle · lock to override</span>
      </div>
      <GridSection title="APQC Domains (1–13)" items={apqc} {...props} />
      <GridSection title="Operational (14–27)" items={ops} {...props} />
      <GridSection title="Future (28–32)" items={future} {...props} />
    </div>
  );
}

export function nextTernary(v: Ternary): Ternary {
  if (v === -1) return 0;
  if (v === 0) return 1;
  return -1;
}
