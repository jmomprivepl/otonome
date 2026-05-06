import { useState, useEffect } from 'react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { useKanbanStore } from '@/store';
import { Project, ProjectStatus } from '@/types';
import { Calendar, PenSquare, UserPlus, Lightbulb, Save, X, Plus, FileText, Building } from 'lucide-react';
import { AgentProfile } from '@/config/agentProfiles';

interface ProjectTimelineProps {
  project: Project;
  onSave: (startDate: string, endDate: string) => void;
}

const ProjectTimeline = ({ project, onSave }: ProjectTimelineProps) => {
  const { startDate, endDate, status } = project;
  const [isEditing, setIsEditing] = useState(false);
  const [editedStartDate, setEditedStartDate] = useState(project.startDate);
  const [editedEndDate, setEditedEndDate] = useState(project.endDate);

  const getStatusColor = (projectStatus: ProjectStatus | undefined) => {
    if (!projectStatus) return 'bg-gray-500';

    switch (projectStatus) {
      case 'planned':
        return 'bg-blue-500';
      case 'in-progress':
        return 'bg-amber-500';
      case 'finished':
        return 'bg-emerald-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-white/50 dark:bg-slate-800/50 rounded-xl border border-violet-200/50 dark:border-violet-800/50">
      <div className="flex items-center gap-2">
        <Calendar className="w-5 h-5 text-violet-500 dark:text-violet-400" />
        {isEditing ? (
          <div className="flex gap-4">
            <input
              type="date"
              value={editedStartDate}
              onChange={(e) => setEditedStartDate(e.target.value)}
              className="p-1 text-sm rounded border border-violet-200 dark:border-violet-800 bg-white/50 dark:bg-slate-800/50"
            />
            <input
              type="date"
              value={editedEndDate}
              onChange={(e) => setEditedEndDate(e.target.value)}
              className="p-1 text-sm rounded border border-violet-200 dark:border-violet-800 bg-white/50 dark:bg-slate-800/50"
            />
            <button
              onClick={() => {
                onSave(editedStartDate, editedEndDate);
                setIsEditing(false);
              }}
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/50"
            >
              <Save className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/50"
            >
              <X className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 gap-4">
              <span>{new Date(startDate).toLocaleDateString()}</span>
              <span>-</span>
              <span>{new Date(endDate).toLocaleDateString()}</span>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/50"
            >
              <PenSquare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2 gap-4">
          <span>{new Date(startDate).toLocaleDateString()}</span>
          <span>{new Date(endDate).toLocaleDateString()}</span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
          <div className={`h-full ${status ? getStatusColor(status) : 'bg-gray-500'} rounded-full`} style={{ width: '60%' }} />
        </div>
      </div>
      <span className="px-3 py-1 text-xs font-medium rounded-full capitalize" 
        style={{ 
          backgroundColor: (status ? getStatusColor(status) : 'bg-gray-500') + '20',
          color: (status ? getStatusColor(status) : 'bg-gray-500').replace('bg-', 'text-')
        }}>
        {status}
      </span>
    </div>
  );
};

interface ProjectAgentCardProps {
  agent: AgentProfile;
  taskCount: number;
}

const ProjectAgentCard = ({ agent, taskCount }: ProjectAgentCardProps) => {
  return (
    <div className="bg-white/50 dark:bg-slate-800/50 rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-6 items-start">
        <div>
          <img src={agent.avatar} alt={agent.name} className="w-14 h-14 sm:w-20 sm:h-20 rounded-full" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm sm:text-base font-medium text-gray-900 dark:text-white">{agent.name}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">{taskCount} tasks</p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{agent.description}</p>
        </div>
      </div>
    </div>
  );
};

interface QuickActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

const QuickAction = ({ icon, title, description, onClick }: QuickActionProps) => {
  return (
    <button 
      onClick={onClick}
      className="flex items-start gap-2 sm:gap-4 p-3 sm:p-4 bg-white/50 dark:bg-slate-800/50 rounded-xl border border-violet-200/50 
        dark:border-violet-800/50 hover:bg-violet-50 dark:hover:bg-violet-900/50 transition-colors w-full text-left"
    >
      <div className="p-1.5 sm:p-2 bg-violet-100 dark:bg-violet-900/50 rounded-lg">
        {icon}
      </div>
      <div>
        <h3 className="text-sm sm:text-base font-medium text-gray-900 dark:text-white">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
    </button>
  );
};

interface ProjectsScreenProps {
  sidebarCollapsed?: boolean;
  setChatSidebarOpen: (open: boolean) => void;
  setChatInput: (input: string) => void;
}

export const ProjectsScreen = ({ sidebarCollapsed, setChatSidebarOpen, setChatInput }: ProjectsScreenProps) => {
  const { tasks, agents, activeProject, projects, createProject } = useKanbanStore();
  const [selectedProject, setSelectedProject] = useState<Project | null>(activeProject);
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(selectedProject?.description || '');
  
  // New project modal state
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDepartment, setNewProjectDepartment] = useState<Project['department']>('Marketing');
  const [newProjectDescription, setNewProjectDescription] = useState('');

  // Update selected project when active project changes
  useEffect(() => {
    setSelectedProject(activeProject);
    setEditedDescription(activeProject?.description || '');
  }, [activeProject]);
  
  const handleEditDescription = () => {
    setIsEditing(true);
    setEditedDescription(selectedProject?.description || '');
  };

  const handleSaveDescription = () => {
    if (selectedProject) {
      const updatedProject = { ...selectedProject, description: editedDescription };
      const updatedProjects = projects.map((p: Project) => 
        p.id === selectedProject.id ? updatedProject : p
      );
      useKanbanStore.setState({ projects: updatedProjects });
      setIsEditing(false);
    }
  };

  const handleRecruitAgents = () => {
    // Create a task for the Office Manager to help with recruitment
    null;
  };

  const handleGetTips = () => {
    if (selectedProject) {
      setChatInput(`I need tips and suggestions for improving the project: ${selectedProject.name}. Please analyze our current progress and provide recommendations.`);
      setChatSidebarOpen(true);
    }
  };
  
  const handleCreateProject = () => {
    if (newProjectName.trim() === '') return;
    
    createProject(
      newProjectName,
      newProjectDepartment,
      newProjectDescription
    );
    
    // Reset form and close modal
    setNewProjectName('');
    setNewProjectDescription('');
    setNewProjectDepartment('Marketing');
    setIsNewProjectModalOpen(false);
  };

  if (!selectedProject) {
    return (
      <>
        <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed || false}>
          <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6">
            <button
              onClick={() => setIsNewProjectModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span>New Project</span>
            </button>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400">Please select a project from the dashboard or create a new one.</p>
            
            {/* Display existing projects */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-4 sm:mt-8">
              {projects.map(project => (
                <div 
                  key={project.id}
                  className="bg-white/50 dark:bg-slate-800/50 rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4 sm:p-6 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => useKanbanStore.getState().setActiveProject(project)}
                >
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2">{project.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{project.description}</p>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300">{project.department}</span>
                    {project.status && (
                      <span className="text-xs font-medium px-2 py-1 rounded-full capitalize" 
                        style={{ 
                          backgroundColor: `var(--${project.status}-color-bg)`,
                          color: `var(--${project.status}-color-text)`
                        }}>
                        {project.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AuthenticatedWorkspaceFrame>
        
        {/* New Project Modal */}
        {isNewProjectModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full mx-4 sm:mx-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Create New Project</h3>
                <button 
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project Name</label>
                  <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                    <span className="p-2 bg-gray-100 dark:bg-gray-700">
                      <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </span>
                    <input
                      type="text"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="Enter project name"
                      className="flex-1 p-2 bg-transparent focus:outline-none"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
                  <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                    <span className="p-2 bg-gray-100 dark:bg-gray-700">
                      <Building className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </span>
                    <select
                      value={newProjectDepartment}
                      onChange={(e) => setNewProjectDepartment(e.target.value as Project['department'])}
                      className="flex-1 p-2 bg-transparent focus:outline-none"
                    >
                      <option value="Marketing">Marketing</option>
                      <option value="HR">HR</option>
                      <option value="Finance">Finance</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                  <textarea
                    value={newProjectDescription}
                    onChange={(e) => setNewProjectDescription(e.target.value)}
                    placeholder="Enter project description"
                    rows={3}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsNewProjectModalOpen(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim()}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create Project
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Get all agents involved in the project
  const projectTasks = tasks.filter(t => t.project === selectedProject.name);
  const projectAgentIds = new Set(projectTasks.flatMap(t => t.assignedAgents));
  const projectAgents = agents
    .filter(a => projectAgentIds.has(a.id))
    .map(agent => ({
      agent,
      taskCount: projectTasks.filter(t => t.assignedAgents.includes(agent.id)).length
    }));



  return (
    <>
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed || false}>
        <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
        <button
          onClick={() => setIsNewProjectModalOpen(true)}
          className="flex cursor-pointer items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 mt-1 sm:mt-2 text-xs sm:text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
          {/* Project Header with New Project Button */}
          <div className="bg-white/50 dark:bg-slate-800/50 rounded-xl border border-violet-200/50 dark:border-violet-800/50 p-4 sm:p-6 space-y-4 sm:space-y-6">
            <div className="flex justify-between items-start">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">{selectedProject.name}</h1>
            {isEditing ? (
            <div className="relative">
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                className="w-full p-2 text-gray-600 dark:text-gray-400 bg-white/50 dark:bg-slate-800/50 rounded-lg border border-violet-200/50 dark:border-violet-800/50"
                rows={3}
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={handleSaveDescription}
                  className="p-1 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50"
                >
                  <Save className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-1 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50"
                >
                  <X className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="ml-5 lg:ml-0 text-md sm:text-lg md:text-xl text-gray-600 dark:text-gray-400">{selectedProject.description}</p>
            </div>
          )}
            </div>
          </div>

          {/* Project Timeline */}
          <div>
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">Timeline</h2>
        <ProjectTimeline 
          project={selectedProject} 
          onSave={(startDate, endDate) => {
            const updatedProject = { ...selectedProject, startDate, endDate };
            const updatedProjects = projects.map((p: Project) => 
              p.id === selectedProject.id ? updatedProject : p
            );
            useKanbanStore.setState({ projects: updatedProjects });
            setSelectedProject(updatedProject);
          }}
        />
          </div>

          {/* Project Agents */}
          <div>
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">Project Agents</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {projectAgents.map(({ agent, taskCount }) => (
            <ProjectAgentCard 
              key={agent.id} 
              agent={agent}
              taskCount={taskCount}
            />
          ))}
        </div>
          </div>

          {/* Quick Actions */}
          <div>
        <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-2 sm:mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              <QuickAction
                icon={<PenSquare className="w-5 h-5 text-violet-600 dark:text-violet-400" />}
                title="Edit Description"
                description="Update the project's description and details"
                onClick={handleEditDescription}
              />
              <QuickAction
                icon={<UserPlus className="w-5 h-5 text-violet-600 dark:text-violet-400" />}
                title="Recruit Agents"
                description="Find and assign new agents to the project"
                onClick={handleRecruitAgents}
              />
              <QuickAction
                icon={<Lightbulb className="w-5 h-5 text-violet-600 dark:text-violet-400" />}
                title="Tips & Suggestions"
                description="Get advice from your Office Manager"
                onClick={handleGetTips}
              />
            </div>
          </div>
        </div>
      </AuthenticatedWorkspaceFrame>
      
      {/* New Project Modal */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Create New Project</h3>
              <button 
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project Name</label>
                <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                  <span className="p-2 bg-gray-100 dark:bg-gray-700">
                    <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  </span>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Enter project name"
                    className="flex-1 p-2 bg-transparent focus:outline-none"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
                <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                  <span className="p-2 bg-gray-100 dark:bg-gray-700">
                    <Building className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  </span>
                  <select
                    value={newProjectDepartment}
                    onChange={(e) => setNewProjectDepartment(e.target.value as Project['department'])}
                    className="flex-1 p-2 bg-transparent focus:outline-none"
                  >
                    <option value="Marketing">Marketing</option>
                    <option value="HR">HR</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Enter project description"
                  rows={3}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-transparent focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
