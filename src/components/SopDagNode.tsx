import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from 'reactflow';
import type {
  AgentDagNode as AgentDagNodeType,
  DagNodeKind,
  ExecutionTarget,
  RaciLayer,
} from '@/types/agentDag';
import { useSopDagUpdate } from '@/components/sopDagUpdateContext';
import { SopDagNodeFieldContextMenu } from '@/components/SopDagNodeFieldContextMenu';
import { focusFieldForEditing } from '@/components/sopDagNodeFieldFocus';

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

export const SopDagNode = memo(function SopDagNode({ id, data }: NodeProps<AgentDagNodeType>) {
  const updateAgentDagNode = useSopDagUpdate();
  const kind: DagNodeKind = data.nodeKind ?? 'agent';
  const isHuman = kind === 'human';

  const labelRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const nodeKindRef = useRef<HTMLSelectElement>(null);
  const executionTargetRef = useRef<HTMLSelectElement>(null);
  const raciLayerRef = useRef<HTMLSelectElement>(null);
  const hitlRef = useRef<HTMLInputElement>(null);
  const systemToolNameRef = useRef<HTMLInputElement>(null);
  const systemToolArgsRef = useRef<HTMLInputElement>(null);
  /** Resolves step title `<input>` even if ref lags RF reparenting — context menu edits use this path. */
  const dagRootRef = useRef<HTMLDivElement>(null);

  const [promptModalOpen, setPromptModalOpen] = useState(false);

  const focusStepTitle = useCallback(() => {
    const el =
      dagRootRef.current?.querySelector<HTMLInputElement>('[data-sop-node-field="label"]') ??
      labelRef.current;
    focusFieldForEditing(el);
  }, []);

  const openPromptModal = useCallback(() => {
    setPromptModalOpen(true);
  }, []);

  const savePromptFromModal = useCallback(
    (value: string) => {
      updateAgentDagNode(id, { prompt: value });
    },
    [id, updateAgentDagNode],
  );

  return (
    <div
      ref={dagRootRef}
      className={`sop-dag-root min-w-[220px] max-w-[280px] rounded-xl border border-gray-200 dark:border-gray-600 bg-white/90 dark:bg-slate-800/90 shadow-md border-l-4 transition-[box-shadow,border-color] duration-150 ${raciBorder[data.raciLayer]}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-violet-500 !w-4 !h-4 !border-2 !border-white/80 dark:!border-slate-900/60"
      />
      <div className="p-2 space-y-2">
        <div className="flex items-center justify-between gap-1">
          <SopDagNodeFieldContextMenu
            fieldLabel="RACI row"
            onRequestEdit={() => focusFieldForEditing(raciLayerRef.current)}
          >
            <span
              className="inline-block cursor-default text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200"
              title="RACI layer (right-click to edit row)"
            >
              {raciLabel[data.raciLayer]}
            </span>
          </SopDagNodeFieldContextMenu>
          <SopDagNodeFieldContextMenu
            fieldLabel="HITL tool"
            onRequestEdit={() => hitlRef.current?.focus()}
          >
            <label className="nodrag flex cursor-default items-center gap-1 text-[10px] text-gray-600 dark:text-gray-400">
              <input
                ref={hitlRef}
                type="checkbox"
                className="nodrag"
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
              htmlFor={`sop-step-title-${id}`}
              className="block cursor-default text-[10px] text-gray-500 dark:text-gray-400"
            >
              Step title
            </label>
            <input
              id={`sop-step-title-${id}`}
              ref={labelRef}
              data-sop-node-field="label"
              type="text"
              value={data.label}
              onChange={(e) => updateAgentDagNode(id, { label: e.target.value })}
              className="nodrag w-full text-sm font-semibold px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </SopDagNodeFieldContextMenu>
        <SopDagNodeFieldContextMenu
          fieldLabel="prompt"
          onRequestEdit={() => focusFieldForEditing(promptRef.current)}
          extraActions={[{ label: 'Open expanded editor…', onSelect: openPromptModal }]}
        >
          <textarea
            ref={promptRef}
            rows={3}
            value={data.prompt}
            onChange={(e) => updateAgentDagNode(id, { prompt: e.target.value })}
            className="nodrag w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-200 resize-y"
          />
        </SopDagNodeFieldContextMenu>
        <PromptExpandedModal
          open={promptModalOpen}
          initial={data.prompt}
          onClose={() => setPromptModalOpen(false)}
          onSave={savePromptFromModal}
        />
        <SopDagNodeFieldContextMenu
          fieldLabel="node kind"
          onRequestEdit={() => focusFieldForEditing(nodeKindRef.current)}
        >
          <div className="space-y-1">
            <label className="block cursor-default text-[10px] text-gray-500 dark:text-gray-400">
              Node kind
            </label>
            <select
              ref={nodeKindRef}
              value={kind}
              onChange={(e) => updateAgentDagNode(id, { nodeKind: e.target.value as DagNodeKind })}
              className="nodrag w-full text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700"
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
              <label className="block cursor-default text-[10px] text-gray-500 dark:text-gray-400">
                Run on
              </label>
              <select
                ref={executionTargetRef}
                value={data.executionTarget}
                disabled={isHuman}
                onChange={(e) =>
                  updateAgentDagNode(id, { executionTarget: e.target.value as ExecutionTarget })
                }
                className="nodrag w-full text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 disabled:opacity-50"
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
              <label className="block cursor-default text-[10px] text-gray-500 dark:text-gray-400">
                RACI row
              </label>
              <select
                ref={raciLayerRef}
                value={data.raciLayer}
                onChange={(e) => updateAgentDagNode(id, { raciLayer: e.target.value as RaciLayer })}
                className="nodrag w-full text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700"
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
                className="nodrag w-full text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 font-mono"
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
                className="nodrag w-full text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-slate-700 font-mono"
              />
            </SopDagNodeFieldContextMenu>
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
