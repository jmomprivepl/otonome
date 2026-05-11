import { Handle, Position, NodeProps } from 'reactflow';
import { useState, useEffect, useRef } from 'react';
import workerManager from '@/workers/workerManager';
import speechWorkerManager from '@/workers/speechWorkerManager';
import { Send, Loader2, Volume2, Mic, Settings, StopCircle } from 'lucide-react';
import { agentProfiles, getAgentProfile } from '@/config/agentProfiles';
import { ChatNodeQueue } from '@/utils/ChatNodeQueue';
import { parseAssistantActions } from '@/lib/assistantActionParser';

import { exaSearch, exaAnswer } from '@/exaops';
import { listBases, listTables, listRecords } from '@/airtableops';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Extended NodeProps data for ChatNode
interface ChatNodeData {
  label: string;
  selectedProfile: string;
  messages: Message[];
  initialUserMessage?: string;
  onNodesChange: (changes: any[]) => void;
  onEdgesChange: (changes: any[]) => void;
  position: { x: number, y: number };
  taskId?: string;
  messageDelay?: number;
  onCreateSubtaskNodes?: (subtasks: any[], position: { x: number, y: number }) => void;
}

export function ChatNode({ data, id }: NodeProps<ChatNodeData>) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(data.selectedProfile);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ttsWorkerRef = useRef<Worker | null>(null);
  const sttWorkerRef = useRef<Worker | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const processedChunksRef = useRef<Set<string>>(new Set());
  const currentSentenceRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isProcessingTranscription = useRef(false);

  const [actionExecuted, setActionExecuted] = useState(false);
  const [exaActions, setExaActions] = useState<string[]>([]);
  const [airtableActions, setAirtableActions] = useState<string[]>([]);
  const queue = useRef(ChatNodeQueue.getInstance());

  useEffect(() => {
    queue.current.subscribeToQueue(id, (processingNodeId: string) => {
      if (processingNodeId !== id) return;
      
      // This node is now at the front of the queue and should start processing
      setIsLoading(true);
      
      // If we have messages and an initial user message, send it to the worker now
      if (data.initialUserMessage && messages.length > 0 && messages.some(m => m.role === 'system') && !messages.some(m => m.role === 'user')) {
        const initialMessage = data.initialUserMessage;
        setMessages(prev => [...prev, { role: 'user', content: initialMessage }]);
        
        // Send message through worker manager
        workerManager.sendMessage(id, {
          type: 'generate',
          messages: [...messages, { role: 'user', content: initialMessage }],
          modelConfig: agentProfiles[selectedProfile].modelConfig
        });
        
        setActionExecuted(false);
      }
    });
  }, [id, messages, data.initialUserMessage, selectedProfile]);

  useEffect(() => {
    return () => {
      queue.current.unsubscribeFromQueue(id);
    };
  }, [id]);

  // Handle initialUserMessage for subtask nodes
  useEffect(() => {
    if (data.initialUserMessage && messages.length === 0) {
      // Get the agent profile based on selectedProfile or use taskManager as default
      const agentId = selectedProfile || 'taskManager';
      const agent = agentProfiles[agentId];
      
      if (agent) {
        // Set up the initial messages with system prompt only
        // We'll add the user message when this node reaches the front of the queue
        const initialMessages: Message[] = [
          {
            role: 'system',
            content: agent.systemPrompt
          }
        ];
        setMessages(initialMessages);
        
        // We don't send the message to the worker here
        // Instead, we'll wait for the queue to tell us when it's our turn
        // The message will be sent in the queue subscription callback
      }
    }
  }, [data.initialUserMessage, messages.length, selectedProfile]);

  useEffect(() => {
    if (exaActions.length > 0) {
      console.log('Exa actions', exaActions);
      const executeAction = async () => {
        console.log('Executing exa action', exaActions[0]);
        try {
          console.log('Exa action name:', exaActions[0]);
          if (exaActions[0] === 'search' || exaActions[0] === 'getanswer') {
            // Create a new output node
            const outputNodeId = crypto.randomUUID();
            const outputNode = {
              id: outputNodeId,
              type: 'output',
              position: { 
                x: data.position.x + 500,
                y: data.position.y
              },
              data: { 
                label: exaActions[0] === 'search' ? 'Search Results' : 'Answer',
                content: 'Loading results...'
              }
            };
            
            // Create an edge connecting this node to the output node
            const edge = {
              id: `${id}-${outputNodeId}`,
              source: id,
              target: outputNodeId,
              type: 'animated'
            };

            // Add the node and edge to the flow
            data.onNodesChange([{ type: 'add', item: outputNode }]);
            data.onEdgesChange([{ type: 'add', item: edge }]);

            // Execute the search/answer and update the output node
            let resultContent = '';
            if (exaActions[0] === 'search') {
              const searchResults = await exaSearch(exaActions[1]);
              resultContent = searchResults.results.map(result => 
                `${result.title}\n${result.text}\n${result.url}`
              ).join('\n\n');
            } else {
              const answerResults = await exaAnswer(exaActions[1]);
              resultContent = `${answerResults.answer}\n\nSources:\n${
                answerResults.citations.map(c => `${c.text}\n${c.url}`).join('\n\n')
              }`;
            }

            // Update the output node's content
            data.onNodesChange([{
              type: 'change',
              id: outputNodeId,
              data: { 
                label: exaActions[0] === 'search' ? 'Search Results' : 'Answer',
                content: resultContent
              }
            }]);
          }
          setExaActions([]);
        } catch (error) {
          console.error('Error executing action:', error);
          setExaActions([]);
        }
      }
      executeAction();
    }
  }, [exaActions, id, data]);

  useEffect(() => {
    if (airtableActions.length > 0) {
      const executeAction = async () => {
        try {
          console.log('Airtable action name:', airtableActions[0]);
          if (airtableActions[0] === 'list_records') {
            
            const bases = await listBases();
            let baseId = "";
          
            if (bases.length === 1) {
              baseId = bases[0].id;
            } else if (bases.length > 1) {
              for (const base of bases) {
                try {
                  baseId = base.id;
                  break;
                } catch (error) {
                  null;
                }
              }
            } else {
              return;
            }

            // Get the table ID from the table name
            const tables = await listTables(baseId);
            const tableName = airtableActions[1];
            
            const table = tables.find(t => t.name === tableName);
            if (!table) {
              console.error("Table not found:", tableName);
              return;
            }

            const records = await listRecords(baseId, table.id);

            // Format records to match DataScreen format
            const formattedRecords = records.map(record => ({
              id: record.id,
              fields: record.fields,
              createdTime: record.createdTime
            }));

            const outputContent = JSON.stringify(formattedRecords, null, 2);
            const outputNode = {
              id: crypto.randomUUID(),
              type: 'output',
              position: { 
                x: data.position.x + 500,
                y: data.position.y
              },
              data: { 
                label: `${tableName} Records`,
                content: outputContent
              }
            };

            const edge = {
              id: `${id}-${outputNode.id}`,
              source: id,
              target: outputNode.id,
              type: 'animated'
            };

            data.onNodesChange([{ type: 'add', item: outputNode }]);
            data.onEdgesChange([{ type: 'add', item: edge }]);
          }
          
        } catch (error) {
          console.error('Error executing action:', error);
        }
      }

      executeAction();
    }
  }, [airtableActions, id, data]);  

  useEffect(() => {
    // Check if this component has already been initialized
    if (speechWorkerManager.isComponentInitialized(id)) {
      return;
    }
    
    // Use speechWorkerManager instead of creating new workers
    // Initialize audio context only when needed
    if (!audioContext.current || audioContext.current.state === 'closed') {
      audioContext.current = new AudioContext();
    }
    
    // Create proxy objects that will forward calls to speechWorkerManager
    ttsWorkerRef.current = {
      postMessage: (message: any) => {
        speechWorkerManager.sendTtsMessage(message, id);
      },
      terminate: () => {
        speechWorkerManager.unregisterTtsListener(id);
      }
    } as unknown as Worker;
    
    sttWorkerRef.current = {
      postMessage: (message: any) => {
        speechWorkerManager.sendSttMessage(message, id);
      },
      terminate: () => {
        speechWorkerManager.unregisterSttListener(id);
      }
    } as unknown as Worker;

    // Get the selected agent profile
    const agentProfile = getAgentProfile(selectedProfile);
    
    // Register callbacks for speech worker messages
    speechWorkerManager.registerTtsListener((e) => {
      const { status, data } = e;
      
      switch (status) {
        case 'ready':
          break;
        case 'chunk':
          if (!audioContext.current || audioContext.current.state === 'closed') {
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
    }, id);
    
    speechWorkerManager.registerSttListener((e) => {
      const { status, data, error } = e;
      
      switch (status) {
        case 'ready':
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
            
            // Set processing flag to prevent duplicate processing
            isProcessingTranscription.current = true;
            
            // Set the input field with the transcribed text
            setInput(data);
            
            // Only submit if not already in progress
            if (!isLoading) {
              
              const userMessage: Message = { role: 'user', content: data };
              setMessages(prev => [...prev, userMessage]);
              setInput('');
              setIsLoading(true);

              // Get the selected agent profile
              const agentProfile = getAgentProfile(selectedProfile);
              
              // Prepare the message history
              const messageHistory = [...messages, userMessage];
              
              // Send the message to the worker with the selected profile's model config
              workerManager.sendMessage(id, {
                type: 'generate',
                messages: messageHistory,
                modelConfig: agentProfile.modelConfig
              });
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
      }
    }, id);

    // Register this node with the worker manager
    workerManager.registerNode((data) => {
      if (data.status === 'update' || data.status === 'complete') {
        const outputContent = data.output;

        if (typeof outputContent !== 'string') {
          setIsLoading(false);
          return;
        }

        let cleanContent: string | undefined;
        let hasAction: boolean;

        // Always check for actions in the output, even during updates
        // This ensures we process task decomposition as soon as the JSON appears
        if (!actionExecuted) {
          ({ cleanContent, hasAction } = extractActions(outputContent, true));
          if (hasAction) {
            setActionExecuted(true);
          }
        } else {
          // Still check for actions but don't process them
          ({ cleanContent, hasAction } = extractActions(outputContent));
        }
        
        // Process TTS if voice mode is enabled
        if (isVoiceMode && cleanContent && !hasAction) {
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
                    voice: agentProfile.kokoroVoice || undefined
                });
              }
            });
              
              // Save incomplete sentence for next update
              currentSentenceRef.current = incompleteContent;
            }
          } else {
            // No complete sentences yet, accumulate text
            currentSentenceRef.current = outputContent;
          }
        }

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage.content && lastMessage.role === 'assistant') {
            newMessages[newMessages.length - 1] = {
              role: 'assistant',
              content: cleanContent
            };
          } else {
            newMessages.push({ role: 'assistant', content: cleanContent });
          }
          return newMessages;
        });

        // When complete, reset loading state and clear any accumulated sentence
        if (data.status === 'complete') {
          
          //Process any remaining TTS content
          if (isVoiceMode && currentSentenceRef.current) {
            const finalSentence = currentSentenceRef.current.trim();
            if (finalSentence && !processedChunksRef.current.has(finalSentence)) {
              ttsWorkerRef.current?.postMessage({ 
                type: 'synthesize', 
                data: finalSentence,
                voice: agentProfile.kokoroVoice || undefined
              });
            }
            processedChunksRef.current.clear();
            currentSentenceRef.current = '';
          }
          setIsLoading(false);
        }
      }
    }, id);

    // Initialize TTS and STT workers through speechWorkerManager
    speechWorkerManager.loadTts(agentProfile.kokoroVoice);
    speechWorkerManager.loadStt();

    // Function to play the next audio in queue
    const playNextInQueue = async () => {
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
      }

      // Check if audio context is valid
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
      workerManager.unregisterNode(id);
      speechWorkerManager.unregisterTtsListener(id);
      speechWorkerManager.unregisterSttListener(id);
      
      // Instead of closing the audio context, we'll just suspend it
      // This allows it to be resumed later if needed
      if (audioContext.current && audioContext.current.state !== 'closed') {
        try {
          audioContext.current.suspend();
        } catch (error) {
          console.error('[AUDIO] Error suspending audio context:', error);
        }
      }
    };
  }, [id, selectedProfile, isVoiceMode]);

  useEffect(() => {

    const agentProfile = getAgentProfile(selectedProfile);

    if (messages.length === 0 && !data.initialUserMessage) {
      // Define the system message using the profile's system prompt
      const systemMessage = {
        role: 'system',
        content: agentProfile.systemPrompt,
      } as Message;
      
      // Define the assistant's initial message
      const assistantMessage = {
        role: 'assistant',
        content: `Hello! I am your ${agentProfile.name}. How can I assist you with your tasks today?`,
      } as Message;
      
      // Set the messages in state
      setMessages([systemMessage, assistantMessage]);
    }
  }, [selectedProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle initial user message if provided
  useEffect(() => {
    // If there's an initial user message and no user messages yet, send it automatically
    if (data.initialUserMessage && messages.length > 0 && !messages.some(m => m.role === 'user')) {
      const initialMessage = data.initialUserMessage;
      setMessages(prev => [...prev, { role: 'user', content: initialMessage }]);
      
      // Check if this node is currently being processed by the queue
      if (queue.current.isNodeProcessing(id)) {
        // Send message through worker manager only if this node is at the front of the queue
        workerManager.sendMessage(id, {
          type: 'generate',
          messages: [...messages, { role: 'user', content: initialMessage }],
          modelConfig: agentProfiles[selectedProfile].modelConfig
        });
        
        setIsLoading(true);
        setActionExecuted(false);
      }
    }
  }, [messages, data.initialUserMessage, id, selectedProfile]);

  const extractActions = (
    content: string,
    processAction: boolean = false,
  ): { cleanContent: string; hasAction: boolean } => {
    const parsed = parseAssistantActions(content);
    const hasAction = parsed.actions.length > 0;

    if (processAction && hasAction) {
      for (const action of parsed.actions) {
        if (action.kind === 'search') {
          setExaActions(['search', action.request]);
        } else if (action.kind === 'getanswer') {
          setExaActions(['getanswer', action.request]);
        } else if (action.kind === 'list_records') {
          setAirtableActions(['list_records', action.request]);
        } else if (action.kind === 'decompose_task') {
          action.subtasks.forEach((subtask, index) => {
            const subtaskNodeId = crypto.randomUUID();
            const subtaskNode = {
              id: subtaskNodeId,
              type: 'chatNode',
              position: {
                x: data.position.x + 500 + index * 100,
                y: data.position.y - 200 + index * 150,
              },
              data: {
                label: subtask.title ?? `Subtask ${index + 1}`,
                selectedProfile: subtask.suggestedAgent,
                messages: [],
                initialUserMessage: subtask.description || subtask.title || '',
                onNodesChange: data.onNodesChange,
                onEdgesChange: data.onEdgesChange,
                position: {
                  x: data.position.x + 500 + index * 100,
                  y: data.position.y - 200 + index * 150,
                },
                messageDelay: index * 500,
              },
            };

            const edge = {
              id: `${id}-${subtaskNodeId}`,
              source: id,
              target: subtaskNodeId,
              type: 'animated',
            };

            data.onNodesChange([{ type: 'add', item: subtaskNode }]);
            data.onEdgesChange([{ type: 'add', item: edge }]);
            queue.current.enqueueNode(subtaskNodeId, subtask.description || subtask.title || '', id);
          });
        }
      }
    }

    return { cleanContent: parsed.cleanText, hasAction };
  };

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    
    try {
      // Send message through worker manager with the node's id
      workerManager.sendMessage(id, {
        type: 'generate',
        messages: [...messages, { role: 'user', content: input }],
        modelConfig: agentProfiles[selectedProfile].modelConfig
      });
      
      setInput('');
      setActionExecuted(false);
    } catch (error) {
      console.error('Error sending message:', error);
      setIsLoading(false);
    }
  };

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleCancel = () => {
    workerManager.sendMessage(id, { type: 'cancel' });
    setIsLoading(false);
  };

  const toggleVoiceMode = () => {
    setIsVoiceMode(!isVoiceMode);
  };

  const startRecording = async () => {
      try {
        // Start recording
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

  const stopRecording = () => {
    setIsRecording(false);
    mediaRecorderRef.current?.stop();
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
        console.log(`Resampling from ${audioBufferObject.sampleRate}Hz to 16000Hz`);
        
        const ratio = audioBufferObject.sampleRate / 16000;
        resampledData = new Float32Array(Math.floor(channelData.length / ratio));
        for (let i = 0; i < resampledData.length; i++) {
          resampledData[i] = channelData[Math.floor(i * ratio)];
        }
      } else {
        resampledData = channelData;
      }
      
      console.log(`Audio data: length=${resampledData.length}, sampleRate=16000Hz`);
      
      sttWorkerRef.current?.postMessage({
        type: 'transcribe',
        audio: resampledData,
        language: 'en',
        subtask: 'transcribe'
      });
      } catch (error) {
      console.error('Error processing audio:', error);
      }
  };

  const toggleDetails = () => {
    setShowDetails(!showDetails);
  }

  const toggleSettings = () => {
    setShowSettings(!showSettings);
    
    // Force ReactFlow to recalculate node dimensions after state update
    setTimeout(() => {
      const event = new Event('resize');
      window.dispatchEvent(event);
    }, 100);
  };

  const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProfile(e.target.value);
    setMessages([]);
    
    // Force ReactFlow to recalculate node dimensions
    setTimeout(() => {
      const event = new Event('resize');
      window.dispatchEvent(event);
    }, 100);
  };

  // Function to play the next audio in queue
  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const buffer = audioQueueRef.current[0];

    try {
      const audioBuffer = await audioContext.current!.decodeAudioData(buffer.slice(0));
      const source = audioContext.current!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.current!.destination);
      
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

  return (
    <div className="shadow-md rounded-md border-2 w-[280px] border-violet-200 dark:border-sky-800 bg-gradient-to-br from-white to-violet-100 dark:from-gray-900 dark:to-cyan-800">
      <Handle type="target" position={Position.Left} className="!bg-violet-500" />
      <div className="p-2 border-b border-violet-200 bg-violet-50 dark:bg-sky-950 dark:border-sky-800 flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <div className="z-100 cursor-pointer relative" onMouseEnter={() => toggleDetails()} onMouseLeave={() => toggleDetails()}>
            <img 
                className="w-10 h-10 rounded" 
                src={agentProfiles[selectedProfile].avatar} 
                alt="Avatar" 
            />
          </div>
          <div id="workmate-details" className={`absolute flex flex-row top-[0px] left-[300px] w-96 bg-white dark:bg-sky-950 dark:text-white border border-gray-300 rounded shadow-lg p-2 ${showDetails ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}>
              <img 
                  src={agentProfiles[selectedProfile].avatar} 
                  alt="Full Size" 
                  className="w-48 h-auto" 
              />
              <div className="w-48 px-3">
                  <p className="text-lg text-gray-600 dark:text-gray-400 mt-2">{agentProfiles[selectedProfile].name}</p>
                  <p>{agentProfiles[selectedProfile].description}</p>
              </div>
          </div>
        </div>
        <div className="font-bold text-lg text-violet-700 dark:text-violet-100">{agentProfiles[selectedProfile].name}</div>
        <button
          onClick={toggleSettings}
          className="p-1 rounded-full hover:bg-violet-200 text-violet-700 dark:text-violet-500 dark:hover:bg-sky-200"
          title="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
      
      {showSettings && (
        <div className="p-2 border-b border-violet-200 bg-gray-50">
          <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-600">Agent Profile</label>
            <select
              value={selectedProfile}
              onChange={handleProfileChange}
              className="text-sm border border-gray-300 rounded p-1"
            >
              {Object.keys(agentProfiles).map(profileId => (
                <option key={profileId} value={profileId}>
                  {agentProfiles[profileId].name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      
      <div className="flex flex-col min-h-[300px]">
        <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[400px]">
          {messages.map((msg, idx) => (
            msg.role !== 'system' && (
              <div
                key={idx}
                className={`p-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-violet-100 ml-4'
                    : 'bg-gray-100 mr-4'
                }`}
              >
                {msg.content}
              </div>
            )
          ))}
          {isLoading && (
            <div className="flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div className="p-2 border-t border-gray-200">
          <div className="flex items-center gap-2">
            
            {!isVoiceMode && (
              <button
              onClick={toggleVoiceMode}
              className={`p-1 rounded-md ${isVoiceMode ? 'bg-violet-100 text-violet-500 dark:text-violet-100' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-sky-700'}`}
              title={isVoiceMode ? 'Disable Voice Mode' : 'Enable Voice Mode'}
            >
              <Volume2 size={20} />
            </button>
            )}
            
            {isVoiceMode && (
              <button
                onClick={handleMicClick}
                className={`p-1 rounded-md ${isRecording ? 'bg-red-100 text-red-500 animate-pulse' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-sky-700'}`}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
                disabled={isLoading}
              >
                <Mic size={20} />
              </button>
            )}
            
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Type a message..."
              className="flex-1 p-1 border rounded-md focus:outline-none focus:ring-1 focus:ring-violet-500 dark:bg-sky-950 dark:text-white"
              disabled={isLoading || isRecording}
            />
            
            <button
            onClick={handleSubmit}
              className="p-1 rounded-md text-violet-500 hover:bg-violet-100 disabled:opacity-50 dark:text-violet-100 dark:hover:bg-sky-700"
              disabled={!input.trim() || isLoading}
            >
              {isLoading ? <StopCircle size={20} onClick={handleCancel} /> : <Send size={20} />}
            </button>
            
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-violet-500" />
    </div>
  );
}
