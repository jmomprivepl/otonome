import { SubTask, TaskDecompositionResult, WorkflowManager as IWorkflowManager } from './types';
import { useKanbanStore } from '../store';
import { Task } from '../types';

// Singleton class to manage task decomposition workflows
class TaskWorkflowManager implements IWorkflowManager {
  private static instance: TaskWorkflowManager;
  private workflowResults: Map<string, TaskDecompositionResult> = new Map();
  private decompositionResults: Map<string, any> = new Map();
  private parentChildRelationships: Map<string, string[]> = new Map(); // Maps parent task ID to array of child task IDs
  private childParentRelationships: Map<string, string> = new Map(); // Maps child task ID to parent task ID
  private taskQueues: Map<string, string[]> = new Map(); // Maps parent task ID to ordered queue of subtask IDs
  private activeSubtasks: Map<string, string> = new Map(); // Maps parent task ID to currently active subtask ID
  private taskStatusObserver: number | null = null; // ID for the interval that checks task status changes

  private constructor() {
    // Try to load any saved results from localStorage
    try {
      const savedResults = localStorage.getItem('taskDecompositionResults');
      if (savedResults) {
        this.decompositionResults = new Map(JSON.parse(savedResults));
      }
    } catch (error) {
      console.error('Error loading saved decomposition results:', error);
    }
    
    // Start the task status observer
    this.startTaskStatusObserver();
  }

  public getSubtasks(taskId: string): SubTask[] {
    const store = useKanbanStore.getState();
    return store.tasks.filter(t => 
      'parentTaskId' in t && t.parentTaskId === taskId
    ) as SubTask[];
  }

  public static getInstance(): TaskWorkflowManager {
    if (!TaskWorkflowManager.instance) {
      TaskWorkflowManager.instance = new TaskWorkflowManager();
    }
    return TaskWorkflowManager.instance;
  }

  // Get subtasks for a specific parent task
  public getSubtasksForTask(taskId: string): SubTask[] {
    return this.getSubtasks(taskId);
  }

  // Check if a task has been decomposed
  public isTaskDecomposed(taskId: string): boolean {
    return this.workflowResults.has(taskId) || this.decompositionResults.has(taskId) || 
           this.parentChildRelationships.has(taskId) || this.getSubtasks(taskId).length > 0;
  }

  // Get workflow result for a task
  public getWorkflowResult(taskId: string): TaskDecompositionResult | undefined {
    return this.workflowResults.get(taskId);
  }

  // Store a decomposition result from a ChatNode
  public storeDecompositionResult(taskId: string, result: any): void {
    this.decompositionResults.set(taskId, result);
    
    // Save to localStorage for persistence
    try {
      localStorage.setItem('taskDecompositionResults', JSON.stringify(Array.from(this.decompositionResults.entries())));
    } catch (error) {
      console.error('Error saving decomposition results:', error);
    }
  }

  // Get a decomposition result for a task
  public getDecompositionResult(taskId: string): any {
    return this.decompositionResults.get(taskId);
  }

  // Check if a task has a decomposition result
  public hasDecompositionResult(taskId: string): boolean {
    return this.decompositionResults.has(taskId);
  }
  
  // Get the parent task ID for a given subtask ID
  public getParentTaskId(subtaskId: string): string | undefined {
    return this.childParentRelationships.get(subtaskId);
  }
  
  // Get all child task IDs for a given parent task ID
  public getChildTaskIds(parentTaskId: string): string[] {
    return this.parentChildRelationships.get(parentTaskId) || [];
  }
  
  // Check if all subtasks of a parent task are completed
  public areAllSubtasksCompleted(parentTaskId: string): boolean {
    const childIds = this.getChildTaskIds(parentTaskId);
    
    // If no child IDs found in the relationships map, try to get subtasks from the store
    if (childIds.length === 0) {
      const subtasks = this.getSubtasks(parentTaskId);
      if (subtasks.length === 0) return false;
      
      // Register these subtasks in our relationship maps for future reference
      subtasks.forEach(subtask => {
        this.registerParentChildRelationship(parentTaskId, subtask.id);
      });
      
      return subtasks.every(subtask => subtask.status === 'done');
    }
    
    const store = useKanbanStore.getState();
    const allCompleted = childIds.every(childId => {
      const childTask = store.tasks.find(t => t.id === childId);
      return childTask && childTask.status === 'done';
    });
    
    return allCompleted;
  }
  
  // Register a new parent-child relationship
  public registerParentChildRelationship(parentId: string, childId: string): void {
    // Update parent-child map
    const existingChildren = this.parentChildRelationships.get(parentId) || [];
    if (!existingChildren.includes(childId)) {
      this.parentChildRelationships.set(parentId, [...existingChildren, childId]);
    }
    
    // Update child-parent map
    this.childParentRelationships.set(childId, parentId);
  }
  
