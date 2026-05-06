import React, { useState, useEffect } from 'react';
import { X, Calendar, Trash2 } from 'lucide-react';
import { Task } from '../types';
import { AgentProfile } from '../config/agentProfiles';
import { useKanbanStore } from '../store';

interface TaskEditModalProps {
  task: Task;
  onClose: () => void;
  onSave: (updatedTask: Task) => void;
  agents: AgentProfile[];
}

export const TaskEditModal: React.FC<TaskEditModalProps> = ({ task, onClose, onSave, agents }) => {
  const updateTask = useKanbanStore((state) => state.updateTask);
  const deleteTask = useKanbanStore((state) => state.deleteTask);
  const agentSops = useKanbanStore((state) => state.agentSops);
  const [editedTask, setEditedTask] = useState<Task>(task);
  const [assignmentMode, setAssignmentMode] = useState<'agent' | 'sop' | 'none'>(() => {
    if (task.sopId) return 'sop';
    if (task.assignedAgents?.length) return 'agent';
    return 'none';
  });

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editedTask.title.trim() === '') return;
    updateTask(editedTask);
    onSave(editedTask);
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteTask(task.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {task.id ? 'Edit Task' : 'Create Task'}
            </h2>
            <div className="flex items-center gap-2">
              {task.id && (
                <button
                  onClick={handleDelete}
                  className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title
              </label>
              <input
                type="text"
                id="title"
                value={editedTask.title}
                onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                  focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                  bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                value={editedTask.description}
                onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                  focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                  bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assignment</label>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-slate-800/40 p-3 space-y-3">
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="assignmentMode"
                      checked={assignmentMode === 'none'}
                      onChange={() => {
                        setAssignmentMode('none');
                        setEditedTask({ ...editedTask, assignedAgents: [], sopId: undefined });
                      }}
                    />
                    None
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="assignmentMode"
                      checked={assignmentMode === 'agent'}
                      onChange={() => {
                        setAssignmentMode('agent');
                        setEditedTask({ ...editedTask, sopId: undefined });
                      }}
                    />
                    Assign agent
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="radio"
                      name="assignmentMode"
                      checked={assignmentMode === 'sop'}
                      onChange={() => {
                        setAssignmentMode('sop');
                        setEditedTask({ ...editedTask, assignedAgents: [], suggestedAgent: undefined });
                      }}
                    />
                    Assign SOP
                  </label>
                </div>

                {assignmentMode === 'agent' ? (
                  <div className="space-y-1">
                    <label htmlFor="agentSelect" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Choose agent
                    </label>
                    <select
                      id="agentSelect"
                      value={editedTask.assignedAgents?.[0] ?? ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditedTask({ ...editedTask, assignedAgents: id ? [id] : [] });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                        focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                        bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Selecting an agent will execute the task via the agent flow (when moved to In Progress).
                    </p>
                  </div>
                ) : null}

                {assignmentMode === 'sop' ? (
                  <div className="space-y-1">
                    <label htmlFor="sopSelect" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Choose SOP
                    </label>
                    <select
                      id="sopSelect"
                      value={editedTask.sopId ?? ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        setEditedTask({ ...editedTask, sopId: id || undefined });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                        focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                        bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Unassigned</option>
                      {agentSops.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Selecting an SOP will run that workflow automatically when the task moves to To Do.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Priority
                </label>
                <select
                  id="priority"
                  value={editedTask.priority}
                  onChange={(e) =>
                    setEditedTask({
                      ...editedTask,
                      priority: e.target.value as Task['priority']
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                    focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                    bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div>
                <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Due Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    id="dueDate"
                    value={editedTask.dueDate}
                    onChange={(e) => setEditedTask({ ...editedTask, dueDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                      focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                      bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                  />
                  <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={18} />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 
                  hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 
                  dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={editedTask.title.trim() === ''}
              >
                {task.id ? 'Save Changes' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};