import { type ReactNode, useState, useRef, useCallback } from 'react';
import { TaskCard } from '@/components/TaskCard';
import { TaskEditModal } from '@/components/TaskEditModal';
import { TaskResultModal } from '@/components/TaskResultModal'
import { Header } from '@/components/Header';
import { TaskListView } from '@/components/TaskListView';
import { CheckCircle2, Clock, ListTodo, Plus, Columns, List } from 'lucide-react';
import { useKanbanStore } from '@/store';
import pyodideManager from '@/python/pyodideManager';
import { AgentProfile } from '@/config/agentProfiles';
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isTauriRuntime } from '@/config/nativeLlm';
import { handleUserRequest } from '@/hermes/handleUserRequest';
import { MockInferenceEngine } from '@/hermes/mockInferenceEngine';
import { runTauriWorkflowAndWait, toRustDagGraph } from '@/hermes/tauriWorkflowRun';
import { defaultLlamaSamplingPayload } from '@/llm/llamaSamplingDefaults';
import { getNativeLlmPaths } from '@/config/nativeLlm';

const COLUMN_ICONS = {
  draft: <ListTodo className="h-5 w-5 text-gray-500 dark:text-gray-400" />,
  todo: <ListTodo className="h-5 w-5 text-gray-500 dark:text-gray-400" />,
  inProgress: <Clock className="h-5 w-5 text-blue-500 dark:text-blue-400" />,
  done: <CheckCircle2 className="h-5 w-5 text-green-500 dark:text-green-400" />
} as const;

const COLUMN_TITLES = {
  draft: 'Draft',
  todo: 'To Do',
  inProgress: 'In Progress',
  done: 'Done'
} as const;

interface TasksScreenProps {
  sidebarCollapsed: boolean;
}

