import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from 'reactflow';
import { ChevronRight, Layers, Sparkles } from 'lucide-react';
import type { DagNodeKind, ExecutionTarget, RaciLayer } from '@/types/agentDag';
import type { PlaygroundDagNode } from '@/types/playgroundWorkflow';
import { useSopDagUpdate } from '@/components/sopDagUpdateContext';
import { SopDagNodeFieldContextMenu } from '@/components/SopDagNodeFieldContextMenu';
import { focusFieldForEditing } from '@/components/sopDagNodeFieldFocus';
import { usePlaygroundDrill } from '@/contexts/playgroundWorkflowContext';

const raciBorder: Record<RaciLayer, string> = {
  responsible: 'border-l-blue-500',
  accountable: 'border-l-violet-500',
  consulted: 'border-l-amber-500',
  informed: 'border-l-emerald-500',
};

const raciLabel: Record<RaciLayer, string> = {
  responsible: 'R',
  accountable: 'A',
  consulted: 'C',
  informed: 'I',
};

function PromptExpandedModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(taRef.current.value.length, taRef.current.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit prompt"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-slate-600 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit prompt</h2>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          className="min-h-[200px] w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const CustomTaskNode = memo(function CustomTaskNode({ id, data }: NodeProps<PlaygroundDagNode>) {
  const updateAgentDagNode = useSopDagUpdate();
  const drillApi = usePlaygroundDrill();
  const kind: DagNodeKind = data.nodeKind ?? 'agent';
  const isHuman = kind === 'human';
  const subCount = data.subGraph?.nodes.length ?? 0;
  const hasSubWorkflow = subCount > 0;

  const labelRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const nodeKindRef = useRef<HTMLSelectElement>(null);
  const executionTargetRef = useRef<HTMLSelectElement>(null);
  const raciLayerRef = useRef<HTMLSelectElement>(null);
  const hitlRef = useRef<HTMLInputElement>(null);
  const systemToolNameRef = useRef<HTMLInputElement>(null);
  const systemToolArgsRef = useRef<HTMLInputElement>(null);
  const dagRootRef = useRef<HTMLDivElement>(null);

  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [creatingSubworkflow, setCreatingSubworkflow] = useState(false);

  const focusStepTitle = useCallback(() => {
    const el =
      dagRootRef.current?.querySelector<HTMLInputElement>('[data-sop-node-field="label"]') ??
      labelRef.current;
    focusFieldForEditing(el);
  }, []);

  const onDrillDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!hasSubWorkflow || !drillApi) return;
      drillApi.drillInto(id);
    },
    [drillApi, hasSubWorkflow, id],
  );

  const onCreateSubworkflow = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!drillApi?.createSubworkflowFromAgent || hasSubWorkflow || creatingSubworkflow) return;
      void (async () => {
        setCreatingSubworkflow(true);
        try {
          await drillApi.createSubworkflowFromAgent(id);
        } finally {
          setCreatingSubworkflow(false);
        }
      })();
    },
    [drillApi, hasSubWorkflow, creatingSubworkflow, id],
  );

  return (
    <div
      ref={dagRootRef}
      className={`custom-task-node sop-dag-root min-w-[240px] max-w-[300px] rounded-xl border border-gray-200 dark:border-gray-600 bg-white/95 dark:bg-slate-800/95 shadow-md border-l-4 transition-[box-shadow,border-color] duration-150 ${raciBorder[data.raciLayer]}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-violet-500 !w-4 !h-4 !border-2 !border-white/80 dark:!border-slate-900/60"
      />
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SopDagNodeFieldContextMenu
            fieldLabel="RACI row"
            onRequestEdit={() => focusFieldForEditing(raciLayerRef.current)}
          >
            <span
              className="inline-flex min-h-7 items-center cursor-default text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200"
              title="RACI layer"
            >
              {raciLabel[data.raciLayer]}
            </span>
          </SopDagNodeFieldContextMenu>
          <SopDagNodeFieldContextMenu
            fieldLabel="HITL tool"
            onRequestEdit={() => hitlRef.current?.focus()}
          >
            <label className="nodrag inline-flex min-h-7 cursor-default items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1 text-[11px] text-gray-700 dark:bg-slate-700/60 dark:text-gray-200">
              <input
                ref={hitlRef}
                type="checkbox"
                className="nodrag h-4 w-4"
                checked={data.requiresSystemTool}
                onChange={(e) => updateAgentDagNode(id, { requiresSystemTool: e.target.checked })}
              />
              HITL tool
            </label>
          </SopDagNodeFieldContextMenu>
        </div>
        <SopDagNodeFieldContextMenu fieldLabel="step title" onRequestEdit={focusStepTitle}>
          <div className="space-y-1">
            <label
              htmlFor={`task-title-${id}`}
              className="block cursor-default text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              Step title
            </label>
            <input
              id={`task-title-${id}`}
              ref={labelRef}
              data-sop-node-field="label"
              type="text"
              value={data.label}
              onChange={(e) => updateAgentDagNode(id, { label: e.target.value })}
              className="nodrag w-full text-sm font-semibold px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </SopDagNodeFieldContextMenu>
        <SopDagNodeFieldContextMenu
          fieldLabel="prompt"
          onRequestEdit={() => focusFieldForEditing(promptRef.current)}
          extraActions={[{ label: 'Open expanded editor…', onSelect: () => setPromptModalOpen(true) }]}
        >
          <textarea
            ref={promptRef}
            rows={3}
            value={data.prompt}
            onChange={(e) => updateAgentDagNode(id, { prompt: e.target.value })}
            className="nodrag w-full min-h-[78px] text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 resize-y"
          />
        </SopDagNodeFieldContextMenu>
        <PromptExpandedModal
          open={promptModalOpen}
          initial={data.prompt}
          onClose={() => setPromptModalOpen(false)}
          onSave={(value) => updateAgentDagNode(id, { prompt: value })}
        />
        <SopDagNodeFieldContextMenu
          fieldLabel="node kind"
          onRequestEdit={() => focusFieldForEditing(nodeKindRef.current)}
        >
          <div className="space-y-1">
            <label className="block cursor-default text-[11px] text-gray-500 dark:text-gray-400">
              Node kind
            </label>
            <select
              ref={nodeKindRef}
              value={kind}
              onChange={(e) => updateAgentDagNode(id, { nodeKind: e.target.value as DagNodeKind })}
              className="nodrag w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm dark:border-gray-600 bg-white dark:bg-slate-700"
            >
              <option value="agent">Agent (Hermes / local)</option>
              <option value="human">Human (pause workflow)</option>
            </select>
          </div>
        </SopDagNodeFieldContextMenu>
        <div className="grid grid-cols-2 gap-1">
          <SopDagNodeFieldContextMenu
            fieldLabel="run target"
            onRequestEdit={() => focusFieldForEditing(executionTargetRef.current)}
          >
            <div>
              <label className="block cursor-default text-[11px] text-gray-500 dark:text-gray-400">
                Run on
              </label>
              <select
                ref={executionTargetRef}
                value={data.executionTarget}
                disabled={isHuman}
                onChange={(e) =>
                  updateAgentDagNode(id, { executionTarget: e.target.value as ExecutionTarget })
                }
                className="nodrag w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm dark:border-gray-600 bg-white dark:bg-slate-700 disabled:opacity-50"
              >
                <option value="localQvac">Local (qvac)</option>
                <option value="cloudAnthropic">Cloud (Claude)</option>
              </select>
            </div>
          </SopDagNodeFieldContextMenu>
          <SopDagNodeFieldContextMenu
            fieldLabel="RACI row"
            onRequestEdit={() => focusFieldForEditing(raciLayerRef.current)}
          >
            <div>
              <label className="block cursor-default text-[11px] text-gray-500 dark:text-gray-400">
                RACI row
              </label>
              <select
                ref={raciLayerRef}
                value={data.raciLayer}
                onChange={(e) => updateAgentDagNode(id, { raciLayer: e.target.value as RaciLayer })}
                className="nodrag w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm dark:border-gray-600 bg-white dark:bg-slate-700"
              >
                <option value="responsible">Responsible</option>
                <option value="accountable">Accountable</option>
                <option value="consulted">Consulted</option>
                <option value="informed">Informed</option>
              </select>
            </div>
          </SopDagNodeFieldContextMenu>
        </div>
        {data.requiresSystemTool ? (
          <div className="space-y-1">
            <SopDagNodeFieldContextMenu
              fieldLabel="tool name"
              onRequestEdit={() => focusFieldForEditing(systemToolNameRef.current)}
            >
              <input
                ref={systemToolNameRef}
                type="text"
                placeholder="tool name"
                value={data.systemToolName ?? ''}
                onChange={(e) => updateAgentDagNode(id, { systemToolName: e.target.value || null })}
                className="nodrag w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 font-mono"
              />
            </SopDagNodeFieldContextMenu>
            <SopDagNodeFieldContextMenu
              fieldLabel="tool args summary"
              onRequestEdit={() => focusFieldForEditing(systemToolArgsRef.current)}
            >
              <input
                ref={systemToolArgsRef}
                type="text"
                placeholder="args summary"
                value={data.systemToolArgsSummary ?? ''}
                onChange={(e) =>
                  updateAgentDagNode(id, { systemToolArgsSummary: e.target.value || null })
                }
                className="nodrag w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 font-mono"
              />
            </SopDagNodeFieldContextMenu>
          </div>
        ) : null}

        {!hasSubWorkflow && drillApi?.createSubworkflowFromAgent ? (
          <div className="nodrag border-t border-slate-200/90 pt-2 dark:border-slate-600/70">
            <button
              type="button"
              disabled={creatingSubworkflow}
              className="group flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300/90 bg-gradient-to-r from-slate-50 to-violet-50/60 px-2.5 py-2 text-left text-xs font-medium text-slate-800 shadow-sm transition hover:border-violet-400 hover:from-violet-50 hover:to-indigo-50/80 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600/80 dark:from-slate-800/80 dark:to-violet-950/30 dark:text-slate-100 dark:hover:border-violet-600"
              onMouseDown={onCreateSubworkflow}
              title="Ask Task Manager to split this step into a linear nested workflow"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white shadow-sm dark:bg-violet-500">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {creatingSubworkflow ? 'Creating sub-workflow…' : 'Create sub-workflow'}
                  </span>
                  <span className="block truncate text-[10px] font-normal text-slate-600 dark:text-slate-400">
                    Task Manager decomposition
                  </span>
                </span>
              </span>
            </button>
          </div>
        ) : null}
        {hasSubWorkflow && drillApi ? (
          <div className="nodrag border-t border-violet-200/80 pt-2 dark:border-violet-900/40">
            <button
              type="button"
              className="group flex w-full items-center justify-between gap-2 rounded-lg border border-violet-300/90 bg-gradient-to-r from-violet-50 to-indigo-50/80 px-2.5 py-2 text-left text-xs font-medium text-violet-900 shadow-sm transition hover:border-violet-500 hover:from-violet-100 hover:to-indigo-100 dark:border-violet-700/60 dark:from-violet-950/50 dark:to-indigo-950/40 dark:text-violet-100 dark:hover:border-violet-500"
              onMouseDown={onDrillDown}
              title="Open nested sub-workflow on the canvas"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-600 text-white shadow-sm dark:bg-violet-500">
                  <Layers className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">View sub-workflow</span>
                  <span className="block truncate text-[10px] font-normal text-violet-700/85 dark:text-violet-300/90">
                    {subCount} step{subCount === 1 ? '' : 's'} inside
                  </span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-violet-600 opacity-80 transition group-hover:translate-x-0.5 dark:text-violet-300" />
            </button>
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-violet-500 !w-4 !h-4 !border-2 !border-white/80 dark:!border-slate-900/60"
      />
    </div>
  );
});
