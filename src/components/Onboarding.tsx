import { Header } from './Header';
import { agentProfiles, AgentProfile } from '@/config/agentProfiles';
import { managerProfiles, ManagerProfile } from '@/config/managerProfiles';
import { useEffect, useRef } from 'react';
import speechWorkerManager from '@/workers/speechWorkerManager';

export const Onboarding = ({ sidebarCollapsed, officeManager, setOfficeManager }: { sidebarCollapsed: boolean, officeManager: ManagerProfile | null, setOfficeManager: (manager: ManagerProfile | null) => void }) => {

  const ttsWorkerRef = useRef<Worker | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    const componentId = 'onboarding';
    
    // Check if this component has already been initialized
    if (speechWorkerManager.isComponentInitialized(componentId)) {
      return;
    }
    
    // Create a proxy object that will forward calls to speechWorkerManager
    ttsWorkerRef.current = {
      postMessage: (message: any) => {
        speechWorkerManager.sendTtsMessage(message, 'onboarding');
      },
      terminate: () => {
        speechWorkerManager.unregisterTtsListener('onboarding');
      }
    } as unknown as Worker;
    
    // Initialize audio context only when needed
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
    }
    
    // Register callback for TTS worker messages
    speechWorkerManager.registerTtsListener((e) => {
      const { status, data } = e;
      
      switch (status) {
        case 'ready':
          break;
        case 'chunk':
          if (!audioContext.current) {
            audioContext.current = new AudioContext();
          }
          
          if (audioContext.current && data.buffer) {
            // Add to queue and play if not playing
            audioQueueRef.current.push(data.buffer);
            if (!isPlayingRef.current) {
              playNextInQueue();
            }
          }
          break;
      }
    }, 'onboarding');
    
    // Initialize TTS worker through speechWorkerManager
    speechWorkerManager.loadTts(officeManager?.kokoroVoice);

    const playNextInQueue = async () => {
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
      }

      // Check if the audio context is closed or not initialized
      if (!audioContext.current || audioContext.current.state === 'closed') {
        audioContext.current = new AudioContext();
      }

      // Make sure the audio context is running
      if (audioContext.current.state === 'suspended') {
        await audioContext.current.resume();
      }

      isPlayingRef.current = true;
      const buffer = audioQueueRef.current[0];

      try {
        const audioBuffer = await audioContext.current.decodeAudioData(buffer.slice(0));
        const source = audioContext.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.current.destination);
        
        // When finished, play next
        source.onended = () => {
          audioQueueRef.current.shift(); // Remove played buffer
          playNextInQueue(); // Play next in queue
        };

        source.start();
      } catch (error) {
        console.error('[AUDIO] Playback error:', error);
        audioQueueRef.current.shift(); // Remove errored buffer
        playNextInQueue(); // Try next one
      }
    };

    return () => {
      // Clean up when component unmounts
      speechWorkerManager.unregisterTtsListener('onboarding');

      // set onboarded to true
      window.localStorage.setItem('onboarded', 'true');
      
      // Instead of closing the audio context, we'll just suspend it
      // This allows it to be resumed later if needed
      if (audioContext.current && audioContext.current.state !== 'closed') {
        audioContext.current.suspend();
      }
    };
  }, [])

  const handleVoiceMessage = (message: string, voice: string | undefined) => {
    ttsWorkerRef.current?.postMessage({ 
      type: 'synthesize', 
      data: message,
      voice,
      speed: 1.2
    });
  }

  const handleManagerSelect = (manager: ManagerProfile) => {
    setOfficeManager(manager);
    window.localStorage.setItem('officeManager', JSON.stringify(manager));
  };

  if (officeManager == null) {
    return (
      <>
        <Header sidebarCollapsed={sidebarCollapsed} showAgents={false} />
        <div className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
          <div className="w-[80%] mx-auto py-6">
            <div className="space-y-8">
              <section className="space-y-8 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Pick your Office Manager!</h1>
                <div className="flex flex-row space-x-8">
                  {Object.values(managerProfiles).map((profile: ManagerProfile, index: number) => (
                    <div key={index} className="w-[240px] text-center" onClick={() => handleManagerSelect(profile)}>
                      <img src={profile.avatar} 
                        className="rounded-full w-full border border-4 border-violet-800/50 dark:border-violet-200/50 hover:border-emerald-600/50 dark:hover:border-emerald-400/50 cursor-pointer"
                        onMouseEnter={() => handleVoiceMessage(profile.greeting, profile.kokoroVoice)}
                      />
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{profile.name}</h2>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </>
    );
  } else {
    return (
      <>
        <Header sidebarCollapsed={sidebarCollapsed} showAgents={false} />
        <div className={`transition-all duration-300 pt-[73px] ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}>
          <div className="w-[80%] mx-auto py-6">
            <div className="space-y-8 text-gray-900 dark:text-gray-100">
              <section className="space-y-8 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
                  <h1 className="text-3xl font-bold">Welcome to Workmates!</h1>
                  <div className="flex flex-row">
                      <div className="w-1/4 text-center" onMouseEnter={() => handleVoiceMessage('Hi there! I\'m your Office manager. I will help you to realize all your tasks through our AI workmates. Move your mouse over them to hear their introduction.', officeManager?.kokoroVoice)}>
                          <img src={officeManager?.avatar} className="rounded-full w-full border border-4 border-violet-800/50 dark:border-violet-200/50 hover:border-emerald-600/50 dark:hover:border-emerald-400/50 cursor-pointer" />
                          <h2 className="text-lg font-semibold">Office manager - {officeManager?.name}</h2>
                          <button onClick={() => {setOfficeManager(null); window.localStorage.removeItem('officeManager')}} className="text-sm text-gray-500 dark:text-gray-400">[change manager]</button>
                      </div>
                      <div className="w-3/4">
                          <div className="px-8 py-10 w-full text-2xl space-y-6 items-center">
                              <p>Hi there! I'm your Office manager. I will help you to realize all your tasks through our AI workmates.</p>
                              <p>Move your mouse over them to hear their introduction.</p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">(By the way, I am always there for you in the bottom right corner)</p>
                          </div>
                      </div>
                  </div>
              </section>

              <section className="space-y-8 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Our AI workmates</h1>
                  <div className="flex flex-row space-x-8">
                  {Object.values(agentProfiles).map((profile: AgentProfile, index: number) => (
                    <div key={index} className="w-[180px] text-center">
                        <img src={profile.avatar} 
                          className="rounded-full w-full border border-4 border-violet-800/50 dark:border-violet-200/50 hover:border-emerald-600/50 dark:hover:border-emerald-400/50 cursor-pointer"
                          onMouseEnter={() => handleVoiceMessage(`${index % 2 == 0 ? 'Hey' : 'Hi'}! I'm ${profile.name}. I am ${profile.description}`, profile.kokoroVoice)} 
                        />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{profile.name}</h2>
                    </div>
                  ))}
                  </div>
              </section>

              <section className="space-y-8 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Videos</h1>
              </section>

              <section className="space-y-8 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg border border-violet-200/50 dark:border-violet-800/50 p-6">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">FAQ</h1>
              </section>
            </div>
          </div>
        </div>
      </>
    );
  }
}