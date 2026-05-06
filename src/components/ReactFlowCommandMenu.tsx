import type { ReactNode } from 'react';
import {
  Expand,
  Group,
  Lock,
  MessageSquare,
  Trash2,
  Ungroup,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useReactFlow, type FitViewOptions } from 'reactflow';

export type ReactFlowCommandMenuProps = {
  onAddNode: () => void;
  onDeleteSelected: () => void;
  selectedCount: number;
  /** When false, group/ungroup controls are hidden (e.g. Agent SOP graph). Default true. */
  enableGrouping?: boolean;
  onGroupNodes?: () => void;
  onUngroupNodes?: () => void;
  canGroup?: boolean;
  canUngroup?: boolean;
  /** Passed to `fitView()` for the toolbar button. */
  fitViewOptions?: FitViewOptions;
  /** When both are set, shows lock/unlock (disables drag, connect, select on the canvas). */
  interactive?: boolean;
  onToggleInteractive?: () => void;
  /** Appended after the trash button (e.g. Sync + Run DAG). */
  trailing?: ReactNode;
};

/**
 * Bottom toolbar for React Flow. Use under `ReactFlowProvider` (e.g. a sibling overlay above the
 * canvas with `pointer-events-none` on the wrapper and `pointer-events-auto` on this bar). Avoid
 * putting it in `<Panel>`: RF sets `pointer-events: none` on panels while selecting/panning, which
 * drops clicks before they reach the buttons.
 */
export function ReactFlowCommandMenu({
  onAddNode,
  onDeleteSelected,
  selectedCount,
  enableGrouping = true,
  onGroupNodes,
  onUngroupNodes,
  canGroup = false,
  canUngroup = false,
  fitViewOptions,
  interactive,
  onToggleInteractive,
  trailing,
}: ReactFlowCommandMenuProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const showInteractivityToggle =
    typeof interactive === 'boolean' && typeof onToggleInteractive === 'function';

  return (
    <div className="pointer-events-auto">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200/80 bg-white/95 p-2 shadow-md backdrop-blur-sm dark:border-slate-600 dark:bg-slate-800/95">
        <button
          type="button"
          onClick={() => onAddNode()}
          className="rounded-md p-2 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950/50"
          title="Add node"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
        {enableGrouping ? (
          <>
            <div className="h-6 w-px bg-gray-200 dark:bg-slate-600" />
            <button
              type="button"
              onClick={onGroupNodes}
              disabled={!canGroup}
              className="rounded-md p-2 text-violet-600 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-violet-400 dark:hover:bg-violet-950/50"
              title="Group nodes"
            >
              <Group className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onUngroupNodes}
              disabled={!canUngroup}
              className="rounded-md p-2 text-violet-600 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-violet-400 dark:hover:bg-violet-950/50"
              title="Ungroup nodes"
            >
              <Ungroup className="h-5 w-5" />
            </button>
          </>
        ) : null}
        <div className="h-6 w-px bg-gray-200 dark:bg-slate-600" />
        <button
          type="button"
          onClick={() => fitView(fitViewOptions)}
          className="rounded-md p-2 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950/50"
          title="Fit view"
        >
          <Expand className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => zoomIn()}
          className="rounded-md p-2 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950/50"
          title="Zoom in"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => zoomOut()}
          className="rounded-md p-2 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950/50"
          title="Zoom out"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        {showInteractivityToggle ? (
          <>
            <div className="h-6 w-px bg-gray-200 dark:bg-slate-600" />
            <button
              type="button"
              onClick={() => onToggleInteractive()}
              className="rounded-md p-2 text-violet-600 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-950/50"
              title={interactive ? 'Lock canvas (disable drag & select)' : 'Unlock canvas'}
            >
              {interactive ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </button>
          </>
        ) : null}
        <div className="h-6 w-px bg-gray-200 dark:bg-slate-600" />
        <button
          type="button"
          onClick={onDeleteSelected}
          disabled={selectedCount === 0}
          className="rounded-md p-2 text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-red-400 dark:hover:bg-red-950/40"
          title="Delete selected"
        >
          <Trash2 className="h-5 w-5" />
        </button>
        {trailing ? (
          <>
            <div className="h-6 w-px bg-gray-200 dark:bg-slate-600" />
            {trailing}
          </>
        ) : null}
      </div>
    </div>
  );
}
