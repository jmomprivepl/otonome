import type { InferenceEngine, InferenceRequest, InferenceResult } from '@/types/hermesOrchestration';

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 2500;

/** Heuristic: Tauri IPC / local HTTP / model subprocess flakes — retry only these. */
export function isProbablyTransientInvokeFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  const s = String(err).toLowerCase();
  return (
    s.includes('network') ||
    s.includes('timeout') ||
    s.includes('timed out') ||
    s.includes('econnreset') ||
    s.includes('econnrefused') ||
    s.includes('502') ||
    s.includes('503') ||
    s.includes('504') ||
    s.includes('failed to fetch') ||
    s.includes('disconnected') ||
    s.includes('ipc') ||
    s.includes('broken pipe') ||
    s.includes('connection reset') ||
    s.includes('temporarily unavailable')
  );
}

function backoffMs(attemptIndex: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attemptIndex);
}

/**
 * Retries `executeInference` on likely-transient failures (offline-first: no external telemetry).
 * Successful responses are not re-run; only thrown errors trigger backoff.
 */
export function wrapInferenceEngineWithRetry(
  inner: InferenceEngine,
  opts?: { maxAttempts?: number },
): InferenceEngine {
  const maxAttempts = Math.max(1, Math.min(8, opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));

  return {
    async executeInference(req: InferenceRequest): Promise<InferenceResult> {
      const retryTelemetry: string[] = [];
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await inner.executeInference(req);
          if (attempt > 0) {
            retryTelemetry.push(`> inference_retry: ok after ${attempt + 1} attempt(s)`);
          }
          return {
            ...res,
            telemetry: [...retryTelemetry, ...(res.telemetry ?? [])],
          };
        } catch (e) {
          const retryable = attempt < maxAttempts - 1 && isProbablyTransientInvokeFailure(e);
          if (!retryable) throw e;
          const wait = backoffMs(attempt);
          retryTelemetry.push(
            `> inference_retry: attempt ${attempt + 1}/${maxAttempts} failed — ${String(e)} (retry in ${wait}ms)`,
          );
          await new Promise((r) => setTimeout(r, wait));
        }
      }

      throw new Error('wrapInferenceEngineWithRetry: exhausted without result');
    },
  };
}
