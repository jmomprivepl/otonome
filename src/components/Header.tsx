import { useKanbanStore } from '@/store';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AgentAvatar } from '@/components/AgentAvatar';
import { AgentProfile } from '@/config/agentProfiles';
import { Project } from '@/store';
import { useEffect, useState } from 'react';

interface HeaderProps {
  sidebarCollapsed: boolean;
  showAgents?: boolean;
}

/** Select value when showing tasks from every project (`activeProject === null`). */
export const ALL_PROJECTS_SELECT_VALUE = '__all_projects__';

export const Header = ({ sidebarCollapsed, showAgents = true }: HeaderProps) => {
  const { agents, projects, activeProject, setActiveProject } = useKanbanStore();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40);
    };
    
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <header className={`fixed top-0 z-30 transition-all duration-300 ${
      sidebarCollapsed ? 'left-16' : 'left-64'
    } right-0 ${
      scrolled ? 'bg-white/50 dark:bg-slate-800/70 shadow-md' : 'bg-transparent'
    }`}>
      <div className="min-h-[73px] px-4 sm:px-6 py-2 flex flex-col md:flex-row lg:justify-between lg:items-center">
        {/* Left side - Project selector */}
        <div className="flex items-center space-x-3 mb-2 md:mb-0 md:mr-20 lg:mr-0">
          <span className="text-sm text-gray-500 dark:text-gray-400">Active project:</span>
          <div className="relative">
            <select
              value={activeProject?.id ?? ALL_PROJECTS_SELECT_VALUE}
              onChange={(e) => {
                const v = e.target.value;
                if (v === ALL_PROJECTS_SELECT_VALUE) {
                  setActiveProject(null);
                  return;
                }
                const project = projects.find((p) => p.id === v) ?? null;
                setActiveProject(project);
              }}
              className="appearance-none bg-white dark:bg-slate-800 border border-violet-200/50 dark:border-violet-800/50 rounded-lg px-4 py-2 pr-8 text-sm font-medium text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400"
            >
              <option value={ALL_PROJECTS_SELECT_VALUE}>ALL</option>
              {projects.map((project: Project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700 dark:text-gray-300">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Right side - Agents and Theme Toggle */}
        <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-6">
          {showAgents && (
            <div className="flex items-center space-x-2 sm:space-x-4">
              <span className="text-sm text-gray-500 dark:text-gray-400">Recommended agents:</span>
              <div className="flex -space-x-2">
                {agents.map((agent: AgentProfile) => (
                  <AgentAvatar key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
          <div className="scale-75 md:ml-4 self-end md:self-auto">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
};
