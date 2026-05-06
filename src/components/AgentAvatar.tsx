import { AgentProfile } from '@/config/agentProfiles';
import { X } from 'lucide-react';

interface AgentAvatarProps {
  agent: AgentProfile;
  draggable?: boolean;
  onRemove?: () => void;
}

export const AgentAvatar = ({ agent, draggable = true, onRemove }: AgentAvatarProps) => {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify(agent));
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="relative group"
    >
      <div 
        className={`w-10 h-10 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} rounded-full flex items-center justify-center 
          shadow-lg transition-all duration-300 hover:scale-110
          border-2 border-gray-100 dark:border-slate-800`}
      >
        <img 
          src={agent.avatar} 
          alt={agent.name} 
          className="w-full h-full object-cover rounded-full"
        />
      </div>
      
      <div className="absolute pointer-events-none opacity-0 group-hover:opacity-100 top-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2 
        px-2 py-1.5 bg-white dark:bg-slate-800 rounded-lg shadow-lg text-xs min-w-max
        border border-violet-100 dark:border-violet-800 transition-opacity duration-200 z-50"
      >
        <div className="font-medium text-gray-800 dark:text-gray-200">{agent.name}</div>
        <div className="text-gray-500 dark:text-gray-400 max-w-[150px]">{agent.description}</div>
      </div>
      
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center
            opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-red-600 z-10"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      )}
    </div>
  );
};