import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ManagerProfile } from '@/config/managerProfiles';
import { managerProfiles } from '@/config/managerProfiles';

interface ManagerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (manager: ManagerProfile) => void;
  currentManager: ManagerProfile | null;
}

export const ManagerSelectionModal: React.FC<ManagerSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentManager
}) => {
  const audioContext = useRef<AudioContext | null>(null);
  const ttsWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize TTS worker
    if (typeof window !== 'undefined') {
      ttsWorkerRef.current = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' });
      
      ttsWorkerRef.current.onmessage = (e) => {
        if (e.data.type === 'audio' && e.data.buffer) {
          if (!audioContext.current) {
            audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          
          if (audioContext.current.state === 'suspended') {
            audioContext.current.resume();
          }
          
          const buffer = e.data.buffer;
          audioContext.current.decodeAudioData(buffer, (audioBuffer) => {
            const source = audioContext.current!.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.current!.destination);
            source.start(0);
          });
        }
      };
    }

    return () => {
      ttsWorkerRef.current?.terminate();
      if (audioContext.current && audioContext.current.state !== 'closed') {
        audioContext.current.suspend();
      }
    };
  }, []);

  const handleVoiceMessage = (message: string, voice: string | undefined) => {
    ttsWorkerRef.current?.postMessage({ 
      type: 'synthesize', 
      data: message,
      voice,
      speed: 1.2
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-3xl w-full mx-4 sm:mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Change Office Manager</h2>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex flex-wrap justify-center gap-6 mb-6">
          {Object.values(managerProfiles).map((profile: ManagerProfile, index: number) => (
            <div 
              key={index} 
              className={`w-[180px] text-center cursor-pointer transition-all duration-200 ${currentManager?.id === profile.id ? 'scale-105' : 'hover:scale-105'}`}
              onClick={() => onSelect(profile)}
            >
              <img 
                src={profile.avatar} 
                alt={profile.name}
                className={`rounded-full w-full border-4 ${currentManager?.id === profile.id ? 'border-emerald-600 dark:border-emerald-400' : 'border-violet-800/50 dark:border-violet-200/50 hover:border-emerald-600/50 dark:hover:border-emerald-400/50'}`}
                onMouseEnter={() => handleVoiceMessage(profile.greeting, profile.kokoroVoice)}
              />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mt-2">{profile.name}</h3>
            </div>
          ))}
        </div>
        
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors mr-3"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
