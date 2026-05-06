import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Clock, ListTodo, Edit2, Eye, Play, Calendar, ChevronDown, Archive, Trash2 } from 'lucide-react';
import { Task } from '../types';
import { useKanbanStore } from '../store';
import { AgentAvatar } from './AgentAvatar';
import { cn } from '../lib/utils';
import workerManager from '@/workers/workerManager';
import pyodideManager from '@/python/pyodideManager';
import type { PythonResult } from '@/python/types';

interface TaskListItemProps {
  task: Task;
  onEditTask: (task: Task) => void;
  onSelectTask: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: Task['status']) => void;
}

export const TaskListItem = React.memo(({ 
  task,
  onEditTask,
  onSelectTask,
  onStatusChange
}: TaskListItemProps) => {
  const [isPerforming, setIsPerforming] = useState(false);
  const [isPythonExecuting, setIsPythonExecuting] = useState(false);
  const [showCompletionAnimation, setShowCompletionAnimation] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const { agents, deleteTask, archiveTask } = useKanbanStore();

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = statusMenuRef.current;
      if (el && !el.contains(e.target as Node)) setStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [statusMenuOpen]);

  useEffect(() => {
    setStatusMenuOpen(false);
  }, [task.status, task.id]);
  
  // Status icons mapping
  const STATUS_ICONS = {
    draft: <ListTodo className="h-4 w-4 text-gray-500 dark:text-gray-400" />,
    todo: <ListTodo className="h-4 w-4 text-gray-500 dark:text-gray-400" />,
    inProgress: <Clock className="h-4 w-4 text-blue-500 dark:text-blue-400" />,
    done: <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />
  } as const;

  // Status text mapping
  const STATUS_TEXT = {
    draft: 'Draft',
    todo: 'To Do',
    inProgress: 'In Progress',
    done: 'Done'
  } as const;

  // Priority colors mapping
  const PRIORITY_COLORS = {
    low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
  } as const;
  
  const formattedDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No date';
  const taskAgents = agents.filter(agent => task.assignedAgents.includes(agent.id));
  
  // Node ID for worker registration
  const nodeId = `task-${task.id}`;
  const pythonNodeId = `python-task-${task.id}`;
  
  // Track if worker has been registered
  const workerRegisteredRef = useRef(false);
  const pythonRegisteredRef = useRef(false);
  const extractedPythonCodeRef = useRef<string | null>(null);
  
  // Helper function to update a task
  const updateTask = (updatedTask: Task) => {
    useKanbanStore.getState().updateTask(updatedTask);
  };
  
  // Function to handle starting a task
  const handleStartTask = () => {
    setIsPerforming(true);
    onStatusChange(task.id, 'inProgress');
  };
  
  // Extract Python code from markdown code blocks
  const extractPythonCode = (text: string): string | null => {
    if (!text) return null;
    
    // Look for Python code blocks
    const pythonRegex = /```(?:python|py)\n([\s\S]*?)```/g;
    const matches = [...text.matchAll(pythonRegex)];
    
    if (matches.length > 0) {
      // Return the first Python code block found
      return matches[0][1].trim();
    }
    
    return null;
  };
  
  // Handle Python result updates
  const handlePythonResult = (data: PythonResult) => {
    // Process Python execution results
    
    // Get the latest task state
    const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
    if (!currentTask) return;
    
    // Process streaming output messages for live updates
    if ((data.type === 'stdout' || data.type === 'stderr') && data.output && data.nodeId === pythonNodeId) {
      // Format the output
      let newOutput = '';
      if (data.type === 'stdout') {
        newOutput = data.output;
      } else if (data.type === 'stderr') {
        newOutput = `Error: ${data.output}`;
      }
      
      // Create updated task with the streaming result
      const updatedTask = {
        ...currentTask,
        result: {
          type: 'python' as const,
          data: {
            python: {
              code: extractedPythonCodeRef.current || '',
              output: newOutput,
              fullResponse: currentTask.result?.data.python?.fullResponse
            }
          }
        }
      };
      
      // Update the task in the store
      useKanbanStore.getState().updateTask(updatedTask);
    } else if (data.status === 'success' || data.status === 'error') {
      // Final result
      const updatedTask = {
        ...currentTask,
        result: {
          type: 'python' as const,
          data: {
            python: {
              code: extractedPythonCodeRef.current || '',
              output: data.stdout || data.error || 'Execution complete',
              fullResponse: currentTask.result?.data.python?.fullResponse
            }
          }
        }
      };
      
      // Update the task in the store
      useKanbanStore.getState().updateTask(updatedTask);
      
      // Clean up
      setIsPythonExecuting(false);
      pythonRegisteredRef.current = false;
      pyodideManager.unregisterNode(pythonNodeId);
    }
  };
  
  // Execute Python code for a Software Developer task
  const executePythonCode = () => {
    if (pythonRegisteredRef.current) {
      console.log('Python execution already in progress');
      return;
    }
    
    // Get the latest task state
    const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
    if (!currentTask) return;
    
    // Extract Python code from the result if available, or from the description
    let codeToExecute = extractedPythonCodeRef.current;
    
    if (!codeToExecute && currentTask.result?.type === 'python' && currentTask.result.data.python?.code) {
      codeToExecute = currentTask.result.data.python.code;
    }
    
    if (!codeToExecute && currentTask.result?.type === 'python' && currentTask.result.data.python?.fullResponse) {
      codeToExecute = extractPythonCode(currentTask.result.data.python.fullResponse);
    }
    
    if (!codeToExecute) {
      console.error('No Python code found to execute');
      return;
    }
    
    console.log('Executing Python code:', codeToExecute);
    
    setIsPythonExecuting(true);
    pythonRegisteredRef.current = true;
    
    // Store the code for reference
    extractedPythonCodeRef.current = codeToExecute;
    
    // Create an initial Python result to show execution has started
    updateTask({
      ...currentTask,
      result: {
        type: 'python' as const,
        data: {
          python: {
            code: codeToExecute,
            output: 'Executing...',
            fullResponse: currentTask.result?.type === 'python' ? currentTask.result.data.python?.fullResponse : undefined
          }
        }
      }
    });
    
    // Register with pyodide manager
    pyodideManager.registerNode(handlePythonResult, pythonNodeId);
    
    // Execute the code
    pyodideManager.executePython(codeToExecute, pythonNodeId);
  };
  
  // Register worker when task status changes to 'inProgress'
  useEffect(() => {
    // Only register worker when task is inProgress and has agents
    if (task.status === 'inProgress' && taskAgents.length > 0) {
      // Avoid registering multiple times
      if (workerRegisteredRef.current) {
        return;
      }
      
      workerRegisteredRef.current = true;
      setIsPerforming(true);
      
      // Register worker node with the worker manager
      workerManager.registerNode((data) => {
        // Handle different message types from the worker
        if (data.type === 'result') {
          // Handle result messages (final output from the worker)
          const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
          if (!currentTask) return;
          
          // Create updated task with the result
          const updatedTask = {
            ...currentTask,
            status: 'done' as const,
            completedDate: new Date().toISOString(),
            result: {
              type: data.resultType || 'text',
              data: { text: { title: task.title, content: data.result.text || data.result } }
            }
          };
          
          // Update the task in the store
          useKanbanStore.getState().updateTask(updatedTask);
          
          // Update local state and show completion animation
          setIsPerforming(false);
          setShowCompletionAnimation(true);
          // Hide completion animation after 2 seconds
          setTimeout(() => setShowCompletionAnimation(false), 2000);
          
          // Check if this is a Software Developer task with Python code
          if (data.resultType === 'python' && data.result.python?.fullResponse) {
            const extractedCode = extractPythonCode(data.result.python.fullResponse);
            if (extractedCode) {
              extractedPythonCodeRef.current = extractedCode;
              // Execute the Python code automatically
              setTimeout(() => executePythonCode(), 500);
            }
          }
        } else if (data.status === 'update') {
          // Handle incremental updates (no action needed)
        } else if (data.status === 'complete') {
          // Handle completion - mark task as done if not already done
          const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
          if (currentTask && currentTask.status !== 'done') {
            // Task Manager decomposition is handled in `TaskCard` (board view). Do not auto-complete here.
            if (currentTask.assignedAgents.includes('taskManager')) {
              setIsPerforming(false);
              return;
            }

            // Create updated task with completion status
            const updatedTask = {
              ...currentTask,
              status: 'done' as const,
              completedDate: new Date().toISOString(),
              result: currentTask.result || {
                type: 'text',
                data: { text: { title: task.title, content: data.output || 'Task completed' } }
              }
            };
            
            // Update the task in the store
            useKanbanStore.getState().updateTask(updatedTask);
            
            // Update local state
            setIsPerforming(false);
          }
        }
      }, nodeId);
      
      // Send the task to the worker
      // Send the message to the worker using the correct method
      if (task.assignedAgents.includes('taskManager')) {
        // For Task Manager, send decomposition request
        const agent = taskAgents[0];
        const messages = [
          { role: 'system', content: agent.systemPrompt },
          { 
            role: 'user', 
            content: `Please help to decompose this task:
Title: ${task.title}
Description: ${task.description} into subtasks.`
          }
        ];
        
        // Send the message to the worker
        workerManager.sendMessage(nodeId, {
          type: 'generate',
          messages,
          modelConfig: agent.modelConfig || {
            temperature: 0.2,
            top_k: 3,
            max_new_tokens: 1024
          }
        });
      } else {
        // For other agents, send regular task execution request
        const agent = taskAgents[0];
        const messages = [
          { role: 'system', content: agent.systemPrompt },
          { 
            role: 'user', 
            content: `Please complete this task:
Title: ${task.title}
Description: ${task.description}`
          }
        ];
        
        // Send the message to the worker
        workerManager.sendMessage(nodeId, {
          type: 'generate',
          messages,
          modelConfig: agent.modelConfig || {
            temperature: 0.7,
            top_k: 40,
            max_new_tokens: 1500
          }
        });
      }
    }
    
    // Cleanup function - unregister worker when component unmounts or status changes
    return () => {
      if (workerRegisteredRef.current) {
        workerManager.unregisterNode(nodeId);
        workerRegisteredRef.current = false;
      }
      
      if (pythonRegisteredRef.current) {
        pyodideManager.unregisterNode(pythonNodeId);
        pythonRegisteredRef.current = false;
      }
    };
  }, [task.status, nodeId]);
  
  return (
    <tr 
      className={cn(
        "hover:bg-violet-50/50 dark:hover:bg-blue-900/20 transition-colors",
        task.status === 'done' && "bg-green-50/30 dark:bg-green-900/10",
        showCompletionAnimation && "border-2 border-green-400 dark:border-green-400 shadow-sm shadow-green-300 dark:shadow-green-800/70",
        isPerforming && "relative"
      )}
    >
      <td className="px-4 py-3 whitespace-nowrap">
        <div ref={statusMenuRef} className="relative inline-block text-left">
          {task.status === 'done' ? (
            <div className="flex items-center">
              {STATUS_ICONS[task.status]}
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{STATUS_TEXT[task.status]}</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="flex items-center rounded-md px-1 py-0.5 text-left hover:bg-violet-100/60 dark:hover:bg-blue-900/40 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400"
                onClick={() => setStatusMenuOpen((o) => !o)}
                aria-expanded={statusMenuOpen}
                aria-haspopup="listbox"
              >
                {STATUS_ICONS[task.status]}
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{STATUS_TEXT[task.status]}</span>
                <ChevronDown
                  className={cn(
                    'ml-1 h-4 w-4 text-gray-400 dark:text-gray-500 transition-transform',
                    statusMenuOpen && 'rotate-180',
                  )}
                />
              </button>
              {statusMenuOpen ? (
                <div
                  className="absolute left-0 top-full z-30 mt-1 w-40 rounded-md border border-violet-200/80 bg-white py-1 shadow-lg dark:border-blue-800/80 dark:bg-gray-800"
                  role="listbox"
                >
                  {Object.entries(STATUS_TEXT).map(([value, label]) =>
                    value !== task.status && value !== 'done' ? (
                      <button
                        type="button"
                        key={value}
                        role="option"
                        onClick={() => {
                          onStatusChange(task.id, value as Task['status']);
                          setStatusMenuOpen(false);
                        }}
                        className="flex w-full items-center px-4 py-2 text-left text-sm text-gray-700 hover:bg-violet-50 dark:text-gray-300 dark:hover:bg-blue-900/30"
                      >
                        {STATUS_ICONS[value as keyof typeof STATUS_ICONS]}
                        <span className="ml-2">{label}</span>
                      </button>
                    ) : null,
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {task.title}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
          {task.description}
        </div>
        {isPerforming && task.status === 'inProgress' && (
          <div className="text-xs text-lime-600 dark:text-lime-400 animate-pulse mt-1">
            Work in progress...
          </div>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="text-sm text-gray-700 dark:text-gray-300">{task.project}</div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`text-xs px-2 py-1 rounded-full ${PRIORITY_COLORS[task.priority]}`}>
          {task.priority}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
          <Calendar className="w-4 h-4 mr-1" />
          {formattedDate}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex -space-x-2">
          {taskAgents.map((agent) => (
            <AgentAvatar 
              key={agent.id} 
              agent={agent} 
              draggable={false}
            />
          ))}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-right">
        <div className="flex justify-end space-x-2">
          {task.status === 'todo' && taskAgents.length > 0 && !isPerforming && (
            <button
              type="button"
              onClick={handleStartTask}
              className="p-1.5 text-green-500 dark:text-green-400
                hover:text-green-600 dark:hover:text-green-300
                hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg
                transition-all duration-200"
              title="Start Task"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {isPythonExecuting && (
            <div className="p-1.5 bg-blue-500 dark:bg-blue-600 text-white rounded-lg animate-pulse">
              <Play className="w-4 h-4" />
            </div>
          )}
          <button
            type="button"
            onClick={() => (task.status === 'done' ? onSelectTask(task) : onEditTask(task))}
            className="p-1.5 text-gray-400 dark:text-gray-500
              hover:text-gray-600 dark:hover:text-gray-300
              hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg
              transition-all duration-200"
            title={task.status === 'done' ? 'View Result' : 'Edit Task'}
          >
            {task.status === 'done' ? <Eye className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => archiveTask(task.id)}
            className="p-1.5 text-amber-600 dark:text-amber-400
              hover:text-amber-700 dark:hover:text-amber-300
              hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg
              transition-all duration-200"
            title="Archive task"
          >
            <Archive className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Delete this task permanently?')) deleteTask(task.id);
            }}
            className="p-1.5 text-red-500 dark:text-red-400
              hover:text-red-600 dark:hover:text-red-300
              hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg
              transition-all duration-200"
            title="Delete task"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
      {isPerforming && task.status === 'inProgress' && (
        <td className="absolute top-0 left-0 right-0 bottom-0 bg-gradient-to-r from-transparent via-lime-300/10 to-transparent bg-[length:200%_100%] animate-shimmer pointer-events-none" />
      )}
    </tr>
  );
});
