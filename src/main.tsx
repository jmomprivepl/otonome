import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './components/ThemeProvider'
import { Sidebar } from './components/Sidebar';
import { AgentHitlBridge } from './components/AgentHitlBridge';
import { isTauriRuntime } from './config/nativeLlm';

function AppWrapper() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className="font-sans min-h-screen bg-gradient-to-br from-[#ECECFF] to-[#DBEAFE] 
      dark:from-cyan-900 dark:via-gray-900 dark:to-indigo-950"
    >
      <Sidebar onCollapsedChange={setSidebarCollapsed} />
      <AgentHitlBridge />
      <App sidebarCollapsed={sidebarCollapsed} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AppWrapper />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

if (isTauriRuntime()) {
  document.documentElement.classList.add('tauri');
}
