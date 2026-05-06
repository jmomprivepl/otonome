import {
  buildLlamaCliTranscript,
  formatLlamaCliContinuingUserLine,
} from '../llm/formatLlamaCliTranscript';
import { getNativeLlmPaths, shouldUseNativeLlm } from '../config/nativeLlm';
import {
  applyAgentModelSampling,
  maxNewTokensFromAgentConfig,
  type AgentModelSamplingOverrides,
} from '../llm/llamaSamplingDefaults';

type NativeLlmPayload =
  | { kind: 'partial'; nodeId: string; text: string }
  | { kind: 'turn_done'; nodeId: string }
  | { kind: 'end'; nodeId: string }
  | { kind: 'error'; nodeId: string; message: string };

class WorkerManager {
  private worker: Worker | null = null;
  private listeners: Map<string, (data: unknown) => void>;
  private isModelLoaded: boolean;
  private modelLoadingPromise: Promise<void> | null;
  private optimalModelId: string | null = null;
  private modelSelectionPromise: Promise<string> | null = null;
  private readonly useNative: boolean;
  private nativeUnlisten: (() => void) | null = null;
  private nativeSessionNodeId: string | null = null;
  private nativeAccText = '';

  constructor() {
    this.listeners = new Map();
    this.isModelLoaded = false;
    this.modelLoadingPromise = null;
    this.useNative = shouldUseNativeLlm();

    if (this.useNative) {
      this.optimalModelId = 'native-llama-cli';
      this.modelSelectionPromise = Promise.resolve('native-llama-cli');
      queueMicrotask(() => {
        console.log('[LLM] Using native llama-cli (Tauri). ONNX/WebGPU worker disabled.');
      });
      queueMicrotask(() => void this.initNativePipeline());
    } else {
      this.modelSelectionPromise = import('./onnxLlmCoordinator')
        .then((mod) => mod.startOnnxLlmBackend(this.handleWorkerMessage.bind(this)))
        .then(({ worker, modelId }) => {
          this.worker = worker;
          this.optimalModelId = modelId;
          console.log(`GPU benchmark complete. Selected model: ${modelId}`);
          return modelId;
        });
    }
  }