export function TasksScreen({ sidebarCollapsed }: TasksScreenProps) {
  const { tasks, editingTask, setEditingTask, selectedTask, setSelectedTask, updateTask, updateTasks, agents, activeProject, projects } =
    useKanbanStore();
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');

  const hermesInFlightRef = useRef<Set<string>>(new Set());
  const runHermesIfMovedToTodo = useCallback(
    (taskId: string, prevStatus: string | null, nextStatus: string | null) => {
      if (prevStatus === 'todo' || nextStatus !== 'todo') return;
      if (!isTauriRuntime()) return;
      if (hermesInFlightRef.current.has(taskId)) return;

      hermesInFlightRef.current.add(taskId);
      queueMicrotask(() => {
        void (async () => {
          try {
            const t = useKanbanStore.getState().tasks.find((x) => x.id === taskId);
            if (!t) return;

            useKanbanStore.getState().updateTask({
              ...t,
              result: {
                type: 'text',
                data: {
                  text: {
                    title: 'Hermes',
                    content: t.sopId ? 'Starting SOP workflow…' : 'Routing task to SOP/agent…',
                  },
                },
              },
            });

            // If the task is explicitly assigned a persisted SOP, prefer running that DAG directly.
            if (t.sopId) {
              const sop = useKanbanStore.getState().agentSops.find((s) => s.id === t.sopId);
              if (!sop) {
                throw new Error(`Task SOP not found: ${t.sopId}`);
              }

              const needsLocal = sop.nodes.some((n) => (n.nodeKind ?? 'agent') === 'agent' && n.executionTarget === 'localQvac');
              const llamaOptions = needsLocal
                ? {
                    exePath: getNativeLlmPaths().exePath,
                    modelPath: getNativeLlmPaths().modelPath,
                    ctxSize: 4096,
                    ...defaultLlamaSamplingPayload(),
                    initialPrompt: 'System: placeholder\nUser: hi\nAssistant: ',
                    maxNewTokens: 1024,
                  }
                : null;

              const prompt = `${t.title ?? ''}\n\n${t.description ?? ''}`.trim();
              const finish = await runTauriWorkflowAndWait({
                graph: toRustDagGraph(sop.nodes, sop.edges),
                llamaOptions,
                anthropicModel: null,
                userRequest: prompt,
                sopId: sop.id,
                taskId: t.id,
                hermesModel: null,
                hermesMaxTurns: null,
              });

              const wf = finish.workflow;
              const lines = wf
                ? Object.entries(wf.nodeOutputs ?? {})
                    .map(([k, v]) => `**${k}**\n${v}`)
                    .join('\n\n')
                : '';
              const finalText = finish.ok
                ? `DAG workflow complete: ${sop.name}\n\n${lines}`.trim()
                : `DAG workflow failed: ${finish.error ?? 'unknown error'}\n\n${lines}`.trim();

              const latest = useKanbanStore.getState().tasks.find((x) => x.id === taskId);
              if (!latest) return;
              useKanbanStore.getState().updateTask({
                ...latest,
                result: {
                  type: 'text',
                  data: {
                    text: {
                      title: 'SOP result',
                      content: finalText,
                    },
                  },
                },
              });
              return;
            }

            // Otherwise use Hermes routing (SOP registry / sub-agent / direct).
            // In Tauri SOP mode, Hermes will invoke the Rust DAG runner; the engine is only used for
            // non-SOP routes, so a lightweight mock is sufficient here.
            const engine = new MockInferenceEngine(140);
            const prompt = `${t.title ?? ''}\n\n${t.description ?? ''}`.trim();

            const orc = await handleUserRequest({ userPrompt: prompt, taskId: t.id }, {
              engine,
              onProgress: () => {
                /* Tasks UI currently doesn't render Hermes progress; result updates are enough. */
              },
              getPersistedWorkflowSops: () => useKanbanStore.getState().agentSops,
            });

            const latest = useKanbanStore.getState().tasks.find((x) => x.id === taskId);
            if (!latest) return;
            useKanbanStore.getState().updateTask({
              ...latest,
              result: {
                type: 'text',
                data: {
                  text: {
                    title: 'Hermes result',
                    content: orc.finalText,
                  },
                },
              },
            });
          } catch (e) {
            const latest = useKanbanStore.getState().tasks.find((x) => x.id === taskId);
            if (latest) {
              useKanbanStore.getState().updateTask({
                ...latest,
                result: {
                  type: 'text',
                  data: {
                    text: {
                      title: 'Hermes error',
                      content: String(e),
                    },
                  },
                },
              });
            }
          } finally {
            hermesInFlightRef.current.delete(taskId);
          }
        })();
      });
    },
    [],
  );

  // Function to execute Python code on demand
  const executePythonCode = (code: string, taskId?: string) => {
    if (!code || !taskId) return;
    
    console.log('Executing Python code on demand:', code);
    
    // Get the current task
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    // Initialize with executing status
    const executingTask = {
      ...task,
      result: {
        type: 'python' as const,
        data: {
          python: {
            code: code,
            output: 'Executing Python code...', // Initial status message
            fullResponse: task.result?.data.python?.fullResponse
          }
        }
      }
    };
    
    // Update the task immediately to show executing status
    updateTask(executingTask);
    
    // Generate a unique node ID for this task
    const pythonNodeId = `python-${taskId}-${Date.now()}`;
    
    // Register a callback to handle Python execution results
    pyodideManager.registerNode((data) => {
      console.log('Python callback received:', data);
      
      // Get the latest task state from the store
      const currentTask = useKanbanStore.getState().tasks.find(t => t.id === taskId);
      if (!currentTask) return;
      
      // Get current output, initialize if needed
      let currentOutput = currentTask.result?.data.python?.output || '';
      if (currentOutput === 'Executing Python code...') {
        currentOutput = '';
      }
      
      // Determine what to append based on the message type
      let newOutput = currentOutput;
      let shouldUpdate = false;
      
      // Handle stdout/stderr incremental updates
      if (data.type === 'stdout' || data.type === 'stderr') {
        if (data.output) {
          newOutput += data.output;
          shouldUpdate = true;
        }
      }
      
      // Handle final success result
      if (data.status === 'success') {
        if (data.stdout && !newOutput.includes(data.stdout)) {
          newOutput += data.stdout;
        }
        if (data.stderr) {
          newOutput += `

Errors:
${data.stderr}`;
        }
        if (data.error) {
          newOutput += `

Error: ${data.error}`;
        }
        shouldUpdate = true;
      }
      
      // Handle error result
      if (data.status === 'error') {
        newOutput += `

Error: ${data.error || 'Unknown error'}`;
        shouldUpdate = true;
      }
      
      // Only update if we have new content
      if (shouldUpdate) {
        // Create updated task with the new output
        const updatedTask = {
          ...currentTask,
          result: {
            type: 'python' as const,
            data: {
              python: {
                code: code,
                output: newOutput,
                fullResponse: currentTask.result?.data.python?.fullResponse
              }
            }
          }
        };
        
        // Update the task in the store
        console.log('Updating task with Python results:', newOutput);
        useKanbanStore.getState().updateTask(updatedTask);
        
        // Force re-render if this is the selected task
        if (selectedTask && selectedTask.id === taskId) {
          const freshTask = useKanbanStore.getState().tasks.find(t => t.id === taskId);
          if (freshTask) {
            setSelectedTask({...freshTask});
          }
        }
      }
      
      // Unregister the node after receiving the final result
      if (data.status === 'success' || data.status === 'error') {
        console.log('Execution complete, unregistering node');
        pyodideManager.unregisterNode(pythonNodeId);
      }
    }, pythonNodeId);
    
    // Execute the Python code
    pyodideManager.executePython(code, pythonNodeId, { taskId })
      .catch(err => {
        console.error('Error executing Python code:', err);
        
        // Get the latest task from the store
        const currentTask = useKanbanStore.getState().tasks.find(t => t.id === taskId);
        if (!currentTask) return;
        
        // Create task with error message
        const errorTask = {
          ...currentTask,
          result: {
            type: 'python' as const, // Use const assertion for type safety
            data: {
              python: {
                code: code,
                output: `Error executing Python code: ${err.message || err}`,
                fullResponse: currentTask.result?.data.python?.fullResponse
              }
            }
          }
        };
        
        // Update the task in the store
        useKanbanStore.getState().updateTask(errorTask);
        
        // Force re-render if this is the selected task
        if (selectedTask && selectedTask.id === taskId) {
          setSelectedTask(null);
          setTimeout(() => {
            // Get the most up-to-date version of the task
            const freshTask = useKanbanStore.getState().tasks.find(t => t.id === taskId);
            if (freshTask) {
              setSelectedTask(freshTask);
            }
          }, 10);
        }
        
        // Unregister the node
        pyodideManager.unregisterNode(pythonNodeId);
      });
  };

  // Function to suggest the most suitable agent for a task based on task content
  const suggestAgentForTask = (task: any): AgentProfile | null => {
    if (!agents.length) return null;
    if (task.assignedAgents.length > 0) return null;

    // Simple scoring system for agents based on task content
    const scores = agents.map(agent => {
      let score = 0;
      const taskContent = `${task.title} ${task.description}`.toLowerCase();
      
      // Check agent capabilities against task content
      if (agent.capabilities) {
        agent.capabilities.forEach(capability => {
          if (taskContent.includes(capability.toLowerCase())) {
            score += 2;
          }
        });
      }

      // Prefer agents with fewer assigned tasks
      const agentTaskCount = tasks.filter(t => 
        t.assignedAgents.includes(agent.id)
      ).length;
      score -= agentTaskCount * 0.5;

      return { agent, score };
    });

    // Get the agent with the highest score
    const bestMatch = scores.reduce((best, current) => 
      current.score > best.score ? current : best
    );

    return bestMatch.score > 0 ? bestMatch.agent : null;
  };
  const [draggedOverId, setDraggedOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'top' | 'bottom' | null>(null);
  const dragImageRef = useRef<HTMLElement | null>(null);

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    taskId: string,
    _sourceStatus: string
  ) => {
    e.dataTransfer.setData('text/plain', taskId);
    // WebView2 sometimes only round-trips the legacy "text" type.
    e.dataTransfer.setData('text', taskId);
    e.dataTransfer.effectAllowed = 'move';

    const card = e.currentTarget;
    try {
      const clone = card.cloneNode(true) as HTMLElement;
      clone.style.width = `${card.offsetWidth}px`;
      clone.style.position = 'absolute';
      clone.style.top = '-9999px';
      clone.style.left = '-9999px';
      clone.style.opacity = '1';
      clone.style.transform = 'none';
      clone.style.pointerEvents = 'none';
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, 0, 0);
      dragImageRef.current = clone;
    } catch {
      // Some hosts (embedded WebViews) reject custom drag images; native ghost is fine.
      dragImageRef.current = null;
    }
  };

  const handleDragEnd = () => {
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
    setDraggedOverId(null);
    setDragPosition(null);
  };

  const handleTaskDragEnter = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseY = e.clientY;
    const threshold = rect.top + rect.height / 2;
    setDraggedOverId(taskId);
    setDragPosition(mouseY < threshold ? 'top' : 'bottom');
  };

  const handleTaskDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).closest('.task-card')) {
      setDraggedOverId(null);
      setDragPosition(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = useCallback((
    e: React.DragEvent<HTMLDivElement>,
    targetStatus: 'draft' | 'todo' | 'inProgress' | 'done'
  ) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
    if (!taskId) return;

    const allTasks = [...useKanbanStore.getState().tasks];
    const draggedTaskIndex = allTasks.findIndex(t => t.id === taskId);
    if (draggedTaskIndex === -1) return;

    const draggedTask = allTasks[draggedTaskIndex];
    const oldStatus = draggedTask.status;
    allTasks.splice(draggedTaskIndex, 1);

    // Create the updated task with new status
    const updatedTask = { ...draggedTask, status: targetStatus };
    
    if (draggedOverId) {
      const dropIndex = allTasks.findIndex(t => t.id === draggedOverId);
      const insertAt = dropIndex !== -1 
        ? (dragPosition === 'bottom' ? dropIndex + 1 : dropIndex)
        : draggedTaskIndex;
      allTasks.splice(insertAt, 0, updatedTask);
    } else {
      allTasks.push(updatedTask);
    }

    updateTasks(allTasks);
    runHermesIfMovedToTodo(updatedTask.id, oldStatus, targetStatus);

    const agentsSnapshot = useKanbanStore.getState().agents;
    const tasksSnapshot = useKanbanStore.getState().tasks;
    const suggest = (task: (typeof updatedTask)) => {
      if (!agentsSnapshot.length || task.assignedAgents.length > 0) return null;
      const scores = agentsSnapshot.map((agent) => {
        let score = 0;
        const taskContent = `${task.title} ${task.description}`.toLowerCase();
        agent.capabilities?.forEach((capability) => {
          if (taskContent.includes(capability.toLowerCase())) score += 2;
        });
        const agentTaskCount = tasksSnapshot.filter((t) => t.assignedAgents.includes(agent.id)).length;
        score -= agentTaskCount * 0.5;
        return { agent, score };
      });
      const bestMatch = scores.reduce((best, current) => (current.score > best.score ? current : best));
      return bestMatch.score > 0 ? bestMatch.agent : null;
    };

    if (targetStatus === 'todo' && oldStatus !== 'todo') {
      const suggestedAgent = suggest(updatedTask);
      if (suggestedAgent) {
        updateTask({ ...updatedTask, suggestedAgent: suggestedAgent.id });
      }
    }

    setDraggedOverId(null);
    setDragPosition(null);
  }, [updateTasks, updateTask, draggedOverId, dragPosition]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const onDndEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over?.id ? String(event.over.id) : '';
      if (!overId || activeId === overId) return;

      const dragged = useKanbanStore.getState().tasks.find((t) => t.id === activeId);
      if (!dragged) return;

      const storeTasks = [...useKanbanStore.getState().tasks];

      const activeProjectName = useKanbanStore.getState().activeProject?.name ?? null;
      const sameProject = (t: any) => (activeProjectName ? t.project === activeProjectName : true);

      // Determine target status from drop target.
      let targetStatus: 'draft' | 'todo' | 'inProgress' | 'done' | null = null;
      let overTaskId: string | null = null;
      if (overId.startsWith('col:')) {
        targetStatus = overId.slice('col:'.length) as any;
      } else {
        overTaskId = overId;
        const overTask = storeTasks.find((t) => t.id === overTaskId);
        targetStatus = (overTask?.status ?? null) as any;
      }
      if (!targetStatus) return;

      const activeIdx = storeTasks.findIndex((t) => t.id === activeId);
      if (activeIdx === -1) return;

      const moved = { ...storeTasks[activeIdx], status: targetStatus };
      storeTasks.splice(activeIdx, 1);

      // Compute insertion index.
      let insertAt = storeTasks.length;
      if (overTaskId) {
        const overIdx = storeTasks.findIndex((t) => t.id === overTaskId);
        if (overIdx !== -1) {
          // Insert BEFORE the hovered task to match typical Kanban behavior.
          insertAt = overIdx;
        }
      } else {
        // Dropped on column: insert at end of that column within the active project.
        for (let i = storeTasks.length - 1; i >= 0; i--) {
          const t = storeTasks[i] as any;
          if (!t.archived && sameProject(t) && t.status === targetStatus) {
            insertAt = i + 1;
            break;
          }
        }
      }

      storeTasks.splice(insertAt, 0, moved);
      updateTasks(storeTasks);
      runHermesIfMovedToTodo(moved.id, dragged.status, moved.status);
    },
    [updateTasks, runHermesIfMovedToTodo],
  );

  function DroppableColumn(props: {
    id: string;
    children: ReactNode;
    className: string;
  }) {
    const { setNodeRef, isOver } = useDroppable({ id: props.id });
    return (
      <div
        ref={setNodeRef}
        className={`${props.className} ${isOver ? 'ring-2 ring-violet-400/40 dark:ring-blue-500/40' : ''}`}
      >
        {props.children}
      </div>
    );
  }

  function SortableTaskCard(props: { task: any; status: 'draft' | 'todo' | 'inProgress' | 'done' }) {
    const { task, status } = props;
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.6 : 1,
    };
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        <TaskCard
          key={task.id}
          task={task}
          status={status}
          // Disable native task drag; dnd-kit drives reordering for Windows WebView2 reliability.
          draggable={false}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragEnter={handleTaskDragEnter}
          onDragLeave={handleTaskDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          isDraggedOver={false}
          dragPosition={null}
        />
      </div>
    );
  }

  const handleCreateTask = (status: 'draft' | 'todo' | 'inProgress' | 'done') => {

    const dueDate = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
    const newTask = {
      id: crypto.randomUUID(),
      title: '',
      description: '',
      project: activeProject?.name ?? projects[0]?.name ?? '',
      assignedAgents: [],
      status,
      priority: 'medium' as const,
      dueDate: new Date(dueDate).toISOString().split('T')[0]
    };
    setEditingTask(newTask);
  };

  const handleTaskSave = (updatedTask: any) => {
    const prev = useKanbanStore.getState().tasks.find((t) => t.id === updatedTask.id);
    if (updatedTask.status === 'todo') {
      const suggestedAgent = suggestAgentForTask(updatedTask);
      if (suggestedAgent) {
        updatedTask.suggestedAgent = suggestedAgent.id;
      }
    }
    updateTask(updatedTask);
    runHermesIfMovedToTodo(updatedTask.id, prev?.status ?? null, updatedTask.status ?? null);
    setEditingTask(null);
  };

  // Filter by project and hide archived tasks
  const filteredTasks =
    activeProject != null
      ? tasks.filter((t: any) => !t.archived && t.project === activeProject.name)
      : tasks.filter((t: any) => !t.archived);

  const tasksByStatus = {
    draft: filteredTasks.filter((t: any) => t.status === 'draft'),
    todo: filteredTasks.filter((t: any) => t.status === 'todo'),
    inProgress: filteredTasks.filter((t: any) => t.status === 'inProgress'),
    done: filteredTasks
      .filter((t: any) => t.status === 'done')
      .sort((a, b) => {
        // Sort by completedDate in descending order (newest first)
        if (!a.completedDate) return 1; // Tasks without completedDate go to the bottom
        if (!b.completedDate) return -1; // Tasks with completedDate go to the top
        return b.completedDate.localeCompare(a.completedDate); // Most recent first
      })
  };

  return (
    <>
      <Header sidebarCollapsed={sidebarCollapsed} />
      <div className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
        <div className="mx-auto" 
          style={{ 
            maxWidth: 'min(1500px, 100%)',
            padding: '0 2rem'
          }}>
          <div className="flex justify-center">
            <div className="inline-flex items-center bg-white/50 dark:bg-blue-950/50 backdrop-blur-sm rounded-lg p-1 border border-violet-200/50 dark:border-blue-800/50 shadow-sm">
              <button
                onClick={() => setViewMode('board')}
                className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'board' 
                  ? 'bg-violet-100 dark:bg-blue-800/50 text-violet-800 dark:text-blue-200' 
                  : 'text-gray-600 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-blue-900/30'}`}
              >
                <Columns className="h-4 w-4 mr-1.5" />
                Board
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'list' 
                  ? 'bg-violet-100 dark:bg-blue-800/50 text-violet-800 dark:text-blue-200' 
                  : 'text-gray-600 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-blue-900/30'}`}
              >
                <List className="h-4 w-4 mr-1.5" />
                List
              </button>
            </div>
          </div>
          <main className="py-4 sm:py-6 md:py-8">
            {viewMode === 'board' ? (
              <DndContext sensors={sensors} onDragEnd={onDndEnd}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  {(['draft', 'todo', 'inProgress', 'done'] as const).map((status) => (
                    <DroppableColumn
                      key={status}
                      id={`col:${status}`}
                      className="bg-white/30 dark:bg-blue-950/30 backdrop-blur-sm p-3 sm:p-4 rounded-xl 
                        border border-violet-200/50 dark:border-blue-800/50 
                        shadow-xl shadow-violet-200/20 dark:shadow-blue-900/20
                        hover:shadow-violet-300/30 dark:hover:shadow-blue-800/30"
                    >
                    <div className="flex items-center justify-between mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-violet-200/50 dark:border-blue-800/50">
                      <div className="flex items-center">
                        {COLUMN_ICONS[status]}
                        <h2 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-gray-100 ml-2">
                          {COLUMN_TITLES[status]}
                        </h2>
                        <span className="ml-1 sm:ml-2 bg-violet-100/70 dark:bg-blue-900/70 text-violet-800 dark:text-blue-200 
                          text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 rounded-full font-medium">
                          {tasksByStatus[status].length}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCreateTask(status)}
                        className="p-1.5 sm:p-2 hover:bg-violet-100/50 dark:hover:bg-blue-900/50 rounded-full 
                          transition-all duration-200 hover:scale-110 cursor-pointer"
                      >
                        <Plus className="h-4 w-4 sm:h-5 sm:w-5 text-violet-600 dark:text-blue-400" />
                      </button>
                    </div>
                      <SortableContext items={tasksByStatus[status].map((t: any) => t.id)} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2 sm:space-y-3" id={`col:${status}`}>
                          {tasksByStatus[status].map((task: any) => (
                            <SortableTaskCard key={task.id} task={task} status={status} />
                          ))}
                        </div>
                      </SortableContext>
                    </DroppableColumn>
                  ))}
                </div>
              </DndContext>
            ) : (
              <div className="flex flex-col">
                <div className="flex justify-between mb-4">
                  <div className="flex space-x-2">
                    {(['draft', 'todo'] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => handleCreateTask(status)}
                        className="flex cursor-pointer items-center px-3 py-1.5 bg-white/50 dark:bg-blue-950/50 backdrop-blur-sm rounded-lg 
                          border border-violet-200/50 dark:border-blue-800/50 shadow-sm
                          hover:bg-violet-50 dark:hover:bg-blue-900/30 transition-colors"
                      >
                        <Plus className="h-4 w-4 mr-1.5 text-violet-600 dark:text-blue-400" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Add to {COLUMN_TITLES[status]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <TaskListView 
                  tasks={filteredTasks} 
                  onEditTask={setEditingTask} 
                  onSelectTask={setSelectedTask} 
                  onStartTask={(taskId) => {
                    const task = tasks.find(t => t.id === taskId);
                    if (task) {
                      updateTask({...task, status: 'inProgress'});
                    }
                  }}
                  onUpdateTaskStatus={(taskId, newStatus) => {
                    const task = tasks.find(t => t.id === taskId);
                    if (task) {
                      // Add completedDate if moving to done status
                      const updates = {
                        ...task,
                        status: newStatus,
                        completedDate: newStatus === 'done' ? new Date().toISOString() : task.completedDate
                      };
                      updateTask(updates);
                    }
                  }}
                />
              </div>
            )}
          </main>
        </div>
      </div>

      {editingTask && (
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleTaskSave}
          agents={agents}
        />
      )}

      {selectedTask && (
        <TaskResultModal
          isOpen={true}
          onClose={() => setSelectedTask(null)}
          result={selectedTask.result}
          taskTitle={selectedTask.title}
          taskDescription={selectedTask.description}
          taskId={selectedTask.id}
          onExecutePython={executePythonCode}
          assignedWorkmate={selectedTask.assignedAgents?.length > 0 ? {
            id: selectedTask.assignedAgents[0],
            name: agents.find(a => a.id === selectedTask.assignedAgents[0])?.name || '',
            avatar: agents.find(a => a.id === selectedTask.assignedAgents[0])?.avatar || ''
          } : undefined}
        />
      )}
    </>
  );
}
