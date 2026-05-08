import { useState, useRef, useEffect } from 'react';
import { X, Loader2, StopCircle, Volume2, Mic } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import workerManager from '../workers/workerManager';
import speechWorkerManager from '../workers/speechWorkerManager';
import { getAgentProfile } from '../config/agentProfiles';
import { ManagerProfile } from '@/config/managerProfiles';
import { useKanbanStore } from '@/store';
import { isTauriRuntime } from '@/config/nativeLlm';
import { parseAssistantActions } from '@/lib/assistantActionParser';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  officeManager: ManagerProfile | null;
  input: string;
  setInput: (input: string) => void;
}

const formatTime = (date: Date) => {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function ChatSidebar({ isOpen, onClose, officeManager, input, setInput }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const isPlayingRef = useRef(false);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const processedChunksRef = useRef<Set<string>>(new Set());
  const currentSentenceRef = useRef<string>('');
  const lastTranscriptionRef = useRef<string>(''); 
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const ttsWorkerRef = useRef<Worker | null>(null);
  const sttWorkerRef = useRef<Worker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const isProcessingTranscription = useRef(false); // Add this ref to prevent duplicate processing
  const navigate = useNavigate();
  const nodeIdRef = useRef<string>('chat-sidebar');
  const createTask = useKanbanStore((state) => state.createTask);
  const activeProject = useKanbanStore((state) => state.activeProject);
  const projects = useKanbanStore((state) => state.projects);

  const normalizeTaskStatus = (raw: unknown): 'draft' | 'todo' | 'inProgress' | 'done' => {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'draft') return 'draft';
    if (s === 'todo' || s === 'to do' || s === 'to-do') return 'todo';
    if (s === 'inprogress' || s === 'in_progress' || s === 'in progress') return 'inProgress';
    if (s === 'done' || s === 'completed' || s === 'complete') return 'done';
    return 'draft';
  };

  const normalizeProjectName = (raw: unknown): string => {
    const candidate = typeof raw === 'string' ? raw.trim() : '';
    if (!candidate) return activeProject?.name ?? projects[0]?.name ?? '';
    const match = projects.find((p) => p.name.toLowerCase() === candidate.toLowerCase());
    return match?.name ?? activeProject?.name ?? projects[0]?.name ?? candidate;
  };
  
  const processAudio = async (audioBuffer: ArrayBuffer) => {
    try {
      const audioContext = new AudioContext({ sampleRate: 16000 }); // Whisper expects 16kHz audio
      const audioBufferObject = await audioContext.decodeAudioData(audioBuffer);
      
      // Get audio data and ensure it's properly formatted
      const channelData = audioBufferObject.getChannelData(0);
      
      // Resample to 16kHz if needed
      let resampledData: Float32Array;
      if (audioBufferObject.sampleRate !== 16000) {
        
        const ratio = audioBufferObject.sampleRate / 16000;
        resampledData = new Float32Array(Math.floor(channelData.length / ratio));
        for (let i = 0; i < resampledData.length; i++) {
          resampledData[i] = channelData[Math.floor(i * ratio)];
        }
      } else {
        resampledData = channelData;
      }
      
      sttWorkerRef.current?.postMessage({
        type: 'transcribe',
        audio: resampledData,
        language: 'en',
        subtask: 'transcribe'
      });
    } catch (error) {
      console.error('Error processing audio:', error);
      setError('Failed to process audio');
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
  };

  const startRecording = async () => {

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];

      mediaRecorder.addEventListener('dataavailable', (event) => {
        audioChunks.push(event.data);
      });

      mediaRecorder.addEventListener('stop', async () => {
        const audioBlob = new Blob(audioChunks);
        const audioBuffer = await audioBlob.arrayBuffer();
        processAudio(audioBuffer);
        
        // Clean up
        stream.getTracks().forEach(track => track.stop());
      });

      setIsRecording(true);
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
    } catch (error) {
      console.error('Error starting recording:', error);
      stopRecording();
    }
  };

  useEffect(() => {
    if (messages.length === 0) {
      // Get the navigator profile for system prompt
      const navigatorProfile = getAgentProfile('navigator');
      
      // Define the system message using the profile's system prompt
      const systemMessage = {
        role: 'system',
        content: navigatorProfile.systemPrompt,
        timestamp: formatTime(new Date())
      } as Message;
      
      // Define the assistant's initial message
      const assistantMessage = {
        role: 'assistant',
        content: 'Hello! I am your Office manager. How can I assist you with your tasks today?',
        timestamp: formatTime(new Date())
      } as Message;
      
      // Set the messages in state
      setMessages([systemMessage, assistantMessage]);
    }
  }, []);

  useEffect(() => {
    const componentId = 'chat-sidebar';
    
    // Check if this component has already been initialized
    if (speechWorkerManager.isComponentInitialized(componentId)) {
      return;
    }
    
    // Use speechWorkerManager instead of creating new workers
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
    }
    
    // Create proxy objects that will forward calls to speechWorkerManager
    ttsWorkerRef.current = {
      postMessage: (message: any) => {
        speechWorkerManager.sendTtsMessage(message, 'chat-sidebar');
      },
      terminate: () => {
        speechWorkerManager.unregisterTtsListener('chat-sidebar');
      }
    } as unknown as Worker;
    
    sttWorkerRef.current = {
      postMessage: (message: any) => {
        speechWorkerManager.sendSttMessage(message, 'chat-sidebar');
      },
      terminate: () => {
        speechWorkerManager.unregisterSttListener('chat-sidebar');
      }
    } as unknown as Worker;

    // Use workerManager for chat worker with navigator profile
    const navigatorProfile = getAgentProfile('navigator');
    const chatNodeId = 'chat-sidebar';
    nodeIdRef.current = chatNodeId;
    
    // Register callbacks for speech worker messages
    speechWorkerManager.registerTtsListener((e) => {
      const { status, data } = e;
      
      switch (status) {
        case 'ready':
          console.log('[TTS] Model ready');
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
    }, 'chat-sidebar');
    
    speechWorkerManager.registerSttListener((e) => {
      const { status, data, error } = e;
      
      switch (status) {
        case 'loading':
          setLoadingStatus(data);
          break;
        case 'ready':
          console.log('[STT] Model ready');
          setLoadingStatus('');
          break;
        case 'update':
          // Handle streaming updates
          if (data && data.text) {
            setInput(data.text);
          }
          break;
        case 'transcription':
          if (data) {
            // Check if we're already processing a transcription
            if (isProcessingTranscription.current) {
              return;
            }
            
            // Check if we've already processed this exact transcription
            if (lastTranscriptionRef.current === data) {
              return;
            }
            
            // Set processing flag to prevent duplicate processing
            isProcessingTranscription.current = true;
            
            // Set the input field with the transcribed text
            setInput(data);
            
            // Only submit if not already in progress
            if (!isSubmitting && !isLoading) {
              // Set submitting flag immediately to prevent double submission
              setIsSubmitting(true);
              
              // Save this transcription to prevent duplicates
              lastTranscriptionRef.current = data;
              
              const transcribedText = data;
              
              // Create a user message with the transcribed text
              const userMessage: Message = {
                role: 'user',
                content: transcribedText,
                timestamp: formatTime(new Date())
              };
              
              // Create an empty assistant message that will be filled by the worker
              const assistantMessage: Message = {
                role: 'assistant',
                content: '',
                timestamp: formatTime(new Date())
              };
              
              // Update the UI with the new messages
              setMessages(prev => [...prev, userMessage, assistantMessage]);
              setInput(''); // Clear the input field
              
              // Prepare the message history for the worker
              const messageHistory = messages.concat(userMessage).map(msg => ({
                role: msg.role,
                content: msg.content
              }));
              
              // Set loading state
              setIsLoading(true);
              
              // Send the message to the worker
              workerRef.current?.postMessage({
                type: 'generate',
                data: messageHistory,
                nodeId: nodeIdRef.current
              });
            } else {
              console.log("Skipping submission - already in progress");
            }
            
            // Reset processing flag after a short delay
            setTimeout(() => {
              isProcessingTranscription.current = false;
            }, 1000);
          }
          break;
        case 'error':
          console.error('STT worker error:', error);
          setIsRecording(false);
          break;
        default:
          // Handle other messages
          console.log('STT worker message:', e);
      }
    }, 'chat-sidebar');
    
    // Register callback for chat worker messages
    workerManager.registerNode((e) => {
      // Destructure with defaults to handle both property names
      const { status, data, output, nodeId } = e;
      
      switch (status) {
        case 'loading':
          setLoadingStatus(data);
          break;
        case 'ready':
          setIsModelLoading(false);
          setLoadingStatus('');
          // Load TTS/STT models through speechWorkerManager.
          // NOTE: our STT/TTS workers are WebGPU-only today; on Windows WebView2 this can fail/noise and
          // also interfere with heavy transform UIs (React Flow). Skip preloading in Tauri for stability.
          if (!isTauriRuntime()) {
            speechWorkerManager.loadTts(officeManager?.kokoroVoice || navigatorProfile.kokoroVoice);
            speechWorkerManager.loadStt();
          }
          break;
        case 'start':
          if (nodeId === chatNodeId) {
            null;
          }
          break;
        case 'update':
          if (nodeId === chatNodeId) {
            const outputContent = data || output; // Accept both data and output properties
            
            // Skip processing if no content
            if (!outputContent) {
              console.warn('Received empty output content from chat worker');
              break;
            }
            
            // Extract and process any action commands
            const { cleanContent, hasAction } = extractAndProcessActions(outputContent);
            
            let generateSpeech = window.sessionStorage.getItem("voiceMode") == "yes" ? true : false;
            if (generateSpeech && !hasAction && cleanContent) {
              const sentenceMatch = cleanContent.match(/[^.!?]*[.!?](?:\s|$)/g);
              
              if (sentenceMatch && sentenceMatch.length > 0) {
                // Get the last complete sentence from the output
                const lastSentence = sentenceMatch[sentenceMatch.length - 1];
                if (lastSentence) {
                  const lastSentenceIndex = cleanContent.lastIndexOf(lastSentence);
                  
                  // Everything up to the last complete sentence
                  const completeContent = cleanContent.slice(0, lastSentenceIndex + lastSentence.length);
                  // Remaining incomplete sentence
                  const incompleteContent = cleanContent.slice(lastSentenceIndex + lastSentence.length);
                  
                  // Process complete sentences
                  const sentences = completeContent.match(/[^.!?]*[.!?](?:\s|$)/g) || [];
                  sentences.forEach((sentence: string) => {
                    const trimmedSentence = sentence.trim();
                    if (trimmedSentence && !processedChunksRef.current.has(trimmedSentence)) {
                      processedChunksRef.current.add(trimmedSentence);
                      ttsWorkerRef.current?.postMessage({ 
                        type: 'synthesize', 
                        data: trimmedSentence,
                        voice: officeManager?.kokoroVoice || navigatorProfile.kokoroVoice
                      });
                    }
                  });
                  
                  // Save incomplete sentence for next update
                  currentSentenceRef.current = incompleteContent;
                }
              } else {
                // No complete sentences yet, accumulate text
                currentSentenceRef.current = cleanContent;
              }
            }

            // Update messages state
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              
              if (lastMessage?.role === 'assistant') {
                newMessages[newMessages.length - 1] = {
                  ...newMessages[newMessages.length - 1],
                  content: cleanContent // Use the cleaned content without action commands
                };
              }
              return newMessages;
            });
          }
          break;
        case 'complete':
          let generateSpeech = window.sessionStorage.getItem("voiceMode") == "yes" ? true : false;
          if (nodeId === chatNodeId) {
            // Get the last message and check for actions before final TTS
            const lastMessage = messages[messages.length - 1]?.content;
            let hasAction = false;
            
            if (lastMessage) {
              const result = extractAndProcessActions(lastMessage);
              hasAction = result.hasAction;
            }
            
            if (generateSpeech && currentSentenceRef.current && !hasAction) {
              const finalSentence = currentSentenceRef.current.trim();
              if (finalSentence && !processedChunksRef.current.has(finalSentence)) {
                ttsWorkerRef.current?.postMessage({ 
                  type: 'synthesize', 
                  data: finalSentence,
                  voice: officeManager?.kokoroVoice || navigatorProfile.kokoroVoice
                });
              }
            }
            
            setIsLoading(false);
            setIsSubmitting(false); // Reset submission flag when generation is complete
            processedChunksRef.current.clear();
            currentSentenceRef.current = '';
          }
          break;
        case 'error':
          console.error('Chat worker error:', data);
          if (nodeId === chatNodeId) {
            setError(data);
            setIsModelLoading(false);
            setIsSubmitting(false); // Reset submission flag on error
            setIsLoading(false);
          }
          break;
      }
    }, nodeIdRef.current);

    // Set workerRef to a proxy object that forwards calls to workerManager
    workerRef.current = {
      postMessage: (message: any) => {
        // Add the navigator profile's modelConfig if it's a generate message
        if (message.type === 'generate') {
          const enhancedMessage = {
            ...message,
            messages: message.data, // Map data to messages for the enhanced worker
            modelConfig: navigatorProfile.modelConfig
          };
          workerManager.sendMessage(chatNodeId, enhancedMessage);
        } else {
          workerManager.sendMessage(chatNodeId, message);
        }
      },
      terminate: () => {
        workerManager.unregisterNode(chatNodeId);
      }
    } as unknown as Worker;

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
        console.log('[AUDIO] Started playback');
      } catch (error) {
        console.error('[AUDIO] Playback error:', error);
        audioQueueRef.current.shift(); // Remove errored buffer
        playNextInQueue(); // Try next one
      }
    };

    // Load the model through workerManager
    workerManager.loadModel();

    return () => {
      // Clean up
      if (workerRef.current) {
        workerManager.unregisterNode(chatNodeId);
      }
      // Clean up speech worker listeners
      speechWorkerManager.unregisterTtsListener('chat-sidebar');
      speechWorkerManager.unregisterSttListener('chat-sidebar');
      
      // Instead of closing the audio context, we'll just suspend it
      // This allows it to be resumed later if needed
      if (audioContext.current && audioContext.current.state !== 'closed') {
        audioContext.current.suspend();
      }
    };
  }, []);

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
      window.sessionStorage.setItem("voiceMode", "yes");
    }
    let genSpeech = window.sessionStorage.getItem("voiceMode");
    console.log("Generate speech: ", genSpeech);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmitWithText = (text: string) => {
    // Prevent multiple concurrent submissions
    if (isSubmitting || isLoading) {
      console.log('Submission already in progress, ignoring duplicate submit');
      return;
    }
    
    if (!text.trim()) {
      console.log('Empty text, ignoring submission');
      return;
    }
    
    // Check if worker is available
    if (!workerRef.current) {
      console.error('Worker not initialized');
      setError('Chat service not available. Please try again later.');
      return;
    }
    
    // Check if model is still loading
    if (isModelLoading) {
      console.log('Model is still loading, queuing message for later');
      setError('Please wait for the model to finish loading');
      return;
    }
    
    console.log('Model is loaded, proceeding with generation');

    const userMessage: Message = {
      role: 'user',
      content: text,
      timestamp: formatTime(new Date())
    };

    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: formatTime(new Date())
    };

    // Update the UI with the new messages
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput(''); // Clear the input field
    setIsLoading(true);

    // Prepare the message history for the worker
    // Only include role and content, not timestamp
    const messageHistory = messages.concat(userMessage).map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    workerRef.current?.postMessage({
      type: 'generate',
      data: messageHistory,
      nodeId: nodeIdRef.current
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent multiple concurrent submissions
    if (isSubmitting || isLoading) {
      console.log('Submission already in progress, ignoring duplicate submit');
      return;
    }
    
    // Prevent processing if it's being called from a form submission after transcription
    if (isRecording) {
      console.log('Ignoring form submission while recording');
      return;
    }
    
    // Use the current input value
    handleSubmitWithText(input);
  };

  const handleCancel = () => {
    if (workerRef.current) {
      workerRef.current.postMessage({ 
        type: 'cancel', 
        nodeId: nodeIdRef.current 
      });
      setIsLoading(false);
    }
  };

  const extractAndProcessActions = (content: string): { cleanContent: string; hasAction: boolean } => {
    const parsed = parseAssistantActions(content);
    if (parsed.actions.length === 0) {
      return { cleanContent: parsed.cleanText, hasAction: false };
    }

    for (const action of parsed.actions) {
      if (action.kind === 'goto') {
        goToScreen(action.screenName);
      } else if (action.kind === 'create_task') {
        const project = normalizeProjectName(action.task.project);
        const status = normalizeTaskStatus(action.task.status);
        createTask(action.task.title || 'Untitled task', action.task.description ?? '', project, status);
        goToScreen('/tasks');
      }
    }

    const cleanContent =
      parsed.actions.some((a) => a.kind === 'create_task')
        ? '<task created>'
        : parsed.actions.some((a) => a.kind === 'goto')
          ? '<screen changed>'
          : parsed.cleanText;

    return { cleanContent, hasAction: true };
  };
  
  const goToScreen = (screenName: string) => {
    console.log(`Navigating to screen: ${screenName}`);
    
    // Map screen names to routes
    const screenRoutes: Record<string, string> = {
      tasks: '/tasks',
      agents: '/agents',
      data: '/data',
      settings: '/settings',
      playground: '/playground',
      engine: '/engine',
      'agent-sop': '/agent-sop',
      sop: '/agent-sop',
      delegate: '/',
      hub: '/',
    };
    
    // Convert to lowercase for case-insensitive matching
    const normalizedName = screenName.toLowerCase().replace('/', '');
    
    if (screenRoutes[normalizedName]) {
      navigate(screenRoutes[normalizedName]);
    } else {
      console.warn(`Unknown screen name: ${screenName}`);
    }
  };

  return (
    <div
      className={`fixed right-0 bottom-24 h-[600px] w-80 bg-white/30 dark:bg-blue-950/30 
        backdrop-blur-sm border border-violet-200/50 dark:border-blue-800/50 
        shadow-xl shadow-violet-200/20 dark:shadow-blue-900/20 rounded-l-xl
        transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-violet-200/50 dark:border-blue-800/50">
          <div className="flex items-center">
            {/* <MessageSquare className="w-5 h-5 text-violet-600 dark:text-blue-400" /> */}
            <img src={officeManager !== null ? officeManager.avatar : '/avatars/office_manager.png'} className="w-10 h-10 rounded-full" />
            <h2 className="text-md font-semibold text-gray-800 dark:text-gray-100 ml-2">Office Manager</h2>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleMicClick}
              className={`p-2 hover:bg-gray-200 rounded-full ${isRecording ? 'bg-red-100 animate-pulse' : isVoiceMode ? 'bg-blue-100' : ''}`}
              title={isVoiceMode ? 'Disable voice mode' : 'Enable voice mode'}
              disabled={isModelLoading}
            >
              {isRecording ? 
                <Mic size={20} className="text-red-500" /> : 
                <Volume2 size={20} className={isVoiceMode ? "text-blue-500" : ""} />
              }
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-full"
              title="Close chat"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isModelLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-4">
              <div className="relative">
                <Loader2 className="w-8 h-8 animate-spin text-violet-600 dark:text-blue-400" />
                <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 min-w-[4rem] text-center">
                  <span className="text-sm font-medium text-violet-600 dark:text-blue-400">
                    {loadingStatus}
                  </span>
                </div>
              </div>
              <span className="text-sm pt-20 w-[80%] text-center">
                Loading private AI models to your device. It can take a minute or two...
              </span>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                message.role !== 'system' && (
                  <div key={index} className="space-y-1">
                  <div
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 whitespace-pre-wrap break-words ${
                        message.role === 'user'
                          ? 'bg-violet-500 text-white text-sm'
                          : 'bg-white/50 dark:bg-blue-900/50 text-gray-800 dark:text-gray-100 text-sm'
                      }`}
                    >
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  </div>
                  <div 
                    className={`flex items-center space-x-1 text-xs text-gray-500 
                      ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <span className={message.role === 'user' ? '' : 'pl-1'}>{message.role === 'user' ? 'You' : 'Office Manager'}</span>
                    <span>•</span>
                    <span className={message.role === 'user' ? 'pr-1' : ''}>{message.timestamp}</span>
                  </div>
                </div>
                )
                
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4 border-t border-violet-200/50 dark:border-blue-800/50">
          <div className="flex space-x-2">
            {isVoiceMode ? (
              <div className="flex-1 p-2 border rounded bg-white/50 dark:bg-blue-900/50 
                border-violet-200/50 dark:border-blue-800/50 text-gray-800 dark:text-gray-100
                flex items-center justify-between">
                <span className="text-sm italic text-gray-500">
                  {isRecording ? 'Listening...' : input || 'Type your message...'}
                </span>
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`}></div>
              </div>
            ) : (
              <input
                type="text"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 p-2 border rounded bg-white/50 dark:bg-blue-900/50 
                  border-violet-200/50 dark:border-blue-800/50 text-gray-800 dark:text-gray-100
                  placeholder-gray-500 dark:placeholder-gray-400"
                disabled={isLoading || isModelLoading || isVoiceMode}
              />
            )}
            {isLoading ? (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <StopCircle className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading || isModelLoading || (isVoiceMode && !input)}
                className="px-4 py-2 bg-violet-500 text-white rounded hover:bg-violet-600 
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isModelLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Send'
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}