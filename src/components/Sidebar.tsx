import { cn } from "@/lib/utils"
import {  
  ListTodo, 
  Users, 
  Settings, 
  LogOut,
  ChevronLeft,
  Database,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  Boxes,
  Sparkles,
} from "lucide-react"
import { useState, useEffect } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useKanbanStore } from "@/store"
import { useThemeStore } from '../themeStore';

const sidebarItems = [
  {
    name: 'Overview',
    icon: LayoutDashboard,
    path: '/overview',
  },
  {
    name: 'Tasks',
    icon: ListTodo,
    path: '/tasks'
  },
  {
    name: 'Projects',
    icon: FolderKanban,
    path: '/projects'
  },
  {
    name: 'Agents',
    icon: Users,
    path: '/agents'
  },
  {
    name: 'Data',
    icon: Database,
    path: '/data'
  },
  {
    name: 'Agent SOP',
    icon: GitBranch,
    path: '/agent-sop'
  },
  {
    name: 'Playground',
    icon: Boxes,
    path: '/playground'
  },
  {
    name: 'Agent Finetuning',
    icon: Sparkles,
    path: '/',
  },
  // {
  //   name: 'Python Tools',
  //   icon: Code,
  //   path: '/python-tools'
  // },
  {
    name: 'Settings',
    icon: Settings,
    path: '/settings'
  },
];

interface SidebarProps {
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ onCollapsedChange }: SidebarProps) {
  const { setLoggedIn, isLoggedIn } = useKanbanStore();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useThemeStore();

  useEffect(() => {
    onCollapsedChange?.(collapsed);
  }, [collapsed, onCollapsedChange]);

  const handleLogout = () => {
    setLoggedIn(false);
    navigate('/');
  };

  if (!isLoggedIn) {
    return null;
  }

  return (
    <div
      className={cn(
        "h-screen fixed left-0 top-0 z-40 flex flex-col",
        "bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl",
        "border-r border-violet-200/50 dark:border-blue-800/50",
        "transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between p-4">
        {!collapsed && (
          <img src={`/${isDark ? 'workmates_logo_light.png' : 'workmates_logo.png'}`} alt="Workmates.pro" className="h-12 w-auto" />
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-violet-100/50 dark:hover:bg-blue-900/50
            transition-all duration-200"
        >
          <ChevronLeft className={cn(
            "h-5 w-5 text-violet-600 dark:text-blue-400 transition-transform duration-300",
            collapsed ? "rotate-180" : ""
          )} />
        </button>
      </div>

      <nav className="flex-1 p-2">
        {sidebarItems.map((item) => (
          <button
            key={item.name}
            onClick={() => navigate(item.path)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
              location.pathname === item.path 
                ? "bg-violet-100/50 dark:bg-blue-900/50 text-violet-900 dark:text-blue-100"
                : "hover:bg-violet-100/50 dark:hover:bg-blue-900/50 text-gray-600 dark:text-gray-400"
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            <span className={cn(
              "font-medium transition-all duration-200",
              collapsed ? "w-0 opacity-0" : "opacity-100"
            )}>
              {item.name}
            </span>
          </button>
        ))}
      </nav>

      <div className="border-t border-violet-200/50 dark:border-blue-800/50 p-2">
        <button
          onClick={handleLogout}
          className="w-full flex items-center px-3 py-2 rounded-lg transition-all duration-200
            hover:bg-violet-100/50 dark:hover:bg-blue-900/50
            text-gray-600 dark:text-gray-400"
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          <span className={cn(
            "ml-3 text-sm font-medium transition-all duration-200",
            collapsed ? "w-0 opacity-0" : "opacity-100"
          )}>
            Logout
          </span>
        </button>
      </div>
    </div>
  );
}
