import type { KokoroVoiceType } from '../types/kokoroVoice';

type SpeechWorkerStatus = 'loading' | 'ready' | 'error' | 'chunk' | 'transcription' | 'update';

interface SpeechWorkerMessage {
  status: SpeechWorkerStatus;
  data?: any;
  error?: string;
}

class SpeechWorkerManager {
  private ttsWorker: Worker | null = null;
  private sttWorker: Worker | null = null;
  private ttsListeners: Map<string, (data: any) => void>;
  private sttListeners: Map<string, (data: any) => void>;
  private isTtsLoaded: boolean;
  private isSttLoaded: boolean;
  private ttsLoadingPromise: Promise<void> | null;
  private sttLoadingPromise: Promise<void> | null;
  private initializedComponents: Set<string>;

  constructor() {
    this.ttsListeners = new Map();
    this.sttListeners = new Map();
    this.isTtsLoaded = false;
    this.isSttLoaded = false;
    this.ttsLoadingPromise = null;
    this.sttLoadingPromise = null;
    this.initializedComponents = new Set();
  }

  /** Kokoro / Whisper workers are multi‑MB; create only when TTS/STT is first used. */
  private ensureSpeechWorkers(): void {
    if (this.ttsWorker && this.sttWorker) return;
    this.ttsWorker = new Worker(new URL('./tts.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.sttWorker = new Worker(new URL('./stt.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.ttsWorker.onmessage = this.handleTtsWorkerMessage.bind(this);
    this.sttWorker.onmessage = this.handleSttWorkerMessage.bind(this);
  }

  private handleTtsWorkerMessage(e: MessageEvent) {
    const data = e.data as SpeechWorkerMessage;
    const nodeId = (data as any).nodeId;

    // Route message to specific listener if nodeId is provided
    if (nodeId && this.ttsListeners.has(nodeId)) {
      this.ttsListeners.get(nodeId)!(data);
    } else {
      // Broadcast to all listeners
      this.ttsListeners.forEach(listener => listener(data));
    }
    
    // Update loading state
    if (data.status === 'ready') {
      this.isTtsLoaded = true;
    }
  }

  private handleSttWorkerMessage(e: MessageEvent) {
    const data = e.data as SpeechWorkerMessage;
    const nodeId = (data as any).nodeId;

    // Route message to specific listener if nodeId is provided
    if (nodeId && this.sttListeners.has(nodeId)) {
      this.sttListeners.get(nodeId)!(data);
    } else {
      // Broadcast to all listeners
      this.sttListeners.forEach(listener => listener(data));
    }
    
    // Update loading state
    if (data.status === 'ready') {
      this.isSttLoaded = true;
    }
  }

  // Check if a component has already been initialized
  isComponentInitialized(componentId: string): boolean {
    return this.initializedComponents.has(componentId);
  }

  // Mark a component as initialized
  markComponentInitialized(componentId: string): void {
    this.initializedComponents.add(componentId);
  }

  // Register a listener for TTS worker messages
  registerTtsListener(callback: (data: any) => void, nodeId: string): string {
    this.ttsListeners.set(nodeId, callback);
    
    // If TTS is already loaded, immediately send ready status to new listener
    if (this.isTtsLoaded) {
      callback({ status: 'ready', nodeId });
    }
    
    // Mark this component as having registered a TTS listener
    this.markComponentInitialized(nodeId);
    
    return nodeId;
  }

  // Register a listener for STT worker messages
  registerSttListener(callback: (data: any) => void, nodeId: string): string {
    this.sttListeners.set(nodeId, callback);
    
    // If STT is already loaded, immediately send ready status to new listener
    if (this.isSttLoaded) {
      callback({ status: 'ready', nodeId });
    }
    
    // Mark this component as having registered an STT listener
    this.markComponentInitialized(nodeId);
    
    return nodeId;
  }

  // Unregister a TTS listener
  unregisterTtsListener(nodeId: string): void {
    this.ttsListeners.delete(nodeId);
    
    // If both TTS and STT listeners are unregistered, remove from initialized components
    if (!this.ttsListeners.has(nodeId) && !this.sttListeners.has(nodeId)) {
      this.initializedComponents.delete(nodeId);
    }
  }

  // Unregister an STT listener
  unregisterSttListener(nodeId: string): void {
    this.sttListeners.delete(nodeId);
    
    // If both TTS and STT listeners are unregistered, remove from initialized components
    if (!this.ttsListeners.has(nodeId) && !this.sttListeners.has(nodeId)) {
      this.initializedComponents.delete(nodeId);
    }
  }

  // Send a message to the TTS worker
  sendTtsMessage(message: any, nodeId?: string): void {
    this.ensureSpeechWorkers();
    this.ttsWorker!.postMessage(nodeId ? { ...message, nodeId } : message);
  }

  // Send a message to the STT worker
  sendSttMessage(message: any, nodeId?: string): void {
    this.ensureSpeechWorkers();
    this.sttWorker!.postMessage(nodeId ? { ...message, nodeId } : message);
  }

  // Load the TTS model with optional voice parameter
  loadTts(voice?: KokoroVoiceType): Promise<void> {
    if (this.isTtsLoaded) {
      return Promise.resolve();
    }
    
    if (!this.ttsLoadingPromise) {
      this.ensureSpeechWorkers();
      const w = this.ttsWorker!;
      this.ttsLoadingPromise = new Promise((resolve) => {
        const checkTtsLoaded = (e: MessageEvent) => {
          const data = e.data as SpeechWorkerMessage;
          if (data.status === 'ready') {
            w.removeEventListener('message', checkTtsLoaded);
            resolve();
          }
        };
        
        w.addEventListener('message', checkTtsLoaded);
        w.postMessage({ 
          type: 'load',
          voice
        });
      });
    }
    
    return this.ttsLoadingPromise;
  }

  // Load the STT model
  loadStt(model?: string): Promise<void> {
    if (this.isSttLoaded) {
      return Promise.resolve();
    }
    
    if (!this.sttLoadingPromise) {
      this.ensureSpeechWorkers();
      const w = this.sttWorker!;
      this.sttLoadingPromise = new Promise((resolve) => {
        const checkSttLoaded = (e: MessageEvent) => {
          const data = e.data as SpeechWorkerMessage;
          if (data.status === 'ready') {
            w.removeEventListener('message', checkSttLoaded);
            resolve();
          }
        };
        
        w.addEventListener('message', checkSttLoaded);
        w.postMessage({ 
          type: 'load',
          model
        });
      });
    }
    
    return this.sttLoadingPromise;
  }

  // Synthesize text to speech
  synthesizeText(text: string, voice?: KokoroVoiceType, speed?: number, nodeId?: string): void {
    this.sendTtsMessage({
      type: 'synthesize',
      data: text,
      voice,
      speed
    }, nodeId);
  }

  // Transcribe audio to text
  transcribeAudio(audio: Float32Array, language: string = 'en', nodeId?: string): void {
    this.sendSttMessage({
      type: 'transcribe',
      audio,
      language,
      subtask: 'transcribe'
    }, nodeId);
  }

  // Reset the TTS worker
  resetTts(): void {
    this.isTtsLoaded = false;
    this.ttsLoadingPromise = null;
    this.ttsListeners.clear();
    if (this.ttsWorker) {
      this.ttsWorker.postMessage({ type: 'load' });
    }
  }

  // Reset the STT worker
  resetStt(): void {
    this.isSttLoaded = false;
    this.sttLoadingPromise = null;
    this.sttListeners.clear();
    if (this.sttWorker) {
      this.sttWorker.postMessage({ type: 'load' });
    }
  }
}

// Create a singleton instance
const speechWorkerManager = new SpeechWorkerManager();
export default speechWorkerManager;
