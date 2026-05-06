import type { ReactNode } from 'react';
import { Header } from '@/components/Header';

type AuthenticatedWorkspaceFrameProps = {
  sidebarCollapsed: boolean;
  /** @default true */
  showAgents?: boolean;
  children: ReactNode;
};

/** Fixed `Header` + sidebar offset (`pt-[73px]`, `pl-16`|`pl-64`) for logged-in workspace routes — single place to tweak (§Task 8). */
export function AuthenticatedWorkspaceFrame({
  sidebarCollapsed,
  showAgents = true,
  children,
}: AuthenticatedWorkspaceFrameProps) {
  return (
    <>
      <Header sidebarCollapsed={sidebarCollapsed} showAgents={showAgents} />
      <div
        className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}
      >
        {children}
      </div>
    </>
  );
}
