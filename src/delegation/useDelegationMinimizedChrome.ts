import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useKanbanStore } from '@/store';
import { DELEGATION_SHELL_BREAKPOINT_PX } from '@/delegation/hubConstants';
import { isFocusClassRoute } from '@/lib/delegationShellRules';
import { useViewportNarrow } from '@/delegation/useViewportNarrow';

/**
 * §7: Minimized strip when **both** focus-class route and narrow viewport.
 * Delegation Hub (`/`) is never focus-class — full shell stays there.
 */
export function useDelegationMinimizedChrome(): { showMinimizedStrip: boolean } {
  const { pathname } = useLocation();
  const tasksLayout = useKanbanStore((s) => s.tasksWorkspaceLayout);
  const delegationShellForceExpanded = useKanbanStore((s) => s.delegationShellForceExpanded);
  const narrow = useViewportNarrow(DELEGATION_SHELL_BREAKPOINT_PX);
  const focus = isFocusClassRoute(pathname, tasksLayout);

  useEffect(() => {
    useKanbanStore.getState().setDelegationShellForceExpanded(false);
  }, [pathname]);

  return { showMinimizedStrip: narrow && focus && !delegationShellForceExpanded };
}