  // Initialize a task queue for a parent task
  public initializeTaskQueue(parentTaskId: string): void {
    const subtasks = this.getSubtasks(parentTaskId);
    if (subtasks.length === 0) return;
    
    // Sort subtasks by order if available, otherwise use the default order
    const sortedSubtasks = [...subtasks].sort((a, b) => {
      // If both have order, sort by order
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      // If only one has order, prioritize the one with order
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      // Otherwise, keep original order
      return 0;
    });
    
    // Create a dependency graph to ensure tasks are executed in the correct order
    const taskQueue: string[] = [];
    const visited = new Set<string>();
    const dependencyMap = new Map<string, string[]>();
    
    // Build dependency map
    sortedSubtasks.forEach(task => {
      dependencyMap.set(task.id, task.dependsOn || []);
    });
    
    // Topological sort function to respect dependencies
    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      
      const dependencies = dependencyMap.get(taskId) || [];
      dependencies.forEach(depId => {
        // Only visit dependencies that exist in our subtasks
        if (sortedSubtasks.some(t => t.id === depId)) {
          visit(depId);
        }
      });
      
      taskQueue.push(taskId);
    };
    
    // Visit all tasks to build the queue
    sortedSubtasks.forEach(task => {
      if (!visited.has(task.id)) {
        visit(task.id);
      }
    });
    
    // Store the queue
    this.taskQueues.set(parentTaskId, taskQueue);
    
    // Start the first task if none is active yet
    this.processNextTask(parentTaskId);
  }
  
  // Process the next task in the queue for a parent task
  private processNextTask(parentTaskId: string): void {
    const queue = this.taskQueues.get(parentTaskId);
    if (!queue || queue.length === 0) return;
    
    const store = useKanbanStore.getState();
    
    // Check if there's already an active subtask
    const activeSubtaskId = this.activeSubtasks.get(parentTaskId);
    if (activeSubtaskId) {
      const activeSubtask = store.tasks.find(t => t.id === activeSubtaskId);
      // If active subtask exists and is not done, don't proceed
      if (activeSubtask && activeSubtask.status !== 'done') return;
    }
    
    // Get the next task in the queue that's not done yet
    let nextTaskId: string | undefined;
    for (const taskId of queue) {
      const task = store.tasks.find(t => t.id === taskId) as Task | undefined;
      if (task && task.status !== 'done') {
        nextTaskId = taskId;
        break;
      }
    }
    
    if (!nextTaskId) return; // No more tasks to process
    
    // Set the next task as active and move it to inProgress
    this.activeSubtasks.set(parentTaskId, nextTaskId);
    const nextTask = store.tasks.find(t => t.id === nextTaskId);
    if (nextTask && nextTask.status === 'todo') {
      store.updateTask({
        ...nextTask,
        status: 'inProgress'
      });
    }
  }
  
  // Start observing task status changes
  private startTaskStatusObserver(): void {
    if (this.taskStatusObserver !== null) return; // Already running
    
    // Check every 2 seconds for task status changes
    this.taskStatusObserver = window.setInterval(() => {
      const store = useKanbanStore.getState();
      const tasks = store.tasks;
      
      // Check all active subtasks
      for (const [parentId, activeSubtaskId] of this.activeSubtasks.entries()) {
        const activeSubtask = tasks.find(t => t.id === activeSubtaskId);
        
        // If the active subtask is done, process the next one
        if (activeSubtask && activeSubtask.status === 'done') {
          this.processNextTask(parentId);
        }
      }
      
      // Check for any parent tasks with subtasks but no queue initialized
      for (const [parentId, _childIds] of this.parentChildRelationships.entries()) {
        if (!this.taskQueues.has(parentId)) {
          const parentTask = tasks.find(t => t.id === parentId);
          if (parentTask && parentTask.status === 'inProgress') {
            this.initializeTaskQueue(parentId);
          }
        }
      }
      
      // Also check for any tasks with parentTaskId that aren't in our relationships map
      const subtasks = tasks.filter(t => 'parentTaskId' in t && t.parentTaskId) as SubTask[];
      for (const subtask of subtasks) {
        const parentId = subtask.parentTaskId;
        if (!this.childParentRelationships.has(subtask.id)) {
          this.registerParentChildRelationship(parentId, subtask.id);
          
          // Initialize queue if parent is in progress and queue doesn't exist
          if (!this.taskQueues.has(parentId)) {
            const parentTask = tasks.find(t => t.id === parentId);
            if (parentTask && parentTask.status === 'inProgress') {
              this.initializeTaskQueue(parentId);
            }
          }
        }
      }
    }, 2000);
  }
  
  // Stop observing task status changes
  public stopTaskStatusObserver(): void {
    if (this.taskStatusObserver !== null) {
      window.clearInterval(this.taskStatusObserver);
      this.taskStatusObserver = null;
    }
  }
}

// Export the class and a singleton instance
export const workflowManager = TaskWorkflowManager.getInstance();

// Export a static accessor for the singleton
export const WorkflowManager = {
  getInstance: () => TaskWorkflowManager.getInstance()
};
