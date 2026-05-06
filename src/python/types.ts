// Type definitions for Pyodide integration

// Python proxy object
export interface PyProxy {
  toJs(options?: { create_proxies?: boolean; dict_converter?: any }): any;
  destroy(): void;
  type: string;
  // Add other PyProxy methods as needed
}

// Pyodide interface
export interface PyodideInterface {
  globals: {
    get(name: string): PyProxy;
    set(name: string, value: any): void;
  };
  runPython(code: string): PyProxy;
  runPythonAsync(code: string): Promise<PyProxy>;
  loadPackage(names: string | string[]): Promise<void>;
  loadPackagesFromImports(code: string): Promise<void>;
  toPy(obj: any, options?: { depth?: number }): PyProxy;
  pyimport(mod_name: string): PyProxy;
  registerJsModule(name: string, module: object): void;
  unregisterJsModule(name: string): void;
  setInterruptBuffer(buffer: Int32Array): void;
  // Add other Pyodide methods as needed
}

// Python execution result
export interface PythonResult {
  status: 'success' | 'error' | 'loading' | 'ready' | 'reset' | 'update' | 'complete';
  result?: any;
  stdout?: string;
  stderr?: string;
  error?: string;
  message?: string;
  nodeId?: string;
  // For task execution
  taskId?: string;
  // Additional context data passed to and from Python execution
  context?: Record<string, any>;
  // For LLM integration
  type?: string;
  prompt?: string;
  requestId?: string;
  data?: string;
  output?: string;
  // Flag to indicate if this is the final result of execution
  isFinalResult?: boolean;
}

// Python worker message types
export type PyodideWorkerMessage =
  | { type: 'load' }
  | { type: 'execute'; code: string; nodeId: string; context?: Record<string, any> }
  | { type: 'install'; packageName: string; nodeId: string }
  | { type: 'reset' }
  | { type: 'llm_request'; prompt: string; requestId: string }
  | { type: 'llm_response'; requestId: string; result?: string; error?: string };
