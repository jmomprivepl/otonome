import type { KokoroVoiceType } from '@/types/kokoroVoice';

export interface ManagerProfile {
  id: string;
  name: string;
  greeting: string;
  kokoroVoice?: KokoroVoiceType; // voice types with samples available here: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX#samples
  avatar?: string;
}

export const managerProfiles: Record<string, ManagerProfile> = {
  Cristina: {
    id: 'cristina',
    name: 'Cristina',
    greeting: 'Hello, I am Cristina. It is really nice to meet you!',
    kokoroVoice: 'af_heart',
    avatar: '/avatars/office_manager.png'
  },
  Josh: {
    id: 'josh',
    name: 'Josh',
    greeting: 'I am Josh. Are you ready to learn more about Workmates?',
    kokoroVoice: 'am_adam',
    avatar: '/avatars/workmate10.png'
  },
  Julia: {
    id: 'julia',
    name: 'Julia',
    greeting: 'I am Julia. Welcome to Workmates!',
    kokoroVoice: 'af_bella',
    avatar: '/avatars/worker8.png'
  },
  Amanda: {
    id: 'amanda',
    name: 'Amanda',
    greeting: 'I am Amanda. It is so nice to meet you!',
    kokoroVoice: 'af_jessica',
    avatar: '/avatars/workmate23.png'
  },
  Lewis: {
    id: 'lewis',
    name: 'Lewis',
    greeting: 'I am Lewis. I am happy to help you with any tasks or questions you may have.',
    kokoroVoice: 'bm_george',
    avatar: '/avatars/workmate26.png'
  }
};