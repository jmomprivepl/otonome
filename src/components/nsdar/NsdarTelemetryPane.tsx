import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

type Props = {
  lines: string[];
};

export function NsdarTelemetryPane({ lines }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div className="flex flex-col min-h-[180px] h-full rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-slate-950/90 overflow-hidden shadow-inner">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/80 bg-slate-900/95">
        <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
        <span className="text-xs font-medium text-slate-300 tracking-wide">SYSTEM TELEMETRY</span>
      </div>
      <div
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] sm:text-xs text-emerald-400/95 leading-relaxed"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <span className="text-slate-500">&gt; Awaiting events…</span>
        ) : (
          lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div className="px-3 py-2 border-t border-slate-700/80 bg-slate-900/95">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Memory (llama-cli)</span>
          <span className="text-[10px] text-slate-500 font-mono">n/a</span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full w-1/3 rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 opacity-40 animate-pulse"
            title="Placeholder: wire sysinfo + child PID for RSS"
          />
        </div>
      </div>
    </div>
  );
}
