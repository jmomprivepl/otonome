import { useState, useEffect, useCallback } from 'react';
import { Bell, MessageSquare, Database, Clock, User, Cpu } from 'lucide-react';
import { Header } from './Header';
import { managerProfiles, ManagerProfile } from '@/config/managerProfiles';
import { getAirtable } from '@/airtableops';
import { initializeExa } from '@/exaops';
import { isTauriRuntime } from '@/config/nativeLlm';
import { formatInferenceHardwareLine, type InferenceHardwareSnapshot } from '@/types/nsdar';

type LlmHardwareMode = 'cpu' | 'igpu' | 'dgpu';

interface SettingsScreenProps {
  sidebarCollapsed: boolean;
  chatSidebarOpen: boolean;
  setChatSidebarOpen: (open: boolean) => void;
  officeManager: ManagerProfile | null;
  setOfficeManager: (manager: ManagerProfile | null) => void;
}

type ChatSettings = {
  enabled: boolean;
}

type DataSettings = {
  airtableToken: string;
  exaToken: string;
}

type NotificationSettings = {
  taskAssigned: boolean;
  taskCompleted: boolean;
  taskDueSoon: boolean;
  emailNotifications: boolean;
};

type PrivacySettings = {
  showAssignedAgents: boolean;
  showTaskDetails: boolean;
  publicBoard: boolean;
};

type PreferenceSettings = {
  defaultView: string;
  defaultPriority: string;
  autoArchiveCompleted: boolean;
  taskRetentionDays: number;
};

type OfficeManagerSettings = {
  officeManager: ManagerProfile;
};

type Settings = {
  chat: ChatSettings;
  data: DataSettings;
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  preferences: PreferenceSettings;
  officeManager: OfficeManagerSettings;
};

