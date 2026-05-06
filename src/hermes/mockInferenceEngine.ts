import type { InferenceEngine, InferenceRequest, InferenceResult } from '@/types/hermesOrchestration';

const STUB_DELAY_MS = 180;

function stubBody(req: InferenceRequest): string {
  const mode = req.mode;
  const head = req.prompt.slice(0, 80);
  const persona = req.finetunePersonaSystem?.trim();
  const personaNote =
    persona && persona.length > 0 ? `\n(finetune persona: ${persona.length} chars)` : '';
  return `[MockInferenceEngine/${mode}] ${head}${req.prompt.length > 80 ? '…' : ''}\n(context bytes: ${req.context.length})${personaNote}`;
}

/** Deterministic stub engine for tests and non-GPU UX demos. */
export class MockInferenceEngine implements InferenceEngine {
  constructor(private readonly delayMs: number = STUB_DELAY_MS) {}

  async executeInference(req: InferenceRequest): Promise<InferenceResult> {
    await new Promise((r) => window.setTimeout(r, this.delayMs));
    return {
      text: stubBody(req),
      telemetry: [`> mock inference complete (${req.mode})`],
    };
  }
}
