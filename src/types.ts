import { TaskResult } from '@/components/TaskResultView';

export type ProjectStatus = 'planned' | 'in-progress' | 'finished';

export interface Project {
  id: string;
  name: string;
  department: 'Marketing' | 'HR' | 'Finance';
  description: string;
  startDate: string;
  endDate: string;
  status?: ProjectStatus;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  project: string;
  status: 'draft' | 'todo' | 'inProgress' | 'done';
  priority: 'low' | 'medium' | 'high';
  dueDate: string;
  assignedAgents: string[];
  suggestedAgent?: string;
  result?: TaskResult;
  completedDate?: string;
  isDecomposed?: boolean;
  parentTaskId?: string;
  /** Hidden from board/list until restored (optional). */
  archived?: boolean;
  /** Optional link to persisted `AgentSopRecord.id` for task-scoped workflows. */
  sopId?: string;
}