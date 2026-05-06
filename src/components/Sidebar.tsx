import { cn } from "@/lib/utils"
import { isSidebarNavActive } from "@/lib/sidebarNav"
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
  Home,
  Cpu,
} from "lucide-react"
import { useState, useEffect, type ComponentType } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useKanbanStore } from "@/store"
import { useThemeStore } from '../themeStore';

type NavItem = { name: string; path: string; icon: ComponentType<{ className?: string }> };

/** §5.2 Primary spine + workspace modules + Advanced (engine / playground). */
const SIDEBAR_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ name: 'Delegate', path: '/', icon: Home }],
  },
  {
    label: 'Workspace',
    items: [
      { name: 'Overview', path: '/overview', icon: LayoutDashboard },
      { name: 'Tasks', path: '/tasks', icon: ListTodo },
      { name: 'Projects', path: '/projects', icon: FolderKanban },
      { name: 'Agents', path: '/agents', icon: Users },
      { name: 'Data', path: '/data', icon: Database },
      { name: 'Agent SOP', path: '/agent-sop', icon: GitBranch },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { name: 'Engine', path: '/engine', icon: Cpu },
      { name: 'Playground', path: '/playground', icon: Boxes },
    ],
  },
  {
    label: null,
    items: [{ name: 'Settings', path: '/settings', icon: Settings }],
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

      <nav className="flex-1 overflow-y-auto p-2">
        {SIDEBAR_GROUPS.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-3 border-t border-violet-200/40 pt-3 dark:border-blue-800/40")}>
            {group.label && !collapsed ? (
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => (
              <button
                key={`${group.label ?? 'g'}-${item.path}`}
                type="button"
                onClick={() => navigate(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                  isSidebarNavActive(item.path, location.pathname)
                    ? "bg-violet-100/50 dark:bg-blue-900/50 text-violet-900 dark:text-blue-100"
                    : "hover:bg-violet-100/50 dark:hover:bg-blue-900/50 text-gray-600 dark:text-gray-400"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span
                  className={cn(
                    "font-medium transition-all duration-200",
                    collapsed ? "w-0 opacity-0" : "opacity-100"
                  )}
                >
                  {item.name}
                </span>
              </button>
            ))}
          </div>
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
