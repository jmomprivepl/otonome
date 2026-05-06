import { useState, useEffect, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import pyodideManager from '../python/pyodideManager';
import type { PythonResult } from '../python/types';

interface PythonNodeData {
  id: string;
  label: string;
  code: string;
  input?: any;
  onResultUpdate?: (result: any) => void;
}

export function PythonNode({ id, data, isConnectable }: NodeProps<PythonNodeData>) {
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [output, setOutput] = useState<{ stdout: string; stderr: string }>({ stdout: '', stderr: '' });
  const [error, setError] = useState<string | null>(null);

  // Handle Python execution results
  const handlePythonResult = useCallback((data: PythonResult) => {
    if (data.status === 'loading') {
      setStatus('loading');
    } else if (data.status === 'success') {
      setStatus('success');
      setResult(data.result);
      setOutput({
        stdout: data.stdout || '',
        stderr: data.stderr || ''
      });
      setError(null);
      
      // Notify parent component if callback is provided
      if (data.result && data.nodeId === id && data.result) {
        data.nodeId === id && data.result && data.nodeId === id.toString() && data.result;
      }
    } else if (data.status === 'error') {
      setStatus('error');
      setError(data.error || 'Unknown error');
    }
  }, [id]);

  // Register this node with the Pyodide manager
  useEffect(() => {
    pyodideManager.registerNode(handlePythonResult, id.toString());
    
    return () => {
      pyodideManager.unregisterNode(id.toString());
    };
  }, [id, handlePythonResult]);

  // Execute Python code when input changes
  useEffect(() => {
    if (data.code && data.input !== undefined) {
      setStatus('loading');
      
      // Create a context object to pass to Python
      const context = { input: data.input };
      
      // Execute the Python code
      pyodideManager.executePython(data.code, id.toString(), context);
    }
  }, [id, data.code, data.input]);

  // Manually execute the code
  const executeCode = () => {
    if (data.code) {
      setStatus('loading');
      pyodideManager.executePython(data.code, id.toString(), { input: data.input });
    }
  };

  return (
    <div className="bg-white border border-gray-300 rounded-md shadow-md p-4 w-64">
      <div className="font-medium text-gray-700 mb-2">{data.label || 'Python'}</div>
      
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        isConnectable={isConnectable}
        className="w-3 h-3 bg-blue-500"
      />
      
      {/* Status indicator */}
      <div className="flex items-center mb-2">
        <div 
          className={`w-3 h-3 rounded-full mr-2 ${status === 'idle' ? 'bg-gray-400' : 
            status === 'loading' ? 'bg-yellow-400' : 
            status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} 
        />
        <span className="text-xs text-gray-600">
          {status === 'idle' ? 'Ready' : 
           status === 'loading' ? 'Running...' : 
           status === 'success' ? 'Completed' : 'Error'}
        </span>
      </div>
      
      {/* Code preview */}
      <div className="bg-gray-100 p-2 rounded text-xs font-mono mb-2 max-h-24 overflow-y-auto">
        {data.code ? (
          <pre className="whitespace-pre-wrap">{data.code.length > 150 ? `${data.code.substring(0, 150)}...` : data.code}</pre>
        ) : (
          <span className="text-gray-500">No code</span>
        )}
      </div>
      
      {/* Execute button */}
      <button 
        onClick={executeCode}
        className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600 transition-colors mb-2"
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Running...' : 'Execute'}
      </button>
      
      {/* Output display */}
      {(output.stdout || output.stderr) && (
        <div className="mt-2">
          <div className="text-xs font-medium mb-1">Output:</div>
          <div className="bg-gray-100 p-2 rounded text-xs font-mono max-h-24 overflow-y-auto">
            {output.stdout && <pre className="whitespace-pre-wrap text-gray-800">{output.stdout}</pre>}
            {output.stderr && <pre className="whitespace-pre-wrap text-red-500">{output.stderr}</pre>}
          </div>
        </div>
      )}
      
      {/* Error display */}
      {error && (
        <div className="mt-2">
          <div className="text-xs font-medium text-red-500 mb-1">Error:</div>
          <div className="bg-red-50 p-2 rounded text-xs font-mono text-red-500 max-h-24 overflow-y-auto">
            <pre className="whitespace-pre-wrap">{error}</pre>
          </div>
        </div>
      )}
      
      {/* Result preview */}
      {result !== null && (
        <div className="mt-2">
          <div className="text-xs font-medium mb-1">Result:</div>
          <div className="bg-gray-100 p-2 rounded text-xs max-h-24 overflow-y-auto">
            {typeof result === 'object' ? (
              <pre className="whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
            ) : (
              <pre className="whitespace-pre-wrap">{String(result)}</pre>
            )}
          </div>
        </div>
      )}
      
      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        isConnectable={isConnectable}
        className="w-3 h-3 bg-blue-500"
      />
    </div>
  );
}
