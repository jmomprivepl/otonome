import { useState, useEffect } from 'react';
import { Filter, X } from 'lucide-react';
import { Task } from '../types';
import { useKanbanStore } from '../store';
import { TaskListItem } from './TaskListItem';

interface TaskListViewProps {
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onSelectTask: (task: Task) => void;
  onStartTask: (taskId: string) => void;
  onUpdateTaskStatus?: (taskId: string, newStatus: Task['status']) => void;
}

export function TaskListView({ tasks, onEditTask, onSelectTask, onUpdateTaskStatus }: TaskListViewProps) {
  const { agents, projects } = useKanbanStore();
  const [sortField, setSortField] = useState<keyof Task>('dueDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filteredTasks, setFilteredTasks] = useState<Task[]>(tasks);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<Task['priority'] | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<string | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string | 'all'>('all');
  
  // Update filtered tasks when filters or tasks change
  useEffect(() => {
    let result = [...tasks];
    
    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter(task => task.status === statusFilter);
    }
    
    // Apply priority filter
    if (priorityFilter !== 'all') {
      result = result.filter(task => task.priority === priorityFilter);
    }
    
    // Apply agent filter
    if (agentFilter !== 'all') {
      result = result.filter(task => task.assignedAgents.includes(agentFilter));
    }
    
    // Apply project filter
    if (projectFilter !== 'all') {
      result = result.filter(task => task.project === projectFilter);
    }
    
    setFilteredTasks(result);
  }, [tasks, statusFilter, priorityFilter, agentFilter, projectFilter]);



  // Sort tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    // Handle special case for status
    if (sortField === 'status') {
      const statusOrder = { draft: 0, todo: 1, inProgress: 2, done: 3 };
      const aValue = statusOrder[a.status];
      const bValue = statusOrder[b.status];
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    
    // Handle special case for priority
    if (sortField === 'priority') {
      const priorityOrder = { low: 0, medium: 1, high: 2 };
      const aValue = priorityOrder[a.priority];
      const bValue = priorityOrder[b.priority];
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }

    // Handle dates
    if (sortField === 'dueDate' || sortField === 'completedDate') {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    // Handle string fields
    const aValue = String(a[sortField] || '');
    const bValue = String(b[sortField] || '');
    return sortDirection === 'asc' 
      ? aValue.localeCompare(bValue)
      : bValue.localeCompare(aValue);
  });

  // Handle sort click
  const handleSortClick = (field: keyof Task) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Render sort indicator
  const renderSortIndicator = (field: keyof Task) => {
    if (sortField !== field) return null;
    return (
      <span className="ml-1">
        {sortDirection === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  // Handle status change
  const handleStatusChange = (taskId: string, newStatus: Task['status']) => {
    if (onUpdateTaskStatus) {
      onUpdateTaskStatus(taskId, newStatus);
    }
  };
  
  // Reset all filters
  const resetFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setAgentFilter('all');
    setProjectFilter('all');
  };
  
  return (
    <div className="bg-white/30 dark:bg-blue-950/30 backdrop-blur-sm p-4 rounded-xl 
      border border-violet-200/50 dark:border-blue-800/50 
      shadow-xl shadow-violet-200/20 dark:shadow-blue-900/20">
      
      {/* Filter controls */}
      <div className="mb-4 flex justify-between items-center">
        <div className="flex items-center">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center px-3 py-1.5 bg-white/50 dark:bg-blue-950/50 backdrop-blur-sm rounded-lg 
              border border-violet-200/50 dark:border-blue-800/50 shadow-sm
              hover:bg-violet-50 dark:hover:bg-blue-900/30 transition-colors"
          >
            <Filter className="h-4 w-4 mr-1.5 text-violet-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </span>
          </button>
          
          {(statusFilter !== 'all' || priorityFilter !== 'all' || agentFilter !== 'all' || projectFilter !== 'all') && (
            <button
              onClick={resetFilters}
              className="ml-2 flex items-center px-3 py-1.5 bg-white/50 dark:bg-blue-950/50 backdrop-blur-sm rounded-lg 
                border border-violet-200/50 dark:border-blue-800/50 shadow-sm
                hover:bg-violet-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              <X className="h-4 w-4 mr-1.5 text-red-600 dark:text-red-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Clear Filters
              </span>
            </button>
          )}
        </div>
        
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Showing {filteredTasks.length} of {tasks.length} tasks
        </div>
      </div>
      
      {/* Filter options */}
      {showFilters && (
        <div className="mb-4 p-3 bg-white/50 dark:bg-blue-950/50 backdrop-blur-sm rounded-lg 
          border border-violet-200/50 dark:border-blue-800/50 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3">
          
          {/* Status filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Task['status'] | 'all')}
              className="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-gray-600 
                rounded-md text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="todo">To Do</option>
              <option value="inProgress">In Progress</option>
              <option value="done">Done</option>
            </select>
          </div>
          
          {/* Priority filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Task['priority'] | 'all')}
              className="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-gray-600 
                rounded-md text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="all">All Priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          
          {/* Agent filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Assigned Agent</label>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-gray-600 
                rounded-md text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="all">All Agents</option>
              {agents.map(agent => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          
          {/* Project filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Project</label>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full px-2 py-1.5 text-sm bg-white dark:bg-slate-700 border border-gray-300 dark:border-gray-600 
                rounded-md text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="all">All Projects</option>
              {projects.map(project => (
                <option key={project.id} value={project.name}>{project.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      
      <table className="min-w-full divide-y divide-violet-200/50 dark:divide-blue-800/50">
        <thead>
          <tr>
            <th 
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSortClick('status')}
            >
              Status {renderSortIndicator('status')}
            </th>
            <th 
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSortClick('title')}
            >
              Title {renderSortIndicator('title')}
            </th>
            <th 
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSortClick('project')}
            >
              Project {renderSortIndicator('project')}
            </th>
            <th 
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSortClick('priority')}
            >
              Priority {renderSortIndicator('priority')}
            </th>
            <th 
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer"
              onClick={() => handleSortClick('dueDate')}
            >
              Due Date {renderSortIndicator('dueDate')}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Assigned
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-violet-100/50 dark:divide-blue-900/50">
          {sortedTasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              onEditTask={onEditTask}
              onSelectTask={onSelectTask}
              onStatusChange={handleStatusChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
