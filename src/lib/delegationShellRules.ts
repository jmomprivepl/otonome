export const DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX = 1280;

export type TasksWorkspaceLayout = 'board' | 'list';

const AGENT_SOP_EDIT_PREFIX = /^\/agent-sop\/edit\//u;

export function isFocusClassRoute(
  pathname: string,
  tasksLayout: TasksWorkspaceLayout,
): boolean {
  if (pathname.startsWith('/playground')) {
    return true;
  }
  if (AGENT_SOP_EDIT_PREFIX.test(pathname)) {
    return true;
  }
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) {
    return tasksLayout === 'board';
  }
  return false;
}

export function shouldMinimizeDelegationShell(
  pathname: string,
  tasksLayout: TasksWorkspaceLayout,
  viewportWidth: number | null,
  userExpandedOverride: boolean,
): boolean {
  if (userExpandedOverride === true) {
    return false;
  }
  if (viewportWidth == null) {
    return false;
  }
  if (viewportWidth > DELEGATION_SHELL_MINIMIZE_MAX_WIDTH_PX) {
    return false;
  }
  return isFocusClassRoute(pathname, tasksLayout);
}
