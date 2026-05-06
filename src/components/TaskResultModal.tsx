import { useState, useEffect, useRef, useCallback } from 'react';
import { TaskResult, TaskResultView } from './TaskResultView';
import pyodideManager from '@/python/pyodideManager';
import type { PythonResult } from '@/python/types';

interface TaskResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdateResult?: (result: TaskResult) => void;
  result?: TaskResult;
  taskTitle: string;
  taskDescription: string;
  taskId?: string;
  onExecutePython?: (code: string, taskId?: string) => void;
  assignedWorkmate?: {
    id: string;
    name: string;
    avatar: string;
  };
}

export function TaskResultModal({ isOpen, onClose, result, taskTitle, taskDescription, taskId, onExecutePython, assignedWorkmate }: TaskResultModalProps) {
  // State to track the current result
  const [currentResult, setCurrentResult] = useState<TaskResult | undefined>(result);
  // Create a ref to hold the latest stdout/stderr as it streams in
  const pythonOutputRef = useRef<{stdout: string, stderr: string}>({stdout: '', stderr: ''});
  // State to track if Python is currently executing
  const [isPythonExecuting, setIsPythonExecuting] = useState(false);
  // Ref to store unsubscribe function for proper cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Generate a unique node ID for this modal instance
  const pythonNodeId = useRef(`python-modal-${taskId || Math.random().toString(36).substring(2, 9)}`);
  // Store the current Python code being executed
  const codeRef = useRef('');
  // State for live output
  const [liveOutput, setLiveOutput] = useState<string>('');

  // Custom Python execution handler with live updates
  const handleExecutePython = useCallback((code: string, id?: string) => {
    if (!code) return;
    
    // Store code in ref for access in other functions
    codeRef.current = code;
    
    // Clear any previous results and set executing state
    pythonOutputRef.current = {stdout: '', stderr: ''};
    setIsPythonExecuting(true);
    
    // Create interim result with 'executing' state
    if (currentResult?.type === 'python' && currentResult.data.python) {
      setCurrentResult({
        ...currentResult,
        data: {
          python: {
            ...currentResult.data.python,
            code: code,
            output: 'Executing Python code...'
          }
        }
      });
    } else {
      // Initialize a new Python result if none exists
      setCurrentResult({
        type: 'python',
        data: {
          python: {
            code: code,
            output: 'Executing Python code...'
          }
        }
      });
    }
    
    // Register a callback to receive streamed output
    pyodideManager.registerNode((data: PythonResult) => {
      
      // Process streamed stdout/stderr output for live updates
      if ((data.type === 'stdout' || data.type === 'stderr') && data.output && data.nodeId === pythonNodeId.current) {
        
        // Update the ref for internal tracking if needed
        pythonOutputRef.current[data.type] += data.output;
        
        // Update liveOutput state for the terminal
        setLiveOutput(prevOutput => prevOutput + data.output);
        
        // Let's try updating currentResult directly here to force re-render
        // This might be inefficient but helps diagnose rendering issues
        setCurrentResult(prev => {
          if (!prev || prev.type !== 'python') return prev; // Should not happen if execution started
          // Create a new python data object to ensure reference changes
          const newPythonData = {
            ...(prev.data?.python || {}),
            // Append to existing output or start new
            output: (prev.data?.python?.output || '') + data.output,
            // Ensure code is always a string
            code: prev.data?.python?.code || ''
          };
          return { ...prev, data: { ...prev.data, python: newPythonData } };
        });
      } 
      // Handle final success result
      else if (data.status === 'success' && data.nodeId === pythonNodeId.current && data.isFinalResult) {
        
        // Make sure we have the final stdout/stderr
        if (data.stdout) pythonOutputRef.current.stdout = data.stdout;
        if (data.stderr) pythonOutputRef.current.stderr = data.stderr;
        
        // Mark execution as complete
        setIsPythonExecuting(false);
        
        // If the task was updated in the store, also update it there
        if (taskId && onExecutePython) {
          onExecutePython(code, taskId);
        }
        
        // Clean up the node
        pyodideManager.unregisterNode(pythonNodeId.current);
      } 
      // Handle execution errors
      else if ((data.status === 'error' || data.error) && data.nodeId === pythonNodeId.current) {
        console.error('Python execution error:', data.error);
        
        // Add error to stderr
        pythonOutputRef.current.stderr += data.error || 'An error occurred during execution';
        
        // Mark execution as complete
        setIsPythonExecuting(false);
        
        // Clean up the node
        pyodideManager.unregisterNode(pythonNodeId.current);
      }
    }, pythonNodeId.current);
    
    // Execute the Python code
    pyodideManager.executePython(code, pythonNodeId.current, { taskId: id });
  }, [taskId, onExecutePython]);

  // Update current result when the prop changes and clear Python state
  useEffect(() => {
    setCurrentResult(result);
    setIsPythonExecuting(false);
    pythonOutputRef.current = {stdout: '', stderr: ''};
    setLiveOutput('');
  }, [result]);

  // Clean up subscriptions when modal closes or component unmounts
  useEffect(() => {
    return () => {
      // Cleanup Python node registration
      pyodideManager.unregisterNode(pythonNodeId.current);
      
      // Cleanup store subscription if exists
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 text-gray-800 dark:text-gray-200">
      <div className="bg-white dark:bg-slate-800 rounded-lg p-6 h-[90vh] overflow-auto w-[70%]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Task Result: {taskTitle}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>

        <div className="mb-6">
          <div className="mb-4">
            <h3 className="font-medium mb-1">Description:</h3>
            <p>{taskDescription}</p>
          </div>
          
          {assignedWorkmate && (
            <div className="flex items-center mb-4">
              <h3 className="font-medium mr-2">Completed by:</h3>
              <div className="flex items-center">
                <img 
                  src={assignedWorkmate.avatar} 
                  className="w-6 h-6 rounded-full mr-2"
                  alt={assignedWorkmate.name}
                />
                <span className="text-gray-600 dark:text-gray-200">{assignedWorkmate.name}</span>
              </div>
            </div>
          )}

          {(result || currentResult) && (
            <div>
              <h3 className="font-medium text-gray-800 mb-2">Result:</h3>
              <TaskResultView 
                result={currentResult ?? result!} 
                onExecutePython={handleExecutePython} 
                taskId={taskId}
                isExecuting={isPythonExecuting}
                liveOutput={liveOutput}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}