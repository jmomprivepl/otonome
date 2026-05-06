import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { useKanbanStore } from '@/store';

interface AgentSopListScreenProps {
  sidebarCollapsed: boolean;
}

export function AgentSopListScreen({ sidebarCollapsed }: AgentSopListScreenProps) {
  const navigate = useNavigate();
  const agentSops = useKanbanStore((s) => s.agentSops);
  const createAgentSop = useKanbanStore((s) => s.createAgentSop);
  const renameAgentSop = useKanbanStore((s) => s.renameAgentSop);
  const deleteAgentSop = useKanbanStore((s) => s.deleteAgentSop);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const sorted = useMemo(
    () => [...agentSops].sort((a, b) => b.updatedAt - a.updatedAt),
    [agentSops],
  );

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameDraft(name);
  };

  const commitRename = () => {
    if (renamingId) {
      renameAgentSop(renamingId, renameDraft);
      setRenamingId(null);
    }
  };

  const handleNewSop = () => {
    const name = window.prompt('Name for the new SOP', 'New SOP');
    if (name === null) return;
    const rec = createAgentSop(name);
    navigate(`/playground?sop=${encodeURIComponent(rec.id)}`);
  };

  return (
    <div className="min-h-screen">
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed} showAgents={false}>
        <main className="flex flex-col gap-6 px-4 pb-12 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <GitBranch className="h-5 w-5 text-violet-600" />
              Agent SOP
            </h1>
            <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
              Each SOP is a saved workflow graph. Click a name, &quot;Open in Playground&quot;, or &quot;New SOP&quot;
              to work in the sandbox (empty canvas for new SOPs). Use &quot;Open in graph editor&quot; on Playground for
              the full editor screen.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewSop}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            New SOP
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-violet-200/50 bg-white/60 shadow-sm dark:border-blue-800/50 dark:bg-slate-900/40">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center text-gray-500 dark:text-gray-400">
              <Workflow className="h-10 w-10 opacity-50" />
              <p className="text-sm">No SOPs yet. Create one with &quot;New SOP&quot;.</p>
            </div>
          ) : (
            <ul className="divide-y divide-violet-100 dark:divide-blue-900/50">
              {sorted.map((sop) => (
                <li
                  key={sop.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-violet-50/60 dark:hover:bg-blue-950/40"
                >
                  <div className="min-w-0 flex-1">
                    {renamingId === sop.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="w-full max-w-md rounded-md border border-violet-300 bg-white px-2 py-1 text-sm dark:border-blue-700 dark:bg-slate-800"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate(`/playground?sop=${encodeURIComponent(sop.id)}`)}
                        className="text-left text-sm font-medium text-gray-900 hover:text-violet-700 dark:text-white dark:hover:text-violet-300"
                      >
                        {sop.name}
                      </button>
                    )}
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {sop.nodes.length} step{sop.nodes.length === 1 ? '' : 's'} ·{' '}
                      {sop.edges.length} link{sop.edges.length === 1 ? '' : 's'} · updated{' '}
                      {new Date(sop.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startRename(sop.id, sop.name)}
                      className="rounded-md p-2 text-gray-500 hover:bg-violet-100 hover:text-violet-800 dark:hover:bg-blue-900/50 dark:hover:text-violet-200"
                      title="Rename"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/playground?sop=${encodeURIComponent(sop.id)}`)}
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950/50"
                    >
                      Open in Playground
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete “${sop.name}”? This cannot be undone.`)) {
                          deleteAgentSop(sop.id);
                        }
                      }}
                      className="rounded-md p-2 text-gray-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        </main>
      </AuthenticatedWorkspaceFrame>
    </div>
  );
}
