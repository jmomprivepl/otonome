import { useState } from 'react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { ManagerProfile } from '@/config/managerProfiles';
import { useKanbanStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import { Task } from '@/types';

import { Clock, CheckCircle2, AlertTriangle, BarChart3, Users, Calendar, BadgeEuro, Edit } from 'lucide-react';
import { ManagerSelectionModal } from './ManagerSelectionModal';

const ProjectOverview = ({ project, tasks }: { project: string, tasks: Task[] }) => {
  const navigate = useNavigate();
  const { projects, setActiveProject } = useKanbanStore();

  const handleProjectClick = () => {
    const projectData = projects.find(p => p.name === project);
    if (projectData) {
      setActiveProject(projectData);
      navigate('/projects');
    }
  };
  const projectTasks = tasks.filter(t => t.project === project);
  const total = projectTasks.length;
  const completed = projectTasks.filter(t => t.status === 'done').length;
  const inProgress = projectTasks.filter(t => t.status === 'inProgress').length;
  const todo = projectTasks.filter(t => t.status === 'todo').length;
  const draft = projectTasks.filter(t => t.status === 'draft').length;
  
  const progress = total > 0 ? (completed / total) * 100 : 0;
  
  return (
    <div 
      onClick={handleProjectClick}
      className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4 sm:p-6 flex flex-col gap-3 sm:gap-4
        hover:bg-violet-50 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">{project}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{total} tasks total</p>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm font-medium">
        <span className="text-emerald-600 dark:text-emerald-400">{Math.round(progress)}%</span>
        <div className="w-16 sm:w-20 md:w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div 
            className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
        />
        </div>
      </div>
      <div className="grid grid-rows-2 grid-cols-2 gap-2 sm:gap-4">
        <div className="flex items-center gap-1 sm:gap-2 bg-gray-50 dark:bg-gray-900/30 p-2 sm:p-3 rounded-lg">
          <Clock className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          <div>
            <div className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100">{draft}</div>
            <div className="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400">Draft</div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 bg-cyan-50 dark:bg-cyan-900/30 p-2 sm:p-3 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <div>
            <div className="text-xs sm:text-sm font-medium text-cyan-900 dark:text-cyan-100">{todo}</div>
            <div className="text-[10px] sm:text-xs text-cyan-600 dark:text-cyan-400">To Do</div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 bg-amber-50 dark:bg-amber-900/30 p-2 sm:p-3 rounded-lg">
          <BarChart3 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="text-xs sm:text-sm font-medium text-amber-900 dark:text-amber-100">{inProgress}</div>
            <div className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400">In Progress</div>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 bg-emerald-50 dark:bg-emerald-900/30 p-2 sm:p-3 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div>
            <div className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-100">{completed}</div>
            <div className="text-[10px] sm:text-xs text-emerald-600 dark:text-emerald-400">Completed</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Dashboard = ({ sidebarCollapsed, officeManager, setOfficeManager, chatSidebarOpen, setChatSidebarOpen }: { 
  sidebarCollapsed: boolean, 
  officeManager: ManagerProfile | null,
  setOfficeManager: (manager: ManagerProfile | null) => void,
  chatSidebarOpen: boolean, 
  setChatSidebarOpen: (open: boolean) => void 
}) => {
  const [isManagerModalOpen, setIsManagerModalOpen] = useState(false);
  const { tasks, agents, projects } = useKanbanStore();
  
  // Calculate overall statistics
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const overallProgress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
  
  // Get tasks due soon (within next 7 days)
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const tasksDueSoon = tasks.filter(t => {
    const dueDate = new Date(t.dueDate);
    return dueDate >= new Date(today.getTime() - 23 * 59 * 59 * 1000) && dueDate <= nextWeek && t.status !== 'done';
  });

  const handleEditOfficeManager = () => {
    setIsManagerModalOpen(true);
  };

  const handleManagerSelect = (manager: ManagerProfile) => {
    // Update localStorage and state
    window.localStorage.setItem('officeManager', JSON.stringify(manager));
    setOfficeManager(manager);
    setIsManagerModalOpen(false);
  };

  // Get most active agents
  const agentTaskCounts = agents.map(agent => ({
    agent,
    count: tasks.filter(t => t.assignedAgents.includes(agent.id)).length
  })).sort((a, b) => b.count - a.count).slice(0, 3);
  return (
    <>
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed}>
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Top row - Office Manager and Overview */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
            {/* Office Manager Card */}
            <div className="col-span-12 md:col-span-4 lg:col-span-3 p-4 sm:p-6 flex flex-col items-center justify-center">
              <img 
                src={officeManager?.avatar} 
                className="rounded-full w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 border-4 border-violet-800/50 dark:border-violet-200/50 hover:border-emerald-600/50 dark:hover:border-emerald-400/50 cursor-pointer mb-4" 
                alt={officeManager?.name}
                onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
              />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{officeManager?.name}</h2>
              <div className="flex items-center">
                <p className="text-sm text-gray-600 dark:text-gray-300">Office Manager</p>
                <button className="ml-1 cursor-pointer" onClick={handleEditOfficeManager}>
                  <Edit className="w-4 h-4 text-gray-600 dark:text-gray-400 hover:text-sky-600 dark:hover:text-sky-400" />
                </button>
              </div>
            </div>

            {/* Overview Stats */}
            <div className="col-span-12 md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {/* Overall Progress */}
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Overall Progress</h3>
                  <BarChart3 className="w-5 h-5 text-violet-500 dark:text-violet-400" />
                </div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {Math.round(overallProgress)}%
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {completedTasks} of {totalTasks} tasks completed
                </div>
              </div>

              {/* Active Agents */}
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Top Agents</h3>
                  <Users className="w-5 h-5 text-violet-500 dark:text-violet-400" />
                </div>
                <div className="space-y-3">
                  {agentTaskCounts.map(({ agent, count }) => (
                    <div key={agent.id} className="flex items-center gap-2">
                      <img src={agent.avatar} alt={agent.name} className="w-8 h-8 rounded-full" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{agent.name}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">{count} tasks</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Due Soon */}
              <div className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Due Soon</h3>
                  <Calendar className="w-5 h-5 text-violet-500 dark:text-violet-400" />
                </div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {tasksDueSoon.length}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  tasks due in the next 7 days
                </div>
              </div>
            </div>
          </div>

          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
            <div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-teal-100 dark:bg-teal-500/50 backdrop-blur-sm rounded-xl border border-4 border-teal-200/50 dark:border-teal-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Savings with Workmates</h3>
                <span className="p-1 rounded bg-emerald-50 dark:bg-emerald-700">
                  <BadgeEuro className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
                </span>
              </div>
              <div className="flex items-baseline">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">2400</span>
                <span className="text-sm text-gray-600 dark:text-gray-200 ml-2">EUR</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-200 pt-1">
                (90h x 30 EUR/h - subscription)
              </div>
            </div>

            <div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Plan Usage</h3>
                <span className="p-1 rounded bg-orange-100 dark:bg-orange-900">
                  <BarChart3 className="w-4 h-4 text-orange-600 dark:text-orange-300" />
                </span>
              </div>
              <div className="flex items-baseline">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">56%</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">of monthly limit</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-200 pt-1">
                90h / 160h
              </div>
            </div>

            <div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Workmates Usage</h3>
                <span className="p-1 rounded bg-blue-100 dark:bg-blue-900">
                  <Clock className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                </span>
              </div>
              <div className="flex items-baseline">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">1 hour</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">active today</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-200 pt-1">
                6h planned
              </div>
            </div>

            <div className="col-span-12 sm:col-span-6 lg:col-span-3 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">Risk Assessment</h3>
                <span className="p-1 rounded bg-green-100 dark:bg-green-900">
                  <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-300" />
                </span>
              </div>
              <div className="flex items-baseline">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">Low</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-2">everything on track</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-200 pt-1">
                All tasks should be finished on time
              </div>
            </div>
          </div>

          {/* Project Overviews */}
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Projects</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {projects.map(project => (
              <ProjectOverview 
                key={project.id} 
                project={project.name}
                tasks={tasks}
              />
            ))}
          </div>
        </div>
      </AuthenticatedWorkspaceFrame>

      {/* Manager Selection Modal */}
      <ManagerSelectionModal
        isOpen={isManagerModalOpen}
        onClose={() => setIsManagerModalOpen(false)}
        onSelect={handleManagerSelect}
        currentManager={officeManager}
      />
    </>
  );
};