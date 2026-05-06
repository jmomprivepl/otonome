import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  GitBranch,
  ArrowUpRight,
  MessageSquareWarning,
} from 'lucide-react';
import { useKanbanStore } from '@/store';
import type { ClarificationPayload, ActionPendingPayload, HumanReviewPayload } from '@/types/agentDag';

/**
 * Persistent monitoring context column (full Delegation Shell).
 * §6.2 data: Zustand HITL + `delegationHermesActivity` (OtonomeChat) + `activeDagRun` (Tauri workflow events).
 */
export function DelegationMonitoringColumn() {
  const pendingAction = useKanbanStore((s) => s.pendingActionApproval);
  const pendingClarification = useKanbanStore((s) => s.pendingClarification);
  const pendingHuman = useKanbanStore((s) => s.pendingHumanReview);
  const hermes = useKanbanStore((s) => s.delegationHermesActivity);
  const dag = useKanbanStore((s) => s.activeDagRun);

  const hitlItems = buildHitlList(pendingAction, pendingClarification, pendingHuman);
  const sopRunning = Boolean(hermes?.busy && hermes.phase === 'sop_running');
  const hermesBusyOther = Boolean(
    hermes?.busy && hermes.phase !== 'idle' && hermes.phase !== 'sop_running',
  );

  return (
    <aside
      className="flex w-full min-w-0 flex-col gap-4 border-l border-violet-200/40 bg-white/40 dark:border-violet-800/30 dark:bg-slate-900/40 lg:w-[min(100%,22rem)] lg:shrink-0 lg:border-l lg:border-t-0 lg:pt-0 border-t pt-4"
      aria-label="Delegation monitoring"
    >
      <MonitoringSection icon={AlertTriangle} title="Pending human approvals">
        {hitlItems.length === 0 ? (
          <EmptyHint>
            Nothing is waiting on you. Tool confirmations, clarifications, and human-review gates appear here when a
            workflow needs input.
          </EmptyHint>
        ) : (
          <ul className="space-y-2">
            {hitlItems.map((item) => (
              <li
                key={item.key}
                className="rounded-lg border border-amber-200/60 bg-amber-50/80 p-2.5 dark:border-amber-800/50 dark:bg-amber-950/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200/90">
                        {item.kind}
                      </span>
                      {item.timeSensitive ? (
                        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-800 dark:text-red-200">
                          Time-sensitive
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-slate-800 dark:text-slate-100">{item.title}</p>
                    {item.subtitle ? (
                      <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{item.subtitle}</p>
                    ) : null}
                  </div>
                  <MessageSquareWarning className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                </div>
                <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-500">
                  Use the modal on screen to respond — this queue is your at-a-glance backlog.
                </p>
              </li>
            ))}
          </ul>
        )}
      </MonitoringSection>

      <MonitoringSection icon={GitBranch} title="Running SOPs">
        {sopRunning && hermes?.sopSteps && hermes.sopSteps.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{hermes.headline}</p>
            <ol className="space-y-1.5">
              {hermes.sopSteps.map((step) => (
                <li
                  key={step.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-violet-200/40 bg-white/60 px-2 py-1.5 text-[11px] dark:border-violet-800/40 dark:bg-slate-800/60"
                >
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                    <span className="text-slate-400 dark:text-slate-500">
                      {step.index}/{step.total}
                    </span>{' '}
                    {step.label}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      step.status === 'running'
                        ? 'bg-sky-500/20 text-sky-800 dark:text-sky-200'
                        : step.status === 'done'
                          ? 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-200'
                          : step.status === 'failed'
                            ? 'bg-red-500/20 text-red-800 dark:text-red-200'
                            : 'bg-slate-500/15 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {step.status}
                  </span>
                </li>
              ))}
            </ol>
            {hermes.platformRoute?.sopBundleId ? (
              <p className="text-[10px] text-slate-500 dark:text-slate-500">
                Bundle{' '}
                <span className="font-mono text-slate-600 dark:text-slate-400">{hermes.platformRoute.sopBundleId}</span>
                {hermes.platformRoute.sopVersion ? (
                  <span className="text-slate-500"> @{hermes.platformRoute.sopVersion}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : sopRunning ? (
          <div className="rounded-lg border border-violet-200/50 bg-white/70 p-2.5 dark:border-violet-800/50 dark:bg-slate-800/60">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{hermes?.headline}</p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Step list will appear as the run progresses.</p>
          </div>
        ) : hermesBusyOther ? (
          <div className="rounded-lg border border-sky-200/50 bg-sky-50/70 p-2.5 dark:border-sky-800/40 dark:bg-sky-950/30">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200/90">
              Hermes in progress
            </p>
            <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">{hermes?.headline}</p>
          </div>
        ) : (
          <EmptyHint>No standard procedure is running. Trigger an SOP from the chat (e.g. mention a standard procedure).</EmptyHint>
        )}
      </MonitoringSection>

      <MonitoringSection icon={Activity} title="Active executions">
        {dag ? (
          <div className="rounded-lg border border-violet-200/50 bg-white/70 p-2.5 dark:border-violet-800/50 dark:bg-slate-800/60">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">Run {dag.runId.slice(0, 8)}…</span>
              <span className="text-[10px] text-slate-500">{dag.completedNodes} node(s) done</span>
            </div>
            <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">{dag.userRequestPreview || '(no prompt summary)'}</p>
            {(dag.bundleId || dag.bundleVersion || dag.contentDigestPrefix) && (
              <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-500">
                {dag.bundleId ? (
                  <>
                    Bundle <span className="font-mono text-slate-600 dark:text-slate-400">{dag.bundleId}</span>
                  </>
                ) : null}
                {dag.bundleVersion ? <span className="text-slate-500"> @{dag.bundleVersion}</span> : null}
                {dag.contentDigestPrefix ? (
                  <span className="ml-1 font-mono text-slate-500"> · {dag.contentDigestPrefix}…</span>
                ) : null}
              </p>
            )}
            {(dag.sopId || dag.taskId) && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {dag.taskId ? (
                  <Link
                    to="/tasks"
                    className="inline-flex items-center gap-1 text-violet-600 hover:underline dark:text-violet-400"
                  >
                    Task context <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
                {dag.sopId ? (
                  <Link
                    to="/agent-sop"
                    className="inline-flex items-center gap-1 text-violet-600 hover:underline dark:text-violet-400"
                  >
                    SOP workspace <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
              </div>
            )}
            {(dag.lastNodePhase || dag.lastNodeId) && (
              <p className="mt-2 border-t border-slate-200/80 pt-2 text-[10px] text-slate-500 dark:border-slate-600/80 dark:text-slate-400">
                Last node {dag.lastNodeId ?? '?'}: {dag.lastNodePhase}
                {dag.lastNodeDetail ? ` — ${dag.lastNodeDetail}` : ''}
              </p>
            )}
          </div>
        ) : (
          <EmptyHint>
            No DAG workflow is executing. Published graphs run in Tauri (Tasks, SOP editor, Playground) and stream status
            here.
          </EmptyHint>
        )}
      </MonitoringSection>
    </aside>
  );
}

function buildHitlList(
  action: ActionPendingPayload | null,
  clar: ClarificationPayload | null,
  human: HumanReviewPayload | null,
): { key: string; kind: string; title: string; subtitle?: string; timeSensitive?: boolean }[] {
  const out: { key: string; kind: string; title: string; subtitle?: string; timeSensitive?: boolean }[] = [];
  if (action) {
    out.push({
      key: `action-${action.id}`,
      kind: 'Tool approval',
      title: action.toolName || 'Pending tool action',
      subtitle: action.argsSummary ? truncate(action.argsSummary, 140) : undefined,
      timeSensitive: action.timeSensitive === true,
    });
  }
  if (clar) {
    out.push({
      key: `clar-${clar.id}`,
      kind: 'Clarification',
      title: truncate(clar.question, 120),
      subtitle: clar.options?.length ? `${clar.options.length} option(s)` : undefined,
      timeSensitive: clar.timeSensitive === true,
    });
  }
  if (human) {
    out.push({
      key: `human-${human.id}`,
      kind: 'Human review',
      title: `Node ${human.nodeId}`,
      subtitle: truncate(human.instructions, 160),
      timeSensitive: human.timeSensitive === true,
    });
  }
  return out;
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function MonitoringSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-violet-200/50 dark:border-violet-800/50 bg-white/60 dark:bg-slate-800/50 p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>;
}
