import { useLocation } from 'react-router-dom';
import { useKanbanStore } from '@/store';
import { DELEGATION_SHELL_BREAKPOINT_PX } from '@/delegation/hubConstants';
import { isFocusClassRoute } from '@/lib/delegationShellRules';
import { useViewportNarrow } from '@/delegation/useViewportNarrow';

/**
 * §7: Focus-route + narrow viewport — host minimized delegation chrome (strip + expandable drawer).
 * `delegationChromeHostActive` stays true while drawer is open so the overlay subtree stays mounted.
 * Strip visibility is delegated to `DelegationShellChrome` (hidden while drawer open).
 *
 * Delegation Hub (`/`) is never focus-class — no chrome host here.
 */
export function useDelegationMinimizedChrome(): {
  delegationChromeHostActive: boolean;
} {
  const { pathname } = useLocation();
  const tasksLayout = useKanbanStore((s) => s.tasksWorkspaceLayout);
  const narrow = useViewportNarrow(DELEGATION_SHELL_BREAKPOINT_PX);
  const focus = isFocusClassRoute(pathname, tasksLayout);

  return { delegationChromeHostActive: narrow && focus };
}
