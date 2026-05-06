import pyodideManager from './pyodideManager';
import type { PythonResult } from './types';

// Define the Python tool interface
export interface PythonTool {
  id: string;
  name: string;
  description: string;
  code: string;
  isBuiltin?: boolean;
}

// Define the execution result interface
export interface PythonExecutionResult {
  result: any;
  stdout: string;
  stderr: string;
  error?: string;
}

class PythonToolsService {
  private tools: Map<string, PythonTool>;
  private listeners: Map<string, (result: PythonExecutionResult) => void>;
  
  constructor() {
    this.tools = new Map();
    this.listeners = new Map();
    
    // Load tools from localStorage
    this.loadTools();
  }
  
  // Load tools from localStorage
  private loadTools(): void {
    try {
      const savedTools = localStorage.getItem('pythonTools');
      if (savedTools) {
        const parsedTools = JSON.parse(savedTools) as PythonTool[];
        parsedTools.forEach(tool => {
          this.tools.set(tool.id, tool);
        });
      }
    } catch (e) {
      console.error('Error loading Python tools:', e);
    }
  }
  
  // Save tools to localStorage
  private saveTools(): void {
    try {
      // Only save custom tools (not built-in ones)
      const customTools = Array.from(this.tools.values())
        .filter(tool => !tool.isBuiltin);
      
      localStorage.setItem('pythonTools', JSON.stringify(customTools));
    } catch (e) {
      console.error('Error saving Python tools:', e);
    }
  }
  
  // Get all tools
  getAllTools(): PythonTool[] {
    return Array.from(this.tools.values());
  }
  
  // Get a tool by ID
  getToolById(id: string): PythonTool | undefined {
    return this.tools.get(id);
  }
  
  // Add a new tool
  addTool(tool: Omit<PythonTool, 'id'>): PythonTool {
    const id = `tool-${Date.now()}`;
    const newTool: PythonTool = { ...tool, id };
    
    this.tools.set(id, newTool);
    this.saveTools();
    
    return newTool;
  }
  
  // Update an existing tool
  updateTool(id: string, updates: Partial<Omit<PythonTool, 'id'>>): PythonTool | null {
    const tool = this.tools.get(id);
    if (!tool) return null;
    
    // Don't allow updating built-in tools
    if (tool.isBuiltin) {
      throw new Error('Cannot modify built-in tools');
    }
    
    const updatedTool = { ...tool, ...updates };
    this.tools.set(id, updatedTool);
    this.saveTools();
    
    return updatedTool;
  }
  
  // Delete a tool
  deleteTool(id: string): boolean {
    const tool = this.tools.get(id);
    if (!tool) return false;
    
    // Don't allow deleting built-in tools
    if (tool.isBuiltin) {
      throw new Error('Cannot delete built-in tools');
    }
    
    const result = this.tools.delete(id);
    if (result) {
      this.saveTools();
    }
    
    return result;
  }
  
  // Register built-in tools
  registerBuiltinTools(tools: PythonTool[]): void {
    tools.forEach(tool => {
      // Ensure the tool is marked as built-in
      const builtinTool = { ...tool, isBuiltin: true };
      this.tools.set(tool.id, builtinTool);
    });
  }
  
  // Execute a Python tool
  async executeTool(
    toolId: string, 
    input: any, 
    callback?: (result: PythonExecutionResult) => void
  ): Promise<string> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new Error(`Tool with ID ${toolId} not found`);
    }
    
    // Generate a unique execution ID
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Register callback if provided
    if (callback) {
      this.listeners.set(executionId, callback);
    }
    
    // Register with Pyodide manager
    pyodideManager.registerNode((data: PythonResult) => {
      if (data.nodeId === executionId) {
        const result: PythonExecutionResult = {
          result: data.result,
          stdout: data.stdout || '',
          stderr: data.stderr || '',
          error: data.status === 'error' ? data.error : undefined
        };
        
        // Call the callback if registered
        const listener = this.listeners.get(executionId);
        if (listener) {
          listener(result);
          // Remove the listener after execution
          this.listeners.delete(executionId);
        }
      }
    }, executionId);
    
    // Execute the tool
    await pyodideManager.executePython(tool.code, executionId, { input });
    
    return executionId;
  }
  
  // Install a Python package
  async installPackage(packageName: string): Promise<void> {
    const executionId = `install-${Date.now()}`;
    await pyodideManager.installPackage(packageName, executionId);
  }
  
  // Initialize the Python environment
  async initializePythonEnvironment(): Promise<void> {
    await pyodideManager.loadEnvironment();
  }
  
  // Reset the Python environment
  resetPythonEnvironment(): void {
    pyodideManager.resetEnvironment();
  }
}

// Create a singleton instance
const pythonToolsService = new PythonToolsService();
export default pythonToolsService;
