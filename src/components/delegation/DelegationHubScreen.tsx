import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { OtonomeChat } from '@/components/OtonomeChat';
import { DelegationMonitoringColumn } from '@/components/delegation/DelegationMonitoringColumn';

type DelegationHubScreenProps = {
  sidebarCollapsed: boolean;
};

/**
 * Canonical logged-in home (§5–6): Hermes narrative column + persistent monitoring context.
 */
export function DelegationHubScreen({ sidebarCollapsed }: DelegationHubScreenProps) {
  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed}>
        <div className="mx-auto flex h-[calc(100vh-73px)] max-w-[1920px] min-h-0 flex-col gap-0 lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">
            <div className="mb-2 px-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Delegate</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Describe what you need in plain language — Hermes routes to a standard procedure or handles it directly.
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <OtonomeChat />
            </div>
          </div>
          <div className="min-h-0 shrink-0 overflow-y-auto px-3 pb-3 sm:px-4 lg:w-auto lg:max-w-md lg:pb-4 lg:pr-4">
            <DelegationMonitoringColumn />
          </div>
        </div>
      </AuthenticatedWorkspaceFrame>
    </div>
  );
}
