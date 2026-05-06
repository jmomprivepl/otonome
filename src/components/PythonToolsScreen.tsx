import { useState, useEffect } from 'react';
import { Header } from './Header';
import pyodideManager from '../python/pyodideManager';
import type { PythonResult } from '../python/types';

interface PythonToolsScreenProps {
  sidebarCollapsed: boolean;
}

interface PythonTool {
  id: string;
  name: string;
  description: string;
  code: string;
  isBuiltin?: boolean;
}

export function PythonToolsScreen({ sidebarCollapsed }: PythonToolsScreenProps) {
  const [tools, setTools] = useState<PythonTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<PythonTool | null>(null);
  const [newToolName, setNewToolName] = useState('');
  const [newToolDescription, setNewToolDescription] = useState('');
  const [newToolCode, setNewToolCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [output, setOutput] = useState<{ stdout: string; stderr: string }>({ stdout: '', stderr: '' });
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [environmentStatus, setEnvironmentStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Default built-in tools
  const builtinTools: PythonTool[] = [
    {
      id: 'text-processing',
      name: 'Text Processing',
      description: 'Basic text processing utilities',
      code: `import re

def tokenize(text):
    """Split text into tokens"""
    return text.split()

def count_words(text):
    """Count words in text"""
    return len(tokenize(text))

def extract_emails(text):
    """Extract email addresses from text"""
    # More precise pattern that only captures the email address itself
    pattern = r'([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)'
    # Find all matches using the more precise pattern with capture groups
    matches = re.findall(pattern, text)
    # Ensure we're only returning the email addresses themselves
    return [email for email in matches if '@' in email]

# Use the input from JavaScript
if 'input' in js_context:
    input_text = js_context['input']
    result = {
        'tokens': tokenize(input_text),
        'word_count': count_words(input_text),
        'emails': extract_emails(input_text)
    }
else:
    result = {'error': 'No input provided'}
`,
      isBuiltin: true
    },
    {
      id: 'data-analysis',
      name: 'Data Analysis',
      description: 'Simple data analysis with NumPy',
      code: `import numpy as np

def analyze_numbers(numbers):
    """Analyze a list of numbers"""
    if not numbers:
        return {'error': 'Empty list'}
    
    arr = np.array(numbers)
    return {
        'mean': float(np.mean(arr)),
        'median': float(np.median(arr)),
        'std': float(np.std(arr)),
        'min': float(np.min(arr)),
        'max': float(np.max(arr))
    }

# Parse input from JavaScript
if 'input' in js_context:
    try:
        input_text = js_context['input']
        # Try to parse as comma-separated numbers
        numbers = [float(x.strip()) for x in input_text.split(',') if x.strip()]
        result = analyze_numbers(numbers)
    except Exception as e:
        result = {'error': str(e)}
else:
    result = {'error': 'No input provided'}
`,
      isBuiltin: true
    }
  ];

  // Initialize tools with built-in tools
  useEffect(() => {
    // Load tools from localStorage
    const savedTools = localStorage.getItem('pythonTools');
    if (savedTools) {
      try {
        const parsedTools = JSON.parse(savedTools);
        setTools([...builtinTools, ...parsedTools]);
      } catch (e) {
        console.error('Error loading saved tools:', e);
        setTools(builtinTools);
      }
    } else {
      setTools(builtinTools);
    }
    setIsLoading(false);

    // Initialize Pyodide
    initPyodide();
  }, []);

  // Save tools to localStorage when they change
  useEffect(() => {
    if (!isLoading) {
      // Only save custom tools (not built-in ones)
      const customTools = tools.filter(tool => !tool.isBuiltin);
      localStorage.setItem('pythonTools', JSON.stringify(customTools));
    }
  }, [tools, isLoading]);

  // Initialize Pyodide
  const initPyodide = async () => {
    setEnvironmentStatus('loading');
    
    // Register a callback to receive status updates
    const nodeId = 'python-tools-screen';
    pyodideManager.registerNode((data: PythonResult) => {
      if (data.status === 'ready') {
        setEnvironmentStatus('ready');
      } else if (data.status === 'error') {
        setEnvironmentStatus('error');
        setError(data.error || 'Failed to initialize Python environment');
      } else if (data.status === 'success' && data.nodeId === nodeId) {
        console.log('Received execution result:', data);
        setIsExecuting(false);
        setResult(data.result);
        setOutput({
          stdout: data.stdout || '',
          stderr: data.stderr || ''
        });
        setError(null);
      }
    }, nodeId);
    
    // Load the Pyodide environment
    try {
      await pyodideManager.loadEnvironment();
    } catch (e) {
      setEnvironmentStatus('error');
      setError(`Failed to initialize Python environment: ${e}`);
    }
    
    return () => {
      pyodideManager.unregisterNode(nodeId);
    };
  };

  // Create a new tool
  const handleCreateTool = () => {
    if (!newToolName.trim()) {
      setError('Tool name is required');
      return;
    }
    
    const newTool: PythonTool = {
      id: `tool-${Date.now()}`,
      name: newToolName,
      description: newToolDescription,
      code: newToolCode
    };
    
    setTools([...tools, newTool]);
    setNewToolName('');
    setNewToolDescription('');
    setNewToolCode('');
    setIsCreating(false);
    setError(null);
  };

  // Update an existing tool
  const handleUpdateTool = () => {
    if (!selectedTool) return;
    if (!newToolName.trim()) {
      setError('Tool name is required');
      return;
    }
    
    const updatedTools = tools.map(tool => 
      tool.id === selectedTool.id 
        ? { ...tool, name: newToolName, description: newToolDescription, code: newToolCode }
        : tool
    );
    
    setTools(updatedTools);
    setSelectedTool(null);
    setNewToolName('');
    setNewToolDescription('');
    setNewToolCode('');
    setIsEditing(false);
    setError(null);
  };

  // Delete a tool
  const handleDeleteTool = (id: string) => {
    const toolToDelete = tools.find(tool => tool.id === id);
    if (toolToDelete?.isBuiltin) {
      setError('Cannot delete built-in tools');
      return;
    }
    
    const updatedTools = tools.filter(tool => tool.id !== id);
    setTools(updatedTools);
    
    if (selectedTool?.id === id) {
      setSelectedTool(null);
      setIsEditing(false);
    }
  };

  // Select a tool for editing or viewing
  const handleSelectTool = (tool: PythonTool) => {
    setSelectedTool(tool);
    setNewToolName(tool.name);
    setNewToolDescription(tool.description);
    setNewToolCode(tool.code);
    setIsEditing(false);
    setError(null);
    setResult(null);
    setOutput({ stdout: '', stderr: '' });
  };

  // Execute the selected tool's code
  const handleExecuteCode = async () => {
    if (!selectedTool) return;
    
    setIsExecuting(true);
    setResult(null);
    setOutput({ stdout: '', stderr: '' });
    setError(null);
    
    const nodeId = 'python-tools-screen';
    const context = { input: testInput };
    
    try {
      // Register a one-time listener for this specific execution
      const resultPromise = new Promise((resolve) => {
        const handleResult = (data: PythonResult) => {
          if (data.status === 'success' && data.nodeId === nodeId) {
            console.log('Direct execution result:', data);
            setResult(data.result);
            setOutput({
              stdout: data.stdout || '',
              stderr: data.stderr || ''
            });
            resolve(data);
          } else if (data.status === 'error' && data.nodeId === nodeId) {
            setError(`Error: ${data.error}`);
            resolve(data);
          }
        };
        
        // Add temporary listener
        pyodideManager.registerNode(handleResult, `${nodeId}-temp`);
        
        // Clean up after 10 seconds (timeout)
        setTimeout(() => {
          pyodideManager.unregisterNode(`${nodeId}-temp`);
          resolve(null);
        }, 10000);
      });
      
      // Execute the Python code
      await pyodideManager.executePython(selectedTool.code, nodeId, context);
      
      // Wait for result or timeout
      await resultPromise;
    } catch (e) {
      setIsExecuting(false);
      setError(`Error executing code: ${e}`);
    } finally {
      setIsExecuting(false);
      pyodideManager.unregisterNode(`${nodeId}-temp`);
    }
  };

  // Reset the Pyodide environment
  const handleResetEnvironment = () => {
    setEnvironmentStatus('loading');
    pyodideManager.resetEnvironment();
    // Re-initialize after reset
    initPyodide();
  };

  return (
    <div className={`flex flex-col h-screen ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
      <Header showAgents={false} sidebarCollapsed={sidebarCollapsed} />
      
      <div className="flex flex-1 overflow-hidden mt-20">
        {/* Tools sidebar */}
        <div className="w-64 bg-gray-100 border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-medium">Tools</h2>
            <p className="text-sm text-gray-500 mt-1">Create and manage Python tools</p>
            
            <button
              onClick={() => {
                setIsCreating(true);
                setIsEditing(false);
                setSelectedTool(null);
                setNewToolName('');
                setNewToolDescription('');
                setNewToolCode('');
                setError(null);
              }}
              className="mt-3 w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors"
            >
              Create New Tool
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {tools.map(tool => (
              <div 
                key={tool.id}
                onClick={() => handleSelectTool(tool)}
                className={`p-3 rounded cursor-pointer mb-2 ${selectedTool?.id === tool.id ? 'bg-blue-100 border border-blue-300' : 'bg-white border border-gray-200 hover:bg-gray-50'}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{tool.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">{tool.description}</p>
                  </div>
                  {tool.isBuiltin && (
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                      Built-in
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* Environment status */}
          <div className="p-3 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center mb-2">
              <div 
                className={`w-3 h-3 rounded-full mr-2 ${environmentStatus === 'loading' ? 'bg-yellow-400' : environmentStatus === 'ready' ? 'bg-green-500' : 'bg-red-500'}`} 
              />
              <span className="text-sm">
                {environmentStatus === 'loading' ? 'Loading Python...' : 
                 environmentStatus === 'ready' ? 'Python Ready' : 'Python Error'}
              </span>
            </div>
            
            <div className="flex space-x-2">
              <button 
                onClick={handleResetEnvironment}
                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 rounded transition-colors"
                disabled={environmentStatus === 'loading'}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
        
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {isCreating ? (
            <div className="flex-1 p-6 overflow-y-auto">
              <h2 className="text-xl font-medium mb-4">Create New Tool</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                  placeholder="Tool name"
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={newToolDescription}
                  onChange={(e) => setNewToolDescription(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                  placeholder="What does this tool do?"
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Python Code</label>
                <textarea
                  value={newToolCode}
                  onChange={(e) => setNewToolCode(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded font-mono text-sm h-64"
                  placeholder="# Your Python code here\n\n# Access input with js_context['input']\n# Return results by setting the 'result' variable"
                />
              </div>
              
              {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
                  {error}
                </div>
              )}
              
              <div className="flex space-x-3">
                <button
                  onClick={handleCreateTool}
                  className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors"
                >
                  Create Tool
                </button>
                
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setError(null);
                  }}
                  className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : selectedTool ? (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-medium">{isEditing ? 'Edit Tool' : selectedTool.name}</h2>
                
                <div className="flex space-x-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="bg-gray-200 text-gray-700 py-1 px-3 rounded hover:bg-gray-300 transition-colors"
                        disabled={selectedTool.isBuiltin}
                      >
                        Edit
                      </button>
                      
                      <button
                        onClick={() => handleDeleteTool(selectedTool.id)}
                        className="bg-red-500 text-white py-1 px-3 rounded hover:bg-red-600 transition-colors"
                        disabled={selectedTool.isBuiltin}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              {isEditing ? (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      value={newToolName}
                      onChange={(e) => setNewToolName(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      value={newToolDescription}
                      onChange={(e) => setNewToolDescription(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Python Code</label>
                    <textarea
                      value={newToolCode}
                      onChange={(e) => setNewToolCode(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded font-mono text-sm h-64"
                    />
                  </div>
                  
                  {error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
                      {error}
                    </div>
                  )}
                  
                  <div className="flex space-x-3">
                    <button
                      onClick={handleUpdateTool}
                      className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors"
                    >
                      Save Changes
                    </button>
                    
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setNewToolName(selectedTool.name);
                        setNewToolDescription(selectedTool.description);
                        setNewToolCode(selectedTool.code);
                        setError(null);
                      }}
                      className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
                    <p className="text-sm text-gray-600">{selectedTool.description}</p>
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-gray-700 mb-1">Python Code</h3>
                    <pre className="bg-gray-100 p-3 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap">
                      {selectedTool.code}
                    </pre>
                  </div>
                  
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-lg font-medium mb-3 flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                      </svg>
                      Test Tool
                    </h3>
                    
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                      <div className="flex flex-col space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Input</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={testInput}
                            onChange={(e) => setTestInput(e.target.value)}
                            className="flex-1 p-2 border border-gray-300 rounded"
                            placeholder="Enter test input here"
                          />
                          <button
                            onClick={handleExecuteCode}
                            disabled={isExecuting || environmentStatus !== 'ready'}
                            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors disabled:bg-blue-300 flex items-center gap-2 whitespace-nowrap"
                          >
                            {isExecuting ? (
                              <>
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Executing...
                              </>
                            ) : (
                              <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                </svg>
                                Execute
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {error && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <div>{error}</div>
                      </div>
                    )}
                    
                    <div className="grid grid-cols-1 gap-4">
                      {result !== null && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                            </svg>
                            Result
                          </h4>
                          <pre className="bg-white p-3 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap border border-blue-100">
                            {typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)}
                          </pre>
                        </div>
                      )}
                      
                      {(output.stdout || output.stderr) && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                            </svg>
                            Console Output
                          </h4>
                          {output.stdout && (
                            <div className="mb-2">
                              <div className="text-xs text-gray-500 mb-1">Standard Output:</div>
                              <pre className="bg-white p-3 rounded font-mono text-sm overflow-x-auto whitespace-pre-wrap border border-gray-200">
                                {output.stdout}
                              </pre>
                            </div>
                          )}
                          {output.stderr && (
                            <div>
                              <div className="text-xs text-red-500 mb-1">Standard Error:</div>
                              <pre className="bg-red-50 p-3 rounded font-mono text-sm text-red-600 overflow-x-auto whitespace-pre-wrap border border-red-100">
                                {output.stderr}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center p-6">
                <h2 className="text-xl font-medium mb-2">Python Tools</h2>
                <p className="text-gray-500 mb-4">Select a tool from the sidebar or create a new one</p>
                <button
                  onClick={() => {
                    setIsCreating(true);
                    setIsEditing(false);
                    setSelectedTool(null);
                    setNewToolName('');
                    setNewToolDescription('');
                    setNewToolCode('');
                  }}
                  className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition-colors"
                >
                  Create New Tool
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
