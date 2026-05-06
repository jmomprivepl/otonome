import type { PythonResult, PyodideWorkerMessage } from './types';
import workerManager from '../workers/workerManager';

class PyodideManager {
  private worker: Worker | null = null;
  private listeners: Map<string, (data: PythonResult) => void>;
  private isEnvironmentReady: boolean;
  private loadingPromise: Promise<void> | null;

  constructor() {
    this.listeners = new Map();
    this.isEnvironmentReady = false;
    this.loadingPromise = null;
  }

  /** Pyodide + its worker are very large; spawn only when Python is actually used. */
  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
    }
    return this.worker;
  }

  private handleWorkerMessage(e: MessageEvent) {
    const data = e.data as PythonResult;
    
    // Handle LLM requests from Python code
    if (data.type === 'llm_request' && data.prompt && data.requestId) {
      // Forward the request to the LLM worker
      this.handleLLMRequest(data.prompt, data.requestId);
      return;
    }
    
    // Route message to specific node if nodeId is present
    if (data.nodeId && this.listeners.has(data.nodeId)) {
      this.listeners.get(data.nodeId)!(data);
    } 
    
    // Broadcast status updates to all listeners
    if (data.status === 'loading' || data.status === 'ready' || data.status === 'reset') {
      this.listeners.forEach(listener => listener(data));
    }
    
    // Update environment status
    if (data.status === 'ready') {
      this.isEnvironmentReady = true;
    } else if (data.status === 'reset') {
      this.isEnvironmentReady = false;
    }
  }
  
  /**
   * Handle LLM requests from Python code
   */
  private handleLLMRequest(prompt: string, requestId: string): void {
    // Set up LLM request handler
    const llmNodeId = `llm-${requestId}`;
    
    // Register a callback for the LLM response
    workerManager.registerNode((data) => {
      // When we get a response from the LLM, forward it to the Python worker
      if (data.status === 'update' || data.status === 'complete') {
        this.ensureWorker().postMessage({
          type: 'llm_response',
          requestId,
          result: data.data || data.output || ''
        });
        
        // Clean up after completion
        if (data.status === 'complete') {
          workerManager.unregisterNode(llmNodeId);
        }
      } else if (data.status === 'error') {
        // Forward error to Python
        this.ensureWorker().postMessage({
          type: 'llm_response',
          requestId,
          error: data.error || 'Unknown error'
        });
        
        workerManager.unregisterNode(llmNodeId);
      }
    }, llmNodeId);
    
    // Format the messages for the LLM
    const messages = [
      { role: 'system', content: 'You are a helpful AI assistant.' },
      { role: 'user', content: prompt }
    ];
    
    // Send the request to the LLM worker
    workerManager.sendMessage(llmNodeId, {
      type: 'generate',
      messages: messages,
      modelConfig: {
        temperature: 0.7,
        top_k: 40,
        max_tokens: 1000
      }
    });
  }

  /**
   * Register a callback for a specific node
   */
  registerNode(callback: (data: PythonResult) => void, nodeId: string): string {
    this.listeners.set(nodeId, callback);
    // If environment is already ready, immediately notify the listener
    if (this.isEnvironmentReady) {
      callback({ status: 'ready', message: 'Pyodide environment ready', nodeId });
    }
    return nodeId;
  }

  /**
   * Unregister a node's callback
   */
  unregisterNode(nodeId: string): void {
    this.listeners.delete(nodeId);
  }

  /**
   * Send a message to the worker
   */
  sendMessage(message: PyodideWorkerMessage): void {
    this.ensureWorker().postMessage(message);
  }

  /**
   * Initialize the Pyodide environment
   */
  loadEnvironment(): Promise<void> {
    if (this.isEnvironmentReady) {
      return Promise.resolve();
    }
    
    if (!this.loadingPromise) {
      const w = this.ensureWorker();
      this.loadingPromise = new Promise<void>((resolve) => {
        const checkLoaded = (data: PythonResult) => {
          if (data.status === 'ready') {
            w.removeEventListener('message', checkLoaded as any);
            resolve();
          }
        };
        
        w.addEventListener('message', checkLoaded as any);
        w.postMessage({ type: 'load' });
      });
    }
    
    return this.loadingPromise;
  }

  /**
   * Execute Python code
   */
  async executePython(code: string, nodeId: string, context?: Record<string, any>): Promise<void> {
    if (!this.isEnvironmentReady) {
      await this.loadEnvironment();
    }
    
    this.ensureWorker().postMessage({
      type: 'execute',
      code,
      nodeId,
      context
    });
  }

  /**
   * Install a Python package using micropip
   */
  async installPackage(packageName: string, nodeId: string): Promise<void> {
    if (!this.isEnvironmentReady) {
      await this.loadEnvironment();
    }
    
    this.ensureWorker().postMessage({
      type: 'install',
      packageName,
      nodeId
    });
  }

  /**
   * Reset the Pyodide environment
   */
  resetEnvironment(): void {
    this.isEnvironmentReady = false;
    this.loadingPromise = null;
    this.listeners.clear();
    if (this.worker) {
      this.worker.postMessage({ type: 'reset' });
    }
  }
}

// Create a singleton instance
const pyodideManager = new PyodideManager();
export default pyodideManager;
