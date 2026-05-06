/**
 * Sidebar active-state helper: `/` and `/agent-sop/*` need special handling.
 */
export function isSidebarNavActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  if (itemPath === '/agent-sop') return pathname === '/agent-sop' || pathname.startsWith('/agent-sop/');
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
