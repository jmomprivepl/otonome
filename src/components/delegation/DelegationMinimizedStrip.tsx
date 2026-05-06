type DelegationMinimizedStripProps = {
  approvalCount: number;
  runningSopCount: number;
  activeJobCount: number;
  onExpand: () => void;
};

export function DelegationMinimizedStrip({
  approvalCount,
  runningSopCount,
  activeJobCount,
  onExpand,
}: DelegationMinimizedStripProps) {
  return (
    <header
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/50 bg-amber-50/90 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-950/40"
      role="banner"
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Hermes · minimized
        </p>
        <p className="truncate text-xs text-slate-700 dark:text-slate-300">
          Approvals stay visible — expand for full delegation + monitoring columns.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:bg-slate-900/60 dark:text-red-300">
          Approvals · <strong>{approvalCount}</strong>
        </span>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-violet-800 dark:bg-slate-900/60 dark:text-violet-300">
          SOPs · <strong>{runningSopCount}</strong>
        </span>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-sky-800 dark:bg-slate-900/60 dark:text-sky-300">
          Jobs · <strong>{activeJobCount}</strong>
        </span>
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand delegation shell"
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700"
        >
          Expand
        </button>
      </div>
    </header>
  );
}
