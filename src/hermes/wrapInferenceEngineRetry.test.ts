import { describe, expect, it, vi } from 'vitest';
import type { InferenceEngine, InferenceRequest } from '@/types/hermesOrchestration';
import { isProbablyTransientInvokeFailure, wrapInferenceEngineWithRetry } from './wrapInferenceEngineRetry';

const minimalReq: InferenceRequest = {
  prompt: 'hi',
  context: '',
  mode: 'direct',
};

describe('isProbablyTransientInvokeFailure', () => {
  it('returns true for common IPC/network strings', () => {
    expect(isProbablyTransientInvokeFailure(new Error('network timeout'))).toBe(true);
    expect(isProbablyTransientInvokeFailure(new Error('ECONNRESET'))).toBe(true);
    expect(isProbablyTransientInvokeFailure(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('returns false for AbortError', () => {
    expect(isProbablyTransientInvokeFailure(new DOMException('aborted', 'AbortError'))).toBe(false);
  });

  it('returns false for arbitrary logic errors', () => {
    expect(isProbablyTransientInvokeFailure(new Error('undefined is not a function'))).toBe(false);
  });
});

describe('wrapInferenceEngineWithRetry', () => {
  it('retries then returns merged telemetry', async () => {
    vi.useFakeTimers();
    try {
      const inner: InferenceEngine = {
        executeInference: vi
          .fn()
          .mockRejectedValueOnce(new Error('network timeout'))
          .mockResolvedValueOnce({ text: 'done', telemetry: ['> ok'] }),
      };
      const wrapped = wrapInferenceEngineWithRetry(inner, { maxAttempts: 3 });
      const p = wrapped.executeInference(minimalReq);
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.text).toBe('done');
      expect(inner.executeInference).toHaveBeenCalledTimes(2);
      expect(res.telemetry?.some((l) => l.includes('inference_retry'))).toBe(true);
      expect(res.telemetry?.some((l) => l.includes('ok after 2'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry non-transient errors', async () => {
    const inner: InferenceEngine = {
      executeInference: vi.fn().mockRejectedValue(new Error('syntax error in your prompt')),
    };
    const wrapped = wrapInferenceEngineWithRetry(inner, { maxAttempts: 3 });
    await expect(wrapped.executeInference(minimalReq)).rejects.toThrow('syntax error');
    expect(inner.executeInference).toHaveBeenCalledTimes(1);
  });
});
