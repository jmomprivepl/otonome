import React, { useEffect, useState, useRef } from 'react';
import { Calendar, Edit2, Eye, GripVertical, CheckCircle, X, Play, Archive, Trash2 } from 'lucide-react';
import { Task } from '../types';
import { useKanbanStore } from '../store';
import { AgentAvatar } from './AgentAvatar';
import { cn } from '../lib/utils';
import workerManager from '@/workers/workerManager';
import { workflowManager } from '@/workflows/workflowManager';
import pyodideManager from '@/python/pyodideManager';
import type { PythonResult } from '@/python/types';

import { exaSearch, exaAnswer } from '@/exaops';
import { listBases, listTables, listRecords } from '@/airtableops';
import { parseAssistantActions } from '@/lib/assistantActionParser';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface TaskCardProps {
  task: Task;
  status: string;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, taskId: string, sourceStatus: string) => void;
  onDragEnd: () => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, targetStatus: 'draft' | 'todo' | 'inProgress' | 'done') => void;
  isDraggedOver?: boolean;
  dragPosition?: 'top' | 'bottom' | null;
  /** Disable native HTML5 task drag (used when dnd-kit handles reordering). */
  draggable?: boolean;
}

export const TaskCard = React.memo(({ 
  task, 
  status,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  isDraggedOver,
  dragPosition,
  draggable = true,
}: TaskCardProps) => {
  const [isPerforming, setIsPerforming] = useState(false);
  const [exaActions, setExaActions] = useState<string[]>([]);
  const [airtableActions, setAirtableActions] = useState<string[]>([]);
  const [showCompletionAnimation, setShowCompletionAnimation] = useState(false);
  const { agents, updateTask, createSubtask, findTaskById, deleteTask, archiveTask } = useKanbanStore();
  const latestOutputRef = useRef('');
  // Use a ref to track tool state to avoid race conditions with React's state batching
  const waitingForToolRef = useRef(false);
  const [toolOutput, setToolOutput] = useState('');
  const decompositionOutputRef = useRef('');
  const [decompositionOutput, setDecompositionOutput] = useState('');
  const [isPythonExecuting, setIsPythonExecuting] = useState(false);
  const pythonNodeId = `python-task-${task.id}`;
  const pythonRegisteredRef = useRef(false);
  const extractedPythonCodeRef = useRef<string | null>(null);
  
  const nodeId = `task-${task.id}`;
  const taskAgents = agents.filter(agent => task.assignedAgents.includes(agent.id));
  const suggestedAgent = task.suggestedAgent ? agents.find(agent => agent.id === task.suggestedAgent) : null;

  // Function to handle starting a task
  const handleStartTask = () => {
    setIsPerforming(true);
  };

  // Track if worker has been registered
  const workerRegisteredRef = React.useRef(false);
  // Track if message has been sent to prevent duplicate sends
  const messageSentRef = React.useRef(false);

  const sanitizeJson = (raw: string): string => {
    // Handle some common "almost JSON" issues from local models.
    return raw
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      // remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, '$1');
  };

  const extractDecomposeSubtasks = (raw: string): Array<{ title?: unknown; description?: unknown; suggestedAgent?: unknown }> | null => {
    if (!raw || raw.trim().length === 0) return null;

    // Best case: pure JSON object
    try {
      const obj = JSON.parse(sanitizeJson(raw));
      if (obj && obj.action === 'decompose_task' && Array.isArray(obj.subtasks)) {
        return obj.subtasks;
      }
    } catch {
      // continue
    }

    // Try to find the subtasks array regardless of surrounding text.
    const arrayMatch = raw.match(/"subtasks"\s*:\s*(\[[\s\S]*?\])\s*[},]/);
    if (arrayMatch?.[1]) {
      try {
        const arr = JSON.parse(sanitizeJson(arrayMatch[1]));
        if (Array.isArray(arr)) return arr;
      } catch {
        // continue
      }
    }

    // Last resort: find a JSON object containing "action":"decompose_task" and parse it.
    const objMatch = raw.match(/\{[\s\S]*?"action"\s*:\s*"decompose_task"[\s\S]*?\}/);
    if (objMatch?.[0]) {
      try {
        const obj = JSON.parse(sanitizeJson(objMatch[0]));
        if (obj && obj.action === 'decompose_task' && Array.isArray(obj.subtasks)) {
          return obj.subtasks;
        }
      } catch {
        // ignore
      }
    }

    return null;
  };

  const extractActions = (content: string): { cleanContent: string; actions: string[][] } => {
    const parsed = parseAssistantActions(content);
    const actions: string[][] = [];

    for (const a of parsed.actions) {
      if (a.kind === 'search') actions.push(['search', a.request]);
      else if (a.kind === 'getanswer') actions.push(['getanswer', a.request]);
      else if (a.kind === 'list_records') actions.push(['list_records', a.request]);
    }

    return { cleanContent: parsed.cleanText, actions };
  };

  useEffect(() => {
    if (toolOutput && toolOutput.length > 0) {
      console.log('Tool output ready:', toolOutput);

      // When tool output is ready, update the task with the result and mark as done
      updateTask({
        ...task,
        status: 'done',
        result: {
          data: { text: { title: task.title, content: toolOutput } },
          type: task.result?.type || 'text'
        },
        completedDate: new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1]
      });
      // Clear the tool output after updating the task
      setTimeout(() => {
        waitingForToolRef.current = false;
        setToolOutput('');
      }, 100); // Small delay to ensure state updates properly
    }
  }, [toolOutput]);

  useEffect(() => {
    decompositionOutputRef.current = decompositionOutput;
  }, [decompositionOutput]);

  useEffect(() => {
    if (exaActions.length > 0) {
      const executeAction = async () => {
        try {
          if (exaActions[0] === 'search' || exaActions[0] === 'getanswer') {
            // Execute the search/answer and update the output node
            let resultContent = '';
            if (exaActions[0] === 'search') {
              const searchResults = await exaSearch(exaActions[1]);
              resultContent = searchResults.results.map(result => 
                `${result.title}\n${result.text}\n${result.url}`
              ).join('\n\n');
            } else {
              const answerResults = await exaAnswer(exaActions[1]);
              resultContent = `${answerResults.answer}\n\nSources:\n${
                answerResults.citations.map(c => `${c.text}\n${c.url}`).join('\n\n')
              }`;
            }
            // Update the task with the tool output
            setToolOutput(resultContent);
          }

          setExaActions([]);
        } catch (error) {
          console.error('Error executing action:', error);
          setExaActions([]);
        }
      }
      executeAction();
    }
  }, [exaActions]);

  useEffect(() => {
    if (airtableActions.length > 0) {
      const executeAction = async () => {
        try {
          if (airtableActions[0] === 'list_records') {

            const bases = await listBases();
            let baseId = "";
          
            if (bases.length === 1) {
              baseId = bases[0].id;
            } else if (bases.length > 1) {
              for (const base of bases) {
                try {
                  baseId = base.id;
                  break;
                } catch (error) {
                  null;
                }
              }
            } else {
              return;
            }

            // Get the table ID from the table name
            const tables = await listTables(baseId);
            const tableName = airtableActions[1];
            
            const table = tables.find(t => t.name === tableName || t.name.toLowerCase() === tableName.toLowerCase());
            if (!table) {
              console.error("Table not found:", tableName);
              return;
            }

            const records = await listRecords(baseId, table.id);
            const recordOutput = records.map(r => {
              // Format each record with ID and all fields
              const fieldEntries = Object.entries(r.fields).map(([key, value]) => {
                // Handle complex objects like Assignee
                if (typeof value === 'object' && value !== null) {
                  if ('name' in value) {
                    return `${key}: ${value.name}`;
                  } else {
                    return `${key}: ${JSON.stringify(value)}`;
                  }
                }
                return `${key}: ${value}`;
              });
              
              // Return a formatted string for each record
              return `Record ID: ${r.id}
${fieldEntries.join('\n')}`;
            }).join('\n-------------------------------------\n'); // Add extra line between records
            
            // Update the task with the tool output
            setToolOutput(recordOutput);
          }
          setAirtableActions([]);
        } catch (error) {
          console.error('Error executing action:', error);
          setAirtableActions([]);
        }
      }
      executeAction();
    }
  }, [airtableActions]);

  
  // Register worker when task status changes to 'inProgress'
  useEffect(() => {
    // Only register worker when task is inProgress and has agents
    if (status === 'inProgress' && taskAgents.length > 0) {
      // Avoid registering multiple times
      if (workerRegisteredRef.current) {
        return;
      }
      
      workerRegisteredRef.current = true;
      
      // Register worker node with the worker manager
      workerManager.registerNode((data) => {

        if (task.assignedAgents.includes('taskManager')) {
          if (data.status === 'ready') {
            // Only send if we haven't sent a message yet
            if (!messageSentRef.current) {
              messageSentRef.current = true;
              
              // Get the agent and prepare the message
              const agent = taskAgents[0];
              const messages: Message[] = [
                { role: 'system', content: agent.systemPrompt },
                { 
                  role: 'user', 
                  content: `Please help to decompose this task:\nTitle: ${task.title}\nDescription: ${task.description} into subtasks.`
                }
              ];

              console.log('Starting task decomposition:', messages);
              
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
            }
          } else if (data.status === 'update') {
            setDecompositionOutput(data.output);
          } else if (data.status === 'complete') {
            try {
              // Process the task decomposition result
              const outputContent = decompositionOutputRef.current;

              console.log('Task decomposition result:', outputContent);

              const subtasks = extractDecomposeSubtasks(outputContent);

              if (subtasks && subtasks.length > 0) {
                
                // Create new tasks for each subtask
                subtasks.forEach((subtask: any, index: number) => {
                  const newTask: Task = {
                    id: `${task.id}-subtask-${index}-${crypto.randomUUID()}`,
                    title: String(subtask.title ?? '').trim() || `Subtask ${index + 1}`,
                    description: typeof subtask.description === 'string' ? subtask.description : String(subtask.description ?? ''),
                    project: task.project,
                    priority: task.priority,
                    status: 'todo',
                    dueDate: task.dueDate,
                    assignedAgents: subtask.suggestedAgent ? [String(subtask.suggestedAgent)] : [],
                    parentTaskId: task.id
                  };
                  
                  createSubtask(newTask);
                });

                // Reset isPerforming state to hide the loading indicator
                setIsPerforming(false);

                // Parent stays in progress until all subtasks are completed.
                const finalUpdatedTask: Task = {
                  ...task,
                  status: 'inProgress',
                  isDecomposed: true,
                  result: {
                    type: 'text',
                    data: {
                      text: {
                        title: `Decomposed: ${task.title}`,
                        content: `Created ${subtasks.length} subtasks.\n\nMove through the subtasks; this parent stays In Progress until they’re all Done.`,
                      },
                    },
                  },
                };
                updateTask(finalUpdatedTask);
              } else {
                console.error('No task decomposition result found in output');
                // Reset the task status if no decomposition was found
                const resetTask: Task = {
                  ...task,
                  status: 'todo',
                  result: {
                    type: 'text',
                    data: {
                      text: {
                        title: `Decomposition failed: ${task.title}`,
                        content: 'Task Manager did not return valid JSON for subtasks. Try again, or reduce the task description.',
                      },
                    },
                  },
                };
                updateTask(resetTask);
                
                // Reset isPerforming state to hide the loading indicator
                setIsPerforming(false);
              }
            } catch (error) {
              console.error('Error processing task decomposition result:', error);
              // Reset the task status on error
              const resetTask: Task = {
                ...task,
                status: 'todo',
                result: {
                  type: 'text',
                  data: {
                    text: {
                      title: `Decomposition error: ${task.title}`,
                      content: `Error processing Task Manager output: ${String(error)}`,
                    },
                  },
                },
              };
              updateTask(resetTask);
              
              // Reset isPerforming state to hide the loading indicator
              setIsPerforming(false);
            }
          }
        
          // Handle other agents
        } else {
          if (data.status === 'update') {
            const output = data.output;
            
            // Extract actions from the output
            const { cleanContent, actions } = extractActions(output);
  
            if (actions.length > 0) {
              waitingForToolRef.current = true;
              
              // Store actions in a local variable to avoid closure issues
              const currentAction = [...actions[0]];
              
              if (currentAction[0] === 'search' || currentAction[0] === 'getanswer') {
                setExaActions(currentAction);
              } else if (currentAction[0] === 'list_records') {
                setAirtableActions(currentAction);
              }
            }
            
            if (actions.length === 0 && typeof output === 'string' && output !== '') {
              // Update the ref
              latestOutputRef.current = output;
            } else if (cleanContent !== '') {
              // Update the ref
              latestOutputRef.current = cleanContent;
            }
            
          } else if (data.status === 'complete') {            
              // Use the ref value which is always up-to-date
              const finalOutput = latestOutputRef.current;
              
              // Check if this is a Software Developer task that needs Python execution
              const hasSoftwareDeveloper = task.assignedAgents.includes('softwareDeveloper');
              
              // Check the ref directly instead of the state to avoid race conditions
              if (!waitingForToolRef.current) {
                if (hasSoftwareDeveloper) {                  
                  // For Software Developer tasks, extract Python code and set up Python result
                  const extractedCode = extractPythonCode(finalOutput);
                  
                  // Store the extracted code in the ref for later use
                  extractedPythonCodeRef.current = extractedCode;
                  
                  // Set Python result type first
                  const pythonUpdateTask = {
                    ...task,
                    status: 'done' as Task['status'],
                    result: {
                      type: 'python' as 'spreadsheet' | 'slides' | 'text' | 'python',
                      data: {
                        python: {
                          code: extractedCode || '',
                          output: '',  // Empty output means ready to execute
                          fullResponse: finalOutput
                        }
                      }
                    },
                    completedDate: new Date().toISOString()
                  };
                  
                  // Update with Python result
                  updateTask(pythonUpdateTask);
                  
                  // Don't automatically execute Python code
                  // The user will click the Execute Code button in the TaskResultView
                  if (extractedCode) {
                    console.log('Python code ready for execution:', extractedCode);
                  } else {
                    console.warn('No Python code found to execute');
                  }
                } else {
                  // For non-Software Developer tasks, use normal text result
                  updateTask({
                    ...task,
                    status: 'done',
                    result: {
                      data: { text: { title: task.title, content: finalOutput } },
                    type: task.result?.type || 'text'
                    },
                    completedDate: new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1]
                  });
                }
              } else {
                // Store the final output in case we need it later, but don't update the task yet
                latestOutputRef.current = finalOutput;
                // We don't update the task status here because we're waiting for the tool to complete
                // The tool completion effect will handle updating the task status
              }
              messageSentRef.current = false; // Reset for potential future use
          } else if (data.status === 'ready') {
            
            // Only send if we haven't sent a message yet
            if (!messageSentRef.current) {
              messageSentRef.current = true;
              
              // Get the agent and prepare the message
              const agent = taskAgents[0];
              const messages: Message[] = [
                { role: 'system', content: agent.systemPrompt },
                { 
                  role: 'user', 
                  content: `Please help with this task:\nTitle: ${task.title}\nDescription: ${task.description}`
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
            }
          }
        }
      }, nodeId);
    }
    
    // Cleanup function - unregister worker when component unmounts or status changes
    return () => {
      if (workerRegisteredRef.current) {
        workerManager.unregisterNode(nodeId);
        workerRegisteredRef.current = false;
      }
    };
  }, [status, nodeId]);  // Depend on status and nodeId
  
  // Extract Python code from markdown code blocks
  const extractPythonCode = (text: string): string | null => {
    if (!text) return null;
    
    // Look for Python code blocks in markdown format: ```python ... ```
    const pythonCodeRegex = /```python([\s\S]*?)```/;
    const match = text.match(pythonCodeRegex);
    
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // If no Python code block found, look for any code block
    const anyCodeBlockRegex = /```([\s\S]*?)```/;
    const anyMatch = text.match(anyCodeBlockRegex);
    
    if (anyMatch && anyMatch[1]) {
      return anyMatch[1].trim();
    }
    
    return null;
  };

  // Execute Python code for a Software Developer task
  const executePythonCode = () => {
    if (!task.description) return;
    
    // Extract Python code from the description if possible
    const extractedCode = extractPythonCode(task.description);
    if (!extractedCode && !task.description) return;
    
    const codeToExecute = extractedCode || task.description;
    console.log('Executing Python code for task:', task.id);
    
    setIsPythonExecuting(true);
    
    // Store the extracted code in ref for later use by the callback
    extractedPythonCodeRef.current = codeToExecute;
    
    // Create an initial Python result to show execution has started
    updateTask({
      ...task,
      result: {
        type: 'python' as const, // Use const assertion to fix type error
        data: {
          python: {
            code: codeToExecute,
            output: 'Executing Python code...',
            fullResponse: task.result?.type === 'python' ? task.result.data.python?.fullResponse : undefined
          }
        }
      }
    });
    
    // Only register for Python updates when actually executing
    if (!pythonRegisteredRef.current) {
      console.log('Registering Python node for live updates:', pythonNodeId);
      pyodideManager.registerNode(handlePythonResult, pythonNodeId);
      pythonRegisteredRef.current = true;
    }
    
    // Update task with initial executing state
    updateTask({
      ...task,
      result: {
        type: 'python',
        data: {
          python: {
            code: codeToExecute,
            output: 'Executing Python code...',
            fullResponse: task.result?.type === 'python' ? task.result.data.python?.fullResponse : undefined
          }
        }
      }
    });
    
    // Execute the Python code
    pyodideManager.executePython(
      codeToExecute,
      pythonNodeId,
      { 
        taskId: task.id,
        extractedCode: !!extractedCode
      }
    ).catch(err => {
      console.error('Error executing Python code:', err);
      setIsPythonExecuting(false);
      
      // Update task with error message
      updateTask({
        ...task,
        result: {
          type: 'python',
          data: {
            python: {
              code: codeToExecute,
              output: `Error: ${err.message || 'Unknown error executing Python code'}`,
              fullResponse: task.result?.type === 'python' ? task.result.data.python?.fullResponse : undefined
            }
          }
        }
      });
    });
  };

  // Track previous status to detect changes
  const prevStatusRef = useRef<string | null>(null);
  
  // Track Python output for streaming updates
  const pythonOutputRef = useRef<{stdout: string, stderr: string}>({stdout: '', stderr: ''});
  
  // Handle Python result updates - processes streaming output from Python execution
  const handlePythonResult = (data: PythonResult) => {
    console.log('Python execution update:', data);
    
    // Get the latest task state from the store
    const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
    if (!currentTask) {
      console.error('Task not found:', task.id);
      setIsPythonExecuting(false);
      return;
    }
    
    // Use the stored extracted code from the ref
    const extractedCode = extractedPythonCodeRef.current;
    
    // Process streaming output messages for live updates
    if ((data.type === 'stdout' || data.type === 'stderr') && data.output && data.nodeId === pythonNodeId) {
      console.log(`Received ${data.type} data:`, data.output);
      
      // Accumulate output in our ref for consistent tracking
      if (data.type === 'stdout') {
        pythonOutputRef.current.stdout += data.output;
      } else if (data.type === 'stderr') {
        pythonOutputRef.current.stderr += data.output;
      }
      
      // Format the complete output with both stdout and stderr
      let newOutput = pythonOutputRef.current.stdout;
      if (pythonOutputRef.current.stderr) {
        newOutput += `\nError: ${pythonOutputRef.current.stderr}`;
      }
      
      console.log('Accumulated output:', newOutput);
      
      // Force a re-render by creating a new task object
      const updatedTask = {
        ...currentTask,
        result: {
          type: 'python' as const, // Use const assertion to fix type error
          data: {
            python: {
              code: extractedCode || '',
              output: newOutput,
              fullResponse: currentTask.result?.type === 'python' ? 
                currentTask.result.data.python?.fullResponse : undefined
            }
          }
        }
      };
      
      // Update the task with the incremental output for live updates
      console.log('Updating task with streaming output:', newOutput);
      updateTask(updatedTask);
    } 
    // Handle final result when execution completes successfully
    else if (data.status === 'success' && data.nodeId === pythonNodeId && data.isFinalResult) {
      console.log('Python execution completed successfully');
      
      // For the final result, we'll use the accumulated output we've been collecting
      // rather than overwriting it with the final stdout/stderr
      // This ensures we don't lose any streaming updates
      let output = pythonOutputRef.current.stdout || data.stdout || 'No output';
      if (pythonOutputRef.current.stderr || data.stderr) {
        output += `\n\nErrors:\n${pythonOutputRef.current.stderr || data.stderr}`;
      }
      
      // Create or update the Python result
      const updatedTask = {
        ...currentTask,
        result: {
          type: 'python' as const, // Use const assertion to fix type error
          data: {
            python: {
              code: extractedCode || '',
              output: output,
              fullResponse: output
            }
          }
        }
      };
      
      // Update the task with the final result
      console.log('Updating task with final result:', output);
      updateTask(updatedTask);
      setIsPythonExecuting(false);
      
      // Mark task as completed if execution was successful
      if (status === 'inProgress') {
        // Move task to done after a short delay
        setTimeout(() => {
          updateTask({
            ...updatedTask,
            status: 'done',
            completedDate: new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1].substring(0, 8)
          });
        }, 1000);
      }
    } 
    // Handle execution errors
    else if ((data.status === 'error' || data.error) && data.nodeId === pythonNodeId) {
      console.error('Python execution error:', data.error);
      
      // Update task with error information
      updateTask({
        ...currentTask,
        result: {
          type: 'python' as const, // Use const assertion to fix type error
          data: {
            python: {
              code: extractedCode || '',
              output: `Execution error: ${data.error || 'Unknown error'}`,
              fullResponse: `Execution error: ${data.error || 'Unknown error'}`
            }
          }
        }
      });
      
      setIsPythonExecuting(false);
    }
  };
  
  // Handle Python execution for Software Developer tasks
  useEffect(() => {
    const hasSoftwareDeveloper = task.assignedAgents.includes('softwareDeveloper');
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    
    // Only load Python environment when the task moves to inProgress
    if (status === 'inProgress' && prevStatus !== 'inProgress' && hasSoftwareDeveloper && !pythonRegisteredRef.current) {
      
      // Register callback for Python execution results
      pyodideManager.registerNode((data: PythonResult) => {
        if (data.status === 'success' && data.nodeId === pythonNodeId) {
          
          // Get the latest task state from the store
          const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
          if (!currentTask) {
            console.error('Task not found:', task.id);
            setIsPythonExecuting(false);
            return;
          }
          
          // Use the stored extracted code from the ref instead of trying to extract it again
          const extractedCode = extractedPythonCodeRef.current;
          
          // Format output
          let output = data.stdout || 'No output';
          if (data.stderr) {
            output += `

Errors:
${data.stderr}`;
          }
          // Create or update the Python result
          const updatedTask = {
            ...currentTask,
            result: {
              type: 'python' as 'spreadsheet' | 'slides' | 'text' | 'python',
              data: {
                python: {
                  code: extractedCode || '',
                  output: output,
                  fullResponse: output
                }
              }
            }
          };
          
          // Add completed date if not already set
          if (!updatedTask.completedDate) {
            updatedTask.completedDate = new Date().toISOString();
          }
          
          // Update the task in the store
          useKanbanStore.getState().updateTask(updatedTask);
          setIsPythonExecuting(false);
        } else if (data.status === 'error') {
          console.error('Python execution error:', data.error);
          
          // Get the latest task state from the store
          const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
          if (currentTask) {
            // Use the stored extracted code from the ref
            const extractedCode = extractedPythonCodeRef.current;
            
            // Update with error message
            useKanbanStore.getState().updateTask({
              ...currentTask,
              result: {
                type: 'python' as 'spreadsheet' | 'slides' | 'text' | 'python',
                data: {
                  python: {
                    code: extractedCode || '',
                    output: `Error executing Python code: ${data.error}`,
                    fullResponse: data.stdout
                  }
                }
              }
            });
          }
          
          setIsPythonExecuting(false);
        }
      }, pythonNodeId);
      
      // Initialize Pyodide if not already loaded
      pyodideManager.loadEnvironment().then(() => {
        pythonRegisteredRef.current = true;
      }).catch(err => {
        console.error('Failed to initialize Python environment:', err);
      });
      
      return () => {
        // Cleanup when component unmounts
        if (pythonRegisteredRef.current) {
          pyodideManager.unregisterNode(pythonNodeId);
          pythonRegisteredRef.current = false;
        }
      };
    }
    
    // Execute Python code when task status changes to 'done'
    if (status === 'done' && prevStatus !== 'done' && hasSoftwareDeveloper && pythonRegisteredRef.current) {
      
      // Use the stored extracted code from the ref
      const extractedCode = extractedPythonCodeRef.current;
      
      // Force update the task with a Python result type
      const currentTask = useKanbanStore.getState().tasks.find(t => t.id === task.id);
      if (currentTask) {
        useKanbanStore.getState().updateTask({
          ...currentTask,
          result: {
            type: 'python' as 'spreadsheet' | 'slides' | 'text' | 'python',
            data: {
              python: {
                code: extractedCode || '',
                output: 'Executing Python code...',
                fullResponse: extractedCode ? task.description : undefined
              }
            }
          }
        });
      }
      
      // Execute the Python code
      executePythonCode();
    }
  }, [status, task.id, task.assignedAgents]);

  // Check if this task is a subtask and update parent task if all subtasks are completed
  useEffect(() => {
    // Only run this effect when a task is moved to 'done'
    if (status === 'done' && task.parentTaskId) {
      const parentTaskId = task.parentTaskId;
      
      // Check if all subtasks of the parent are completed
      if (workflowManager.areAllSubtasksCompleted(parentTaskId)) {
        // All subtasks are completed, move parent task to done
        const store = useKanbanStore.getState();
        const parentTask = store.tasks.find(t => t.id === parentTaskId);
        if (parentTask && parentTask.status === 'inProgress') {
          store.updateTask({
            ...parentTask,
            status: 'done',
            result: {
              type: 'text',
              data: { text: { title: task.title, content: 'All subtasks completed - look at them for details' } }
            },
            completedDate: new Date().toISOString().split('T')[0] + ' ' + new Date().toISOString().split('T')[1]
          });
        }
      }
    }
  }, [status, task]);

  // Handle status transitions
  useEffect(() => {
    if (status === 'todo' && isPerforming && taskAgents.length > 0) {
      // Start task execution - just update status to inProgress
      updateTask({ ...task, status: 'inProgress' });
    } else if (status === 'inProgress' && !isPerforming) {
      setIsPerforming(true);
    }
  }, [status, isPerforming, taskAgents, task]);
  
  // Trigger animation when task is moved to 'done' status
  useEffect(() => {
    if (status === 'done') {
      // Check if this is a newly completed task (within the last minute)
      const isRecentlyCompleted = task.completedDate && 
        (new Date().getTime() - new Date(task.completedDate).getTime() < 60000);
      
      if (isRecentlyCompleted) {
        setShowCompletionAnimation(true);
        
        // Reset animation after 5 seconds
        const timer = setTimeout(() => {
          setShowCompletionAnimation(false);
        }, 5000);
        
        return () => clearTimeout(timer);
      }
    } else {
      setShowCompletionAnimation(false);
    }
  }, [status, task.completedDate]);

  const handleAcceptAgent = () => {
    if (suggestedAgent) {
      const updatedTask = { ...task, suggestedAgent: undefined, assignedAgents: [...task.assignedAgents, suggestedAgent.id] };
      updateTask(updatedTask);
      // Start task execution immediately after accepting the agent
      if (status === 'todo') {
        setIsPerforming(true);
      }
    }
  };

  const handleRejectAgent = () => {
    const updatedTask = { ...task, suggestedAgent: undefined };
    updateTask(updatedTask);
  };

  const setEditingTask = useKanbanStore(state => state.setEditingTask);
  const setSelectedTask = useKanbanStore(state => state.setSelectedTask);
  const removeAgent = useKanbanStore(state => state.removeAgent);

  const priorityColors = {
    low: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
    medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
    high: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
  };

  const formattedDate = React.useMemo(() => 
    new Date(task.dueDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  , [task.dueDate]);

  return (
    <div className="relative">
      {dragPosition === 'top' && isDraggedOver && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-teal-300 dark:bg-teal-500 -translate-y-1" />
      )}
      <div
        draggable={draggable}
        onDragStart={draggable ? (e) => onDragStart(e, task.id, status) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onDragEnter={draggable ? (e) => onDragEnter(e, task.id) : undefined}
        onDragLeave={draggable ? onDragLeave : undefined}
        onDragOver={(e) => {
          if (!draggable) return;
          e.preventDefault();
          const types = Array.from(e.dataTransfer.types);
          if (types.includes('application/json')) {
            e.dataTransfer.dropEffect = 'move';
          } else {
            e.dataTransfer.dropEffect = 'move';
            onDragOver(e);
          }
        }}
        onDrop={(e) => {
          const types = Array.from(e.dataTransfer.types);
          if (types.includes('application/json')) {
            e.stopPropagation();
            try {
              const droppedAgent = JSON.parse(e.dataTransfer.getData('application/json'));
              if (droppedAgent && droppedAgent.id) {
                const updatedTask = {
                  ...task,
                  assignedAgents: task.assignedAgents.includes(droppedAgent.id)
                    ? task.assignedAgents
                    : [...task.assignedAgents, droppedAgent.id]
                };
                updateTask(updatedTask);
              }
            } catch (error) {
              console.error('Failed to parse dropped agent:', error);
            }
          } else {
            if (!draggable) return;
            onDrop(e, status as 'draft' | 'todo' | 'inProgress' | 'done');
          }
        }}
        className={cn(
          'task-card bg-slate-50 dark:bg-slate-800 p-4 rounded-xl shadow-sm transition-all duration-300 cursor-grab active:cursor-grabbing relative group',
          status === 'done' && showCompletionAnimation
            ? "border-2 border-green-400 dark:border-green-400 shadow-lg shadow-green-300 dark:shadow-green-800/70"
            : "border border-blue-100/50 dark:border-blue-900/50 hover:shadow-md",
          "dark:hover:bg-slate-700/90",
          isDraggedOver && "opacity-50"
        )}
      >
        {/* Drag handle */}
        <div className="absolute left-2 top-0 bottom-0 flex items-center px-1">
          <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300" />
        </div>

        {/* Main content with left padding for drag handle */}
        <div className="pl-5">
          <div className="space-y-2">
            <div className="flex items-start justify-between max-w-[90%]">
                {task.parentTaskId ? (
                  <div className="flex flex-col items-start">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{findTaskById(task.parentTaskId)?.title} ↓</h3>
                    <p className="text-sm text-gray-900 dark:text-gray-100 pr-6">{task.title}</p>
                  </div>
                ) : (
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 pr-6">{task.title}</h3>
                )}
              </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{task.description}</p>

            {/* Agent Suggestion UI */}
            {suggestedAgent && (
                <div className="flex items-center justify-between p-2 bg-teal-50 dark:bg-teal-900/30 rounded-lg border border-teal-100 dark:border-teal-800">
                  <div className="flex items-center space-x-2">
                    <AgentAvatar 
                      agent={suggestedAgent} 
                      draggable={false}
                    />
                    <span className="text-sm text-cyan-700 dark:text-cyan-300">
                      Suggested workmate
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      draggable={false}
                      onClick={handleAcceptAgent}
                      className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full"
                      title="Accept"
                    >
                      <CheckCircle className="w-5 h-5 text-lime-600 dark:text-lime-400" />
                    </button>
                    <button
                      type="button"
                      draggable={false}
                      onClick={handleRejectAgent}
                      className="p-1 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full"
                      title="Reject"
                    >
                      <X className="w-5 h-5 text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                </div>
              )}

            <div className="flex flex-row justify-between">

              {/* Assigned Agents */}
              <div className="flex items-center justify-between">
                <div className="flex -space-x-2">
                  {taskAgents.map((agent) => (
                    <AgentAvatar 
                      key={agent.id} 
                      agent={agent} 
                      draggable={false}
                      onRemove={() => removeAgent(task.id, agent.id)} 
                    />
                  ))}
                </div>
              </div>

              {/* Priority and Due Date */}
              <div className="flex items-center space-x-2">
                <span className={`text-xs px-2 py-1 rounded-full ${priorityColors[task.priority]}`}>
                  {task.priority}
                </span>
                <Calendar className="w-4 h-4 mr-1 text-gray-500 dark:text-gray-400" />
                <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="absolute top-3 right-2 flex space-x-1">
          {status === 'todo' && taskAgents.length > 0 && !isPerforming && (
            <button
              type="button"
              draggable={false}
              onClick={() => handleStartTask()}
              className="p-1.5 text-green-500 dark:text-green-400
                hover:text-green-600 dark:hover:text-green-300
                hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg
                transition-all duration-200"
              title="Start Task"
            >
              <Play className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            draggable={false}
            onClick={() => status === 'done' ? setSelectedTask(task) : setEditingTask(task)}
            className="p-1.5 text-gray-400 dark:text-gray-500
              hover:text-gray-600 dark:hover:text-gray-300
              hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg
              transition-all duration-200"
            title={status === 'done' ? 'View Result' : 'Edit Task'}
          >
            {status === 'done' ? <Eye className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            draggable={false}
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
            draggable={false}
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

        {/* Task Performing */}
        {isPerforming && status === 'inProgress' && taskAgents.length > 0 && (
        <div className="text-sm text-center pt-4 text-lime-600 dark:text-lime-400 animate-pulse">
          Work in progress...
        </div>
        )}
      </div>
      {isPythonExecuting && (
        <div className="absolute -top-3 -left-3 bg-blue-500 dark:bg-blue-600 text-white rounded-full p-1 shadow-lg animate-pulse">
          <Play className="w-4 h-4" />
        </div>
      )}
      {dragPosition === 'bottom' && isDraggedOver && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-teal-300 dark:bg-teal-500 translate-y-1" />
      )}
      {status === 'done' && (
        <div 
          className="cursor-pointer text-xs border border-violet-400 dark:border-violet-700 text-violet-700 dark:text-violet-300 bg-violet-300 dark:bg-violet-600/30 px-2 pt-4 pb-1 mx-auto mt-[-14px] text-center rounded-lg"
          onClick={() => setSelectedTask(task)}
        >
          See results
        </div>
      )}
    </div>
  );
});