export const SettingsScreen = ({ sidebarCollapsed, chatSidebarOpen, setChatSidebarOpen, officeManager, setOfficeManager }: SettingsScreenProps) => {
  const [llmHardware, setLlmHardware] = useState<LlmHardwareMode>('igpu');
  const [llmHardwareBusy, setLlmHardwareBusy] = useState(false);
  const [llmHardwareNote, setLlmHardwareNote] = useState<string>('');
  const [llmHardwareEffectiveLine, setLlmHardwareEffectiveLine] = useState<string>('');

  const [settings, setSettings] = useState<Settings>({
    chat: {
      enabled: chatSidebarOpen
    },
    data: {
      airtableToken: window.localStorage.getItem('airtable-key') || '',
      exaToken: window.localStorage.getItem('exa-key') || '',
    },
    notifications: {
      taskAssigned: true,
      taskCompleted: true,
      taskDueSoon: true,
      emailNotifications: false
    },
    privacy: {
      showAssignedAgents: true,
      showTaskDetails: true,
      publicBoard: false
    },
    preferences: {
      defaultView: 'kanban',
      defaultPriority: 'medium',
      autoArchiveCompleted: false,
      taskRetentionDays: 30
    },
    officeManager: {
      officeManager: officeManager || managerProfiles.Cristina
    }
  });

  useEffect(() => {
    if (settings.data.airtableToken === '') return;
    if (settings.data.airtableToken === window.localStorage.getItem('airtable-key')) return;
    window.localStorage.setItem('airtable-key', settings.data.airtableToken);
    getAirtable();
  }, [settings.data.airtableToken]);

  useEffect(() => {
    if (settings.data.exaToken === '') return;
    if (settings.data.exaToken === window.localStorage.getItem('exa-key')) return;
    window.localStorage.setItem('exa-key', settings.data.exaToken);
    initializeExa();
  }, [settings.data.exaToken]);

  const refreshInferenceHardwareLine = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const snap = await invoke<InferenceHardwareSnapshot>('get_inference_hardware_snapshot');
      setLlmHardwareEffectiveLine(formatInferenceHardwareLine(snap));
    } catch {
      setLlmHardwareEffectiveLine('');
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const v = await invoke<string>('get_hardware_preference');
        if (cancelled) return;
        if (v === 'cpu' || v === 'igpu' || v === 'dgpu') {
          setLlmHardware(v);
        }
        if (!cancelled) await refreshInferenceHardwareLine();
      } catch {
        if (!cancelled) {
          setLlmHardwareNote('Could not read hardware preference from the desktop app.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshInferenceHardwareLine]);

  const onLlmHardwareChange = async (mode: LlmHardwareMode) => {
    if (!isTauriRuntime()) return;
    setLlmHardwareBusy(true);
    setLlmHardwareNote('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_hardware_preference', { mode });
      setLlmHardware(mode);
      await refreshInferenceHardwareLine();
      setLlmHardwareNote(
        'Saved. The next in-process model load uses this setting. If Vulkan already started in this session, restart the app once so the GPU choice fully applies.'
      );
    } catch (e) {
      setLlmHardwareNote(`Could not save: ${String(e)}`);
    } finally {
      setLlmHardwareBusy(false);
    }
  };

  const SettingToggle = ({ 
    category, 
    setting, 
    label, 
    description 
  }: { 
    category: keyof Settings;
    setting: string;
    label: string; 
    description: string;
  }) => (
    <div className="flex items-start justify-between py-4">
      <div className="flex-1 pr-4">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <div className="flex-shrink-0">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            //checked={settings[category][setting] as boolean}
            onChange={(e) => handleSettingChange(category, setting, e.target.checked)}
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 
            peer-focus:ring-violet-300 dark:peer-focus:ring-violet-800 rounded-full peer 
            dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white 
            after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white 
            after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 
            after:transition-all dark:border-gray-600 peer-checked:bg-violet-600"></div>
        </label>
      </div>
    </div>
  );

  const handleSettingChange = (category: keyof Settings, setting: string, value: boolean | string | number | ManagerProfile) => {
    setSettings(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [setting]: value
      }
    }));
    if (category === 'officeManager') {
      let newManager = managerProfiles[value as string];
      setOfficeManager(newManager);
    }
    if (category === 'chat') {
      setChatSidebarOpen(value as boolean);
      window.localStorage.setItem('chatSidebarOpen', value ? 'true' : 'false');
    }
  };

  return (
    <>
      <Header sidebarCollapsed={sidebarCollapsed} showAgents={false} />
      <div className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
        <div className="max-w-2xl mx-auto py-6">
          <div className="space-y-8">
            {/* Chat */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Chat</h3>
              </div>
              <div className="flex items-center gap-2">
                <input id="chat-enabled" type="radio" name="chat" value="enabled" checked={settings.chat.enabled} onChange={(e) => handleSettingChange('chat', 'enabled', e.target.value === 'enabled')} />
                <label htmlFor="chat-enabled">Visible on start</label>
                <input id="chat-disabled" type="radio" name="chat" value="disabled" checked={!settings.chat.enabled} onChange={(e) => handleSettingChange('chat', 'enabled', e.target.value === 'enabled')} />
                <label htmlFor="chat-disabled">Not visible on start</label>
              </div>
            </section>
            {/* Data */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Database className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Data & Search</h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700 space-y-4">
                <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    Airtable token (<a target="_blank" href="https://airtable.com/create/tokens">get it here</a>)
                </label>
                <input
                  type="text"
                  className="w-full text-sm rounded-md border border-gray-200 
                    dark:border-gray-700 p-2"
                  value={settings.data.airtableToken}
                  onChange={(e) => handleSettingChange('data', 'airtableToken', e.target.value)}
                />
                </div>
                <div className="pt-2">
                <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    Exa token (<a target="_blank" href="https://dashboard.exa.ai/api-keys">get it here</a>)
                </label>
                <input
                  type="text"
                  className="w-full text-sm rounded-md border border-gray-200 
                    dark:border-gray-700 p-2"
                  value={settings.data.exaToken}
                  onChange={(e) => handleSettingChange('data', 'exaToken', e.target.value)}
                />
                </div>
              </div>
            </section>

            {/* In-process Otonome / llama.cpp hardware */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Local inference (Otonome)</h3>
              </div>
              {!isTauriRuntime() ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Hardware selection is available in the desktop app (Tauri). In the browser dev UI, set
                  <code className="mx-1 rounded bg-gray-100 px-1 dark:bg-slate-700">GGML_VK_VISIBLE_DEVICES</code>
                  and
                  <code className="mx-1 rounded bg-gray-100 px-1 dark:bg-slate-700">OTONOME_N_GPU_LAYERS</code>
                  in your shell before starting the app.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Chooses where the in-process BitNet + router runs. Vulkan uses physical device indices (often{' '}
                    <code className="rounded bg-gray-100 px-1 dark:bg-slate-700">0</code> = iGPU,
                    <code className="mx-1 rounded bg-gray-100 px-1 dark:bg-slate-700">1</code> = dGPU on many laptops).
                  </p>
                  <fieldset disabled={llmHardwareBusy} className="space-y-2">
                    <legend className="sr-only">Hardware backend</legend>
                    {(
                      [
                        ['cpu', 'CPU only', 'All layers on CPU (OTONOME_N_GPU_LAYERS=0).'] as const,
                        ['igpu', 'Integrated GPU (Vulkan)', 'GGML_VK_VISIBLE_DEVICES=0, full offload.'] as const,
                        ['dgpu', 'Discrete GPU (Vulkan)', 'GGML_VK_VISIBLE_DEVICES=1, full offload.'] as const,
                      ] as const
                    ).map(([value, label, hint]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                          llmHardware === value
                            ? 'border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
                            : 'border-gray-200 dark:border-gray-600 hover:border-violet-300 dark:hover:border-violet-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="llm-hardware"
                          className="mt-1"
                          checked={llmHardware === value}
                          onChange={() => void onLlmHardwareChange(value)}
                        />
                        <span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
                          <span className="mt-0.5 block text-gray-500 dark:text-gray-400">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {llmHardwareBusy ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">Saving…</p>
                  ) : null}
                  {llmHardwareNote ? (
                    <p className="text-sm text-gray-600 dark:text-gray-300">{llmHardwareNote}</p>
                  ) : null}
                  {llmHardwareEffectiveLine ? (
                    <p className="text-xs font-mono text-gray-700 dark:text-gray-200 rounded-md bg-gray-50 dark:bg-slate-900/70 p-2 border border-gray-200 dark:border-gray-600">
                      {llmHardwareEffectiveLine}
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            {/* Notifications */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Notifications</h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                <SettingToggle
                  category="notifications"
                  setting="taskAssigned"
                  label="Task Assignment Notifications"
                  description="Receive notifications when tasks are assigned to you"
                />
                <SettingToggle
                  category="notifications"
                  setting="taskCompleted"
                  label="Task Completion Notifications"
                  description="Receive notifications when your tasks are completed"
                />
                <SettingToggle
                  category="notifications"
                  setting="taskDueSoon"
                  label="Due Date Reminders"
                  description="Receive notifications when tasks are approaching their due date"
                />
                <SettingToggle
                  category="notifications"
                  setting="emailNotifications"
                  label="Email Notifications"
                  description="Receive notifications via email in addition to in-app notifications"
                />
              </div>
            </section>

            {/* Privacy */}
            {/* <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Privacy</h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                <SettingToggle
                  category="privacy"
                  setting="showAssignedAgents"
                  label="Show Assigned Agents"
                  description="Display assigned AI agents on task cards"
                />
                <SettingToggle
                  category="privacy"
                  setting="showTaskDetails"
                  label="Show Task Details"
                  description="Display task descriptions and comments publicly"
                />
                <SettingToggle
                  category="privacy"
                  setting="publicBoard"
                  label="Public Board Access"
                  description="Allow the board to be viewed without authentication"
                />
              </div>
            </section> */}

            {/* Preferences */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Task Preferences</h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                <SettingToggle
                  category="preferences"
                  setting="autoArchiveCompleted"
                  label="Auto-archive Completed Tasks"
                  description="Automatically archive tasks that have been completed"
                />
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    Task Retention Period (days)
                  </label>
                  <input
                    type="number"
                    value={settings.preferences.taskRetentionDays}
                    onChange={(e) => handleSettingChange('preferences', 'taskRetentionDays', parseInt(e.target.value))}
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-600 
                      focus:outline-none focus:ring-violet-500 focus:border-violet-500 sm:text-sm rounded-md
                      bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                    min="1"
                    max="365"
                  />
                </div>
              </div>
            </section>

            {/* Office Manager */}
            <section className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-5 w-5 text-violet-500 dark:text-violet-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Office Manager</h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                <div className="py-4">
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    Your Office Manager
                  </label>
                  <select
                    value={officeManager?.name || ''}
                    onChange={(e) => handleSettingChange('officeManager', 'officeManager', e.target.value)}
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-600 
                      focus:outline-none focus:ring-violet-500 focus:border-violet-500 sm:text-sm rounded-md
                      bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                  >
                    {/* <option value="" selected disabled hidden>{officeManager?.name || 'Select Office Manager'}</option> */}
                    {Object.values(managerProfiles).map((manager: ManagerProfile) => (
                      <option key={manager.name} value={manager.name}>
                        {manager.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
};
