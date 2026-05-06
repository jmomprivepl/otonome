import workerManager from '../workers/workerManager';

// Interface for LLM requests
export interface LLMRequest {
  prompt: string;
  nodeId: string;
  callback: (response: string) => void;
  errorCallback: (error: any) => void;
}

/**
 * Bridge to connect Python/DSPy with the local LLM
 */
class LocalLLMBridge {
  private static instance: LocalLLMBridge;
  private activeRequests: Map<string, {
    callback: (response: string) => void;
    errorCallback: (error: any) => void;
  }>;
  
  private constructor() {
    this.activeRequests = new Map();
  }
  
  public static getInstance(): LocalLLMBridge {
    if (!LocalLLMBridge.instance) {
      LocalLLMBridge.instance = new LocalLLMBridge();
    }
    return LocalLLMBridge.instance;
  }
  
  /**
   * Initialize the LLM bridge
   */
  public initialize(): void {
    // Register a global callback for LLM responses
    workerManager.registerNode(this.handleLLMResponse.bind(this), 'llm-bridge');
  }
  
  /**
   * Handle responses from the LLM worker
   */
  private handleLLMResponse(data: any): void {
    // Check if this is a response for one of our active requests
    if (data.nodeId && this.activeRequests.has(data.nodeId)) {
      const request = this.activeRequests.get(data.nodeId);
      
      if (data.status === 'update' || data.status === 'complete') {
        // Pass the generated text to the callback
        request?.callback(data.data || data.output || '');
        
        // If the generation is complete, remove the request
        if (data.status === 'complete') {
          this.activeRequests.delete(data.nodeId);
        }
      } else if (data.status === 'error') {
        // Handle errors
        request?.errorCallback(data.error || 'Unknown error');
        this.activeRequests.delete(data.nodeId);
      }
    }
  }
  
  /**
   * Send a prompt to the LLM and get a response
   */
  public async generateText(request: LLMRequest): Promise<void> {
    try {
      // Make sure the model is loaded
      await workerManager.loadModel();
      
      // Store the callbacks for this request
      this.activeRequests.set(request.nodeId, {
        callback: request.callback,
        errorCallback: request.errorCallback
      });
      
      // Format the messages for the LLM
      const messages = [
        { role: 'system', content: 'You are a helpful AI assistant.' },
        { role: 'user', content: request.prompt }
      ];
      
      // Send the request to the worker
      workerManager.sendMessage(request.nodeId, {
        type: 'generate',
        messages: messages,
        modelConfig: {
          temperature: 0.7,
          top_k: 40,
          max_tokens: 1000
        }
      });
    } catch (error) {
      request.errorCallback(error);
    }
  }
  
  /**
   * Expose a method to be called from Python via Pyodide
   */
  public getPythonInterface() {
    const self = this;
    return {
      async generate_text(prompt: string, nodeId: string): Promise<string> {
        return new Promise((resolve, reject) => {
          self.generateText({
            prompt,
            nodeId: `python-${nodeId}`,
            callback: resolve,
            errorCallback: reject
          });
        });
      }
    };
  }
}

export default LocalLLMBridge.getInstance();
