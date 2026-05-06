import { Task } from '../types';

export interface SubTask extends Task {
  parentTaskId: string;
  dependsOn?: string[]; // IDs of subtasks this task depends on
  order?: number; // Order in the workflow sequence
}

export interface TaskDecompositionResult {
  parentTaskId: string;
  subtasks: SubTask[];
  workflow: {
    name: string;
    description: string;
  };
}

export interface WorkflowManager {
  getSubtasksForTask: (taskId: string) => SubTask[];
}
