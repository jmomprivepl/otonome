type QueuedNode = {
  nodeId: string;
  parentId?: string;
  initialMessage: string;
};

export class ChatNodeQueue {
  private static instance: ChatNodeQueue;
  private queue: QueuedNode[] = [];
  private processingNode: string | null = null;
  private subscribers: Map<string, (nodeId: string) => void> = new Map();

  private constructor() {}

  static getInstance(): ChatNodeQueue {
    if (!ChatNodeQueue.instance) {
      ChatNodeQueue.instance = new ChatNodeQueue();
    }
    return ChatNodeQueue.instance;
  }

  enqueueNode(nodeId: string, initialMessage: string, parentId?: string) {
    this.queue.push({ nodeId, initialMessage, parentId });
    this.processNextIfAvailable();
  }

  private processNextIfAvailable() {
    if (this.processingNode === null && this.queue.length > 0) {
      const nextNode = this.queue[0];
      this.processingNode = nextNode.nodeId;
      const subscriber = this.subscribers.get(nextNode.nodeId);
      if (subscriber) {
        subscriber(nextNode.nodeId);
      }
    }
  }

  markNodeComplete(nodeId: string) {
    if (this.processingNode === nodeId) {
      this.queue = this.queue.filter(node => node.nodeId !== nodeId);
      this.processingNode = null;
      this.processNextIfAvailable();
    }
  }

  subscribeToQueue(nodeId: string, callback: (nodeId: string) => void) {
    this.subscribers.set(nodeId, callback);
  }

  unsubscribeFromQueue(nodeId: string) {
    this.subscribers.delete(nodeId);
  }

  isNodeProcessing(nodeId: string): boolean {
    return this.processingNode === nodeId;
  }

  getQueuePosition(nodeId: string): number {
    return this.queue.findIndex(node => node.nodeId === nodeId);
  }
  
  /**
   * Resets the queue, clearing all nodes and processing state
   * Used when unmounting components to ensure a clean state
   */
  reset(): void {
    this.queue = [];
    this.processingNode = null;
    // Keep subscribers intact as they will be cleaned up by their respective components
  }
}
