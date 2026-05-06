import { buildFinetunePass2Transcript, buildLlamaCliTranscript } from '@/llm/formatLlamaCliTranscript';
import type { HermesRunAgentRequest, HermesSessionResult } from '@/types/otonome';
import type { InferenceEngine, InferenceRequest, InferenceResult } from '@/types/hermesOrchestration';
import type { NsdarLocalCompleteResponse, NsdarSlotOverride } from '@/types/nsdar';

const NSDAR_LABEL = 'NSDAR';

/** Real local LoFA+QVAC path via `nsdar_local_complete`. */
export function createTauriNsdarInferenceEngine(params: {
  invoke: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
  buildLlama: () => Record<string, unknown>;
  getOverrides: () => NsdarSlotOverride[];
}): InferenceEngine {
  const { invoke, buildLlama, getOverrides } = params;
  return {
    async executeInference(req: InferenceRequest): Promise<InferenceResult> {
      const prompt =
        req.context.trim().length > 0
          ? `${req.prompt}\n\n---\nPrior context:\n${req.context.trim()}`
          : req.prompt;
      const explicit = req.initialPass2Prompt?.trim();
      const persona = req.finetunePersonaSystem?.trim();
      // Same `-p` transcript as `workerManager` / `llama_cli_start_session` (buildLlamaCliTranscript).
      const initialPass2Prompt =
        explicit && explicit.length > 0
          ? explicit
          : persona && persona.length > 0
            ? buildFinetunePass2Transcript(persona, prompt)
            : buildLlamaCliTranscript([{ role: 'user', content: prompt }]);
      const res = await invoke<NsdarLocalCompleteResponse>('nsdar_local_complete', {
        prompt,
        label: NSDAR_LABEL,
        overrides: getOverrides(),
        llama: buildLlama(),
        initialPass2Prompt,
      });
      const telemetry = (res.logLines ?? []).map((l) => (l.startsWith('>') ? l : `> ${l}`));
      if (res.success && res.assistantText) {
        return { text: res.assistantText, telemetry };
      }
      if (res.ambiguity) {
        return {
          text: `Ambiguous adapters: ${res.ambiguity.topAdapters.join(', ')}`,
          telemetry,
        };
      }
      return { text: res.error ?? 'Local inference returned no text.', telemetry };
    },
  };
}

/** Cloud Hermes loop per inference slice (maps to `hermes_run_agent_session`). */
export function createTauriHermesCloudInferenceEngine(params: {
  invoke: <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
  model: string;
  maxTurns: number;
}): InferenceEngine {
  const { invoke, model, maxTurns } = params;
  return {
    async executeInference(req: InferenceRequest): Promise<InferenceResult> {
      const userPrompt =
        req.context.trim().length > 0
          ? `${req.prompt}\n\n---\nContext:\n${req.context.trim()}`
          : req.prompt;
      const body: HermesRunAgentRequest = {
        model,
        userPrompt,
        maxTurns,
      };
      const res = await invoke<HermesSessionResult>('hermes_run_agent_session', body);
      const telemetry = (res.log ?? []).map((l) => (l.startsWith('>') ? l : `> ${l}`));
      return {
        text: res.assistantFinal,
        telemetry,
      };
    },
  };
}