  private async initNativePipeline(): Promise<void> {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      this.nativeUnlisten = await listen<NativeLlmPayload>('native-llm', (event) => {
        this.handleNativePayload(event.payload);
      });
    } catch (e) {
      console.error('[LLM] Failed to register native-llm listener:', e);
    }
  }

  private handleNativePayload(p: NativeLlmPayload): void {
    const cb = this.listeners.get(p.nodeId);
    if (!cb) return;

    switch (p.kind) {
      case 'partial':
        this.nativeAccText = p.text;
        cb({ status: 'update', output: p.text, nodeId: p.nodeId });
        break;
      case 'turn_done':
        cb({ status: 'complete', output: this.nativeAccText, nodeId: p.nodeId });
        this.nativeAccText = '';
        break;
      case 'end':
        cb({ status: 'complete', output: this.nativeAccText || '', nodeId: p.nodeId });
        this.nativeAccText = '';
        this.nativeSessionNodeId = null;
        break;
      case 'error':
        cb({ status: 'error', data: p.message, nodeId: p.nodeId });
        this.nativeAccText = '';
        break;
      default:
        break;
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const data = e.data;
    if (data.nodeId && this.listeners.has(data.nodeId)) {
      this.listeners.get(data.nodeId)!(data);
    } else if (data.status === 'loading' || data.status === 'ready') {
      this.listeners.forEach((listener) => listener(data));
    }

    if (data.status === 'ready') {
      this.isModelLoaded = true;
    }
  }

  private async nativeCancel(): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('llama_cli_stop');
    } catch (e) {
      console.warn('[LLM] llama_cli_stop:', e);
    }
    this.nativeSessionNodeId = null;
    this.nativeAccText = '';
  }

  private async runNativeGenerate(nodeId: string, messages: unknown[], modelConfig: Record<string, unknown>): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    const list = messages as Array<{ role: string; content: string }>;
    const last = list[list.length - 1];
    if (!last || last.role !== 'user') return;

    const line = String(last.content ?? '').replace(/\r\n/g, '\n');
    const initialPrompt = buildLlamaCliTranscript(list);
    const { exePath, modelPath } = getNativeLlmPaths();

    const ctxSize = Number(import.meta.env.VITE_LLAMA_CTX_SIZE ?? 4096);

    const mc = modelConfig as AgentModelSamplingOverrides;
    const merged = mc && Object.keys(mc).length > 0 ? mc : undefined;
    const sampling = applyAgentModelSampling(merged);
    const options = {
      exePath,
      modelPath,
      ctxSize,
      ...sampling,
      initialPrompt,
      maxNewTokens: maxNewTokensFromAgentConfig(merged),
    };

    this.listeners.get(nodeId)?.({ status: 'start', nodeId });

    const isNewSession = this.nativeSessionNodeId !== nodeId;
    if (isNewSession) {
      // `initialPrompt` ends with `Assistant: `; never call llama_cli_send_line on the same turn.
      await invoke('llama_cli_start_session', { nodeId, options });
      this.nativeSessionNodeId = nodeId;
      return;
    }

    await invoke('llama_cli_send_line', { line: formatLlamaCliContinuingUserLine(line) });
  }

  registerNode(callback: (data: unknown) => void, nodeId: string): string {
    this.listeners.set(nodeId, callback);
    if (this.isModelLoaded) {
      callback({ status: 'ready', nodeId });
    }
    return nodeId;
  }

  unregisterNode(nodeId: string): void {
    this.listeners.delete(nodeId);
  }

  sendMessage(nodeId: string, message: Record<string, unknown>): void {
    if (this.useNative) {
      if (message.type === 'load') {
        return;
      }
      if (message.type === 'cancel') {
        void this.nativeCancel();
        return;
      }
      if (message.type === 'generate') {
        void this.runNativeGenerate(nodeId, message.messages as unknown[], (message.modelConfig as Record<string, unknown>) ?? {}).catch(
          (err: unknown) => {
            this.listeners.get(nodeId)?.({
              status: 'error',
              data: err instanceof Error ? err.message : String(err),
              nodeId,
            });
          },
        );
      }
      return;
    }

    if (this.worker) {
      this.worker.postMessage({ ...message, nodeId });
    }
  }

  async getOptimalModelId(): Promise<string> {
    if (this.optimalModelId) {
      return this.optimalModelId;
    }
    return this.modelSelectionPromise!;
  }

  loadModel(): Promise<void> {
    if (this.useNative) {
      if (!this.modelLoadingPromise) {
        this.modelLoadingPromise = Promise.resolve().then(() => {
          this.isModelLoaded = true;
          this.listeners.forEach((listener) => listener({ status: 'ready' }));
        });
      }
      return this.modelLoadingPromise;
    }

    if (this.isModelLoaded) {
      return Promise.resolve();
    }
    if (!this.modelLoadingPromise) {
      this.modelLoadingPromise = this.modelSelectionPromise!.then((modelId) => {
        return new Promise<void>((resolve) => {
          const checkModelLoaded = (ev: MessageEvent) => {
            const d = ev.data as { status?: string };
            if (d.status === 'ready') {
              this.worker?.removeEventListener('message', checkModelLoaded);
              resolve();
            }
          };
          this.worker?.addEventListener('message', checkModelLoaded);
          this.worker?.postMessage({
            type: 'load',
            modelId,
          });
        });
      });
    }
    return this.modelLoadingPromise;
  }

  resetWorker(): void {
    if (this.useNative) {
      void this.nativeCancel();
    } else {
      this.isModelLoaded = false;
      this.modelLoadingPromise = null;
      this.worker?.postMessage({ type: 'reset' });
    }
    this.listeners.clear();
  }
}

const workerManager = new WorkerManager();
export default workerManager;
