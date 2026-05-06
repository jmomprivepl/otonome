import { useState } from 'react';
import { Search, X, Volume2, Play, Loader2 } from 'lucide-react';
import { AuthenticatedWorkspaceFrame } from '@/components/AuthenticatedWorkspaceFrame';
import { useKanbanStore } from '@/store';
import { AgentProfile } from '@/config/agentProfiles';
import { useRef, useEffect } from 'react';
import speechWorkerManager from '@/workers/speechWorkerManager';
import workerManager from '@/workers/workerManager';

interface AgentExamples {
  examples: Record<number, string>;
}

interface AgentsScreenProps {
  sidebarCollapsed: boolean;
}

export const AgentsScreen = ({ sidebarCollapsed }: AgentsScreenProps) => {
  const { agents } = useKanbanStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [exampleResponses, setExampleResponses] = useState<Record<string, AgentExamples>>({});
  const [loadingExamples, setLoadingExamples] = useState<Record<string, { examples: Record<number, boolean> }>>({});
  const nodeIdRef = useRef<string>('agents-screen');
  const [activeExample, setActiveExample] = useState<{agentId: string, exampleIndex: number} | null>(null);
  const activeExampleRef = useRef(activeExample);
  const exampleResponsesRef = useRef(exampleResponses);
  const loadingExamplesRef = useRef(loadingExamples);

  useEffect(() => {
    activeExampleRef.current = activeExample;
    exampleResponsesRef.current = exampleResponses;
    loadingExamplesRef.current = loadingExamples;
  }, [activeExample, exampleResponses, loadingExamples]);

  const ttsWorkerRef = useRef<Worker | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    // Initialize example responses and loading states for all agents and their examples
    const initialResponses = agents.reduce((acc, agent) => {
      acc[agent.id] = {
        examples: agent.examples?.reduce((examples, _, index) => {
          examples[index] = '';
          return examples;
        }, {} as Record<number, string>) || {}
      };
      return acc;
    }, {} as Record<string, { examples: Record<number, string> }>);
    setExampleResponses(initialResponses);

    const initialLoadingStates = agents.reduce((acc, agent) => {
      acc[agent.id] = {
        examples: agent.examples?.reduce((examples, _, index) => {
          examples[index] = false;
          return examples;
        }, {} as Record<number, boolean>) || {}
      };
      return acc;
    }, {} as Record<string, { examples: Record<number, boolean> }>);
    setLoadingExamples(initialLoadingStates);

    // Initialize worker manager
    const initializeWorker = async () => {
      try {
        // Register message handler
        workerManager.registerNode((data) => {
          
          if (data.status === 'update' || data.status === 'complete') {
            // Extract content from the worker message
            let content = data.output;
            
            // Fall back to data.data if output isn't available
            if (!content && data.data) {
              content = data.data;
            }
            
            if (activeExampleRef.current) {
              const { agentId, exampleIndex } = activeExampleRef.current;
              if (content) {
                // Process content based on message type
                let processedContent = content;
                
                // Handle array response (for 'complete' status)
                if (data.status === 'complete' && Array.isArray(content) && content.length > 0) {
                  // Extract just the assistant's response part
                  const fullText = content[0];
                  const assistantPart = fullText.split('assistant:')[1];
                  if (assistantPart) {
                    processedContent = assistantPart.trim();
                  } else {
                    // If we can't find the assistant part, use existing content
                    processedContent = exampleResponsesRef.current[agentId]?.examples[exampleIndex] || '';
                  }
                }
                
                // DIRECT UPDATE - Force update the example responses state with the new content
                const newResponsesState = { ...exampleResponsesRef.current };
                
                // Initialize agent if not already in state
                if (!newResponsesState[agentId]) {
                  newResponsesState[agentId] = { examples: {} };
                } else if (!newResponsesState[agentId].examples) {
                  newResponsesState[agentId].examples = {};
                }
                
                // Set the processed content
                newResponsesState[agentId].examples[exampleIndex] = processedContent;
                
                setExampleResponses(newResponsesState);
              }
              
              // When complete, reset loading state
              if (data.status === 'complete') {
                setTimeout(() => {
                  const newLoadingState = {
                    ...loadingExamplesRef.current,
                    [agentId]: {
                      ...loadingExamplesRef.current[agentId],
                      examples: {
                      ...loadingExamplesRef.current[agentId]?.examples,
                      [exampleIndex]: false
                      }
                    }
                  };
                  loadingExamplesRef.current = newLoadingState;
                  setLoadingExamples(newLoadingState);
                }, 200);
              }
            }
          }
        }, nodeIdRef.current);
      } catch (error) {
        console.error('[AgentsScreen] Error initializing worker:', error);
      }
    };

    initializeWorker();

    // Check if this component has already been initialized
    if (speechWorkerManager.isComponentInitialized(nodeIdRef.current)) {
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
    speechWorkerManager.loadTts(agents[0].kokoroVoice);

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
      speechWorkerManager.unregisterTtsListener(nodeIdRef.current);
      workerManager.unregisterNode(nodeIdRef.current);
      
      // Reset state
      setExampleResponses({});
      setLoadingExamples({});
      
      // Instead of closing the audio context, we'll just suspend it
      // This allows it to be resumed later if needed
      if (audioContext.current && audioContext.current.state !== 'closed') {
        audioContext.current.suspend();
      }
    };
  }, [agents])

  const handleStop = () => {
    workerManager.sendMessage(nodeIdRef.current, { 
      type: 'cancel', 
      nodeId: nodeIdRef.current 
    });
  };

  const handleExampleClick = async (example: string, index: number) => {
    if (!selectedAgent) {
      console.warn('[AgentsScreen] Cannot process example: no agent selected');
      return;
    }

    // Set the active example in state
    setActiveExample({ agentId: selectedAgent.id, exampleIndex: index });

    try {
      // If we're already generating a response for another example, stop it by clearing the active example
      if (activeExample && activeExample.exampleIndex !== index) {
        // Reset loading state for the previous example
        setLoadingExamples(prev => {
          const newState = { ...prev };
          if (newState[activeExample.agentId]?.examples) {
            newState[activeExample.agentId].examples[activeExample.exampleIndex] = false;
          }
          return newState;
        });
        // Add a small delay to ensure the worker has processed the cancellation
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Toggle the active example - if clicking the same example, collapse it
      if (activeExample && activeExample.agentId === selectedAgent.id && activeExample.exampleIndex === index) {
        setActiveExample(null); // Collapse the example
        setLoadingExamples(prev => ({
          ...prev,
          [selectedAgent.id]: {
            ...prev[selectedAgent.id],
            examples: {
              ...prev[selectedAgent.id]?.examples,
              [index]: false
            }
          }
        }));
        return; // Don't generate a new response if collapsing
      }

      // Update loading state
      setLoadingExamples(prev => ({
        ...prev,
        [selectedAgent.id]: {
          ...prev[selectedAgent.id],
          examples: {
            ...prev[selectedAgent.id]?.examples,
            [index]: true
          }
        }
      }));

      const messages = [
        { role: 'system', content: selectedAgent.systemPrompt },
        { role: 'user', content: example }
      ];
      
      workerManager.sendMessage(nodeIdRef.current, {
        type: 'generate',
        messages,
        nodeId: nodeIdRef.current,
        modelConfig: selectedAgent.modelConfig
      });
    } catch (error) {
      console.error('[AgentsScreen] Error sending message:', error);
      setLoadingExamples(prev => ({
        ...prev,
        [selectedAgent.id]: {
          ...prev[selectedAgent.id],
          examples: {
            ...prev[selectedAgent.id]?.examples,
            [index]: false
          }
        }
      }));
      setExampleResponses(prev => ({
        ...prev,
        [selectedAgent.id]: {
          ...prev[selectedAgent.id],
          examples: {
            ...prev[selectedAgent.id]?.examples,
            [index]: 'Error: Failed to generate response. Please try again.'
          }
        }
      }));
    }
  };

  const handleVoiceMessage = (voice: string | undefined) => {

    const messages = [
      `Hello, I am ${selectedAgent?.name}.`,
      `I am ${selectedAgent?.name}. Nice to meet you!`,
      `Hey, I am ${selectedAgent?.name}. Let's get started!`
    ]

    ttsWorkerRef.current?.postMessage({ 
      type: 'synthesize', 
      data: messages[Math.floor(Math.random() * messages.length)],
      voice,
      speed: 1.2
    });
  }

  const filteredAgents = agents.filter(agent => 
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <AuthenticatedWorkspaceFrame sidebarCollapsed={sidebarCollapsed} showAgents={false}>
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="mb-6 relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm 
                  border border-violet-200/50 dark:border-violet-800/50 rounded-lg 
                  focus:outline-none focus:ring-2 focus:ring-violet-500/50
                  text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredAgents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => setSelectedAgent(agent)}
                className="bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm rounded-lg 
                  border border-violet-200/50 dark:border-violet-800/50 p-6 
                  hover:shadow-lg transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-violet-200/50 dark:border-violet-800/50">
                    <img 
                      src={agent.avatar} 
                      alt={agent.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      {agent.description}
                    </p>
                    {agent.capabilities && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {agent.capabilities.map((capability, index) => (
                          <span key={index} className="inline-flex items-center rounded-md bg-violet-100 dark:bg-violet-900/50 
                            px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                            {capability}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </AuthenticatedWorkspaceFrame>

      {/* Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg w-[80%] h-[80%] mx-4 relative">
            <button
              onClick={() => setSelectedAgent(null)}
              className="absolute right-4 top-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <X className="h-6 w-6" />
            </button>
            
            <div className="p-6">
              <div className="flex items-start gap-6 mb-6">
                <div className="w-60 h-60 rounded-lg overflow-hidden border-2 border-violet-200/50 dark:border-violet-800/50">
                  <img 
                    src={selectedAgent.avatar} 
                    alt={selectedAgent.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {selectedAgent.name}
                  </h2>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    {selectedAgent.description}
                  </p>
                  {selectedAgent.kokoroVoice && (
                    <span className="inline-flex items-center rounded-md bg-violet-100 dark:bg-violet-900/50 
                      px-2 py-1 text-sm font-medium text-violet-700 dark:text-violet-300 cursor-pointer"
                      onMouseEnter={() => handleVoiceMessage(selectedAgent.kokoroVoice)}>
                      <Volume2 className="h-4 w-4 mr-2" /> Test voice
                    </span>
                  )}

                  <h3 className="text-lg mt-4 font-semibold text-gray-900 dark:text-gray-100 mb-3">
                    Capabilities
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedAgent.capabilities.map((capability, index) => (
                      <span
                      key={index}
                      className="inline-flex items-center rounded-md bg-violet-100 dark:bg-violet-900/50 
                        px-2.5 py-1.5 text-sm font-medium text-violet-700 dark:text-violet-300"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Examples</h3>
                <div className="flex flex-col gap-2">
                  {selectedAgent.examples.map((example, index) => (
                    <div key={index} className="space-y-2">
                      <span
                        onClick={() => handleExampleClick(example, index)}
                        className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-sm font-medium cursor-pointer 
                          ${activeExample?.agentId === selectedAgent.id && activeExample?.exampleIndex === index
                            ? 'bg-sky-300 dark:bg-sky-700 text-sky-900 dark:text-sky-100 font-semibold'
                            : 'bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-800/50'
                          }`}
                      >
                        {example}
                        {loadingExamplesRef.current[selectedAgent.id]?.examples[index] ? (
                          <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 ml-2" />
                        )}
                      </span>
                      {/* Only show response container if this example is active */}
                      {selectedAgent && activeExample && activeExample.agentId === selectedAgent.id && activeExample.exampleIndex === index && (
                        <div className="pl-4 border-l-2 border-sky-200 dark:border-sky-800 mt-2 bg-white/80 dark:bg-slate-900/80 p-3 rounded-md">
                          {!exampleResponsesRef.current[selectedAgent.id]?.examples || !exampleResponsesRef.current[selectedAgent.id]?.examples[index] ? (
                            <p className="text-gray-600 dark:text-gray-400 italic">Generating response...</p>
                          ) : (
                            <div className="whitespace-pre-wrap font-normal text-sm max-h-[200px] overflow-y-auto pr-4 rounded scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent hover:scrollbar-thumb-gray-500 dark:hover:scrollbar-thumb-gray-500">{exampleResponsesRef.current[selectedAgent.id].examples[index]}</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
