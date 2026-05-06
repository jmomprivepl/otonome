import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { Landing } from '@/components/Landing';
import { AuthScreen } from '@/components/AuthScreen';
import { useKanbanStore } from '@/store';
import { MessageSquare, X } from 'lucide-react';
import { ManagerProfile } from '@/config/managerProfiles';

/** Heavy screens (Pyodide, flow canvas, large deps) load on demand so first paint is not blocked. */
const Dashboard = lazy(() => import('@/components/Dashboard').then((m) => ({ default: m.Dashboard })));
const NsdarCommandCenter = lazy(() =>
  import('@/components/nsdar/NsdarCommandCenter').then((m) => ({ default: m.NsdarCommandCenter })),
);
const Onboarding = lazy(() => import('@/components/Onboarding').then((m) => ({ default: m.Onboarding })));
const TasksScreen = lazy(() => import('@/components/TasksScreen').then((m) => ({ default: m.TasksScreen })));
const ProjectsScreen = lazy(() => import('@/components/ProjectsScreen').then((m) => ({ default: m.ProjectsScreen })));
const AgentsScreen = lazy(() => import('@/components/AgentsScreen').then((m) => ({ default: m.AgentsScreen })));
const DataScreen = lazy(() => import('@/components/DataScreen').then((m) => ({ default: m.DataScreen })));
const SettingsScreen = lazy(() => import('@/components/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const PythonToolsScreen = lazy(() => import('@/components/PythonToolsScreen').then((m) => ({ default: m.PythonToolsScreen })));
const AgentSopListScreen = lazy(() =>
  import('@/components/AgentSopListScreen').then((m) => ({ default: m.AgentSopListScreen })),
);
const SopGraphScreen = lazy(() => import('@/components/SopGraphScreen').then((m) => ({ default: m.SopGraphScreen })));
const PlaygroundScreen = lazy(() =>
  import('@/components/PlaygroundScreen').then((m) => ({ default: m.PlaygroundScreen })),
);
const ChatSidebar = lazy(() => import('@/components/ChatSidebar').then((m) => ({ default: m.ChatSidebar })));

function readOfficeManagerFromStorage(): ManagerProfile | null {
  try {
    const raw = window.localStorage.getItem('officeManager');
    if (!raw) return null;
    return JSON.parse(raw) as ManagerProfile;
  } catch {
    return null;
  }
}

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center text-gray-600 dark:text-gray-300">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-9 w-9 rounded-full border-2 border-violet-500 border-t-transparent animate-spin"
          aria-hidden
        />
        <span className="text-sm">Loading screen…</span>
      </div>
    </div>
  );
}

interface AppProps {
  sidebarCollapsed: boolean;
}

function App({ sidebarCollapsed }: AppProps) {
  const { isLoggedIn } = useKanbanStore();
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const location = useLocation();
  const [officeManager, setOfficeManager] = useState<ManagerProfile | null>(() => readOfficeManagerFromStorage());

  const hideChatRoutes = ['/agent-sop', '/playground'];
  const showChatSidebar =
    isLoggedIn && !hideChatRoutes.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  const showDashboard = window.localStorage.getItem('onboarded') === 'true';

  useEffect(() => {
    if (window.localStorage.getItem('chatSidebarOpen') === 'false') {
      setChatSidebarOpen(false);
    }
  }, []);

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/"
            element={
              isLoggedIn ? (
                showDashboard ? (
                  <NsdarCommandCenter
                    sidebarCollapsed={sidebarCollapsed}
                    officeManager={officeManager}
                    setOfficeManager={setOfficeManager}
                    chatSidebarOpen={chatSidebarOpen}
                    setChatSidebarOpen={setChatSidebarOpen}
                  />
                ) : (
                  <Onboarding
                    sidebarCollapsed={sidebarCollapsed}
                    officeManager={officeManager}
                    setOfficeManager={setOfficeManager}
                  />
                )
              ) : (
                <Landing />
              )
            }
          />
          <Route path="/auth" element={<AuthScreen />} />
          <Route
            path="/overview"
            element={
              isLoggedIn ? (
                <Dashboard
                  sidebarCollapsed={sidebarCollapsed}
                  officeManager={officeManager}
                  setOfficeManager={setOfficeManager}
                  chatSidebarOpen={chatSidebarOpen}
                  setChatSidebarOpen={setChatSidebarOpen}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/tasks"
            element={isLoggedIn ? <TasksScreen sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/projects"
            element={
              isLoggedIn ? (
                <ProjectsScreen
                  sidebarCollapsed={sidebarCollapsed}
                  setChatSidebarOpen={setChatSidebarOpen}
                  setChatInput={setChatInput}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/agents"
            element={isLoggedIn ? <AgentsScreen sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/data"
            element={isLoggedIn ? <DataScreen sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/settings"
            element={
              isLoggedIn ? (
                <SettingsScreen
                  sidebarCollapsed={sidebarCollapsed}
                  officeManager={officeManager}
                  setOfficeManager={setOfficeManager}
                  chatSidebarOpen={chatSidebarOpen}
                  setChatSidebarOpen={setChatSidebarOpen}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/playground"
            element={
              isLoggedIn ? <PlaygroundScreen sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/python-tools"
            element={
              isLoggedIn ? <PythonToolsScreen sidebarCollapsed={sidebarCollapsed} /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/agent-sop"
            element={
              isLoggedIn ? (
                <Outlet />
              ) : (
                <Navigate to="/" replace />
              )
            }
          >
            <Route
              index
              element={<AgentSopListScreen sidebarCollapsed={sidebarCollapsed} />}
            />
            <Route
              path="edit/:sopId"
              element={<SopGraphScreen sidebarCollapsed={sidebarCollapsed} />}
            />
          </Route>
        </Routes>
      </Suspense>

      {showChatSidebar && (
        <>
          <Suspense fallback={null}>
            <ChatSidebar
              isOpen={chatSidebarOpen}
              onClose={() => setChatSidebarOpen(false)}
              officeManager={officeManager}
              input={chatInput}
              setInput={setChatInput}
            />
          </Suspense>
          <button
            onClick={() => setChatSidebarOpen(!chatSidebarOpen)}
            className={`fixed right-6 bottom-6 p-3 rounded-full shadow-lg transition-colors duration-200
              ${chatSidebarOpen ? 'bg-gray-500 hover:bg-gray-600' : 'bg-violet-500 hover:bg-violet-600'}`}
          >
            {chatSidebarOpen ? <X className="w-6 h-6 text-white" /> : <MessageSquare className="w-6 h-6 text-white" />}
          </button>
        </>
      )}
    </>
  );
}

export default App;
