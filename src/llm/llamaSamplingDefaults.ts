/**
 * Single source of truth for the sampling values sent to **both** subprocess `llama-cli`
 * (`llama_cli::spawn_llama_cli{,_oneshot}`) and in-process Pass 2
 * (`otonome_llm::run_pass2_qvac`, `QvacDualPassSession::run_pass2`).
 *
 * **Must match** the `DEFAULT_LLAMA_*` constants in `src-tauri/src/llama_cli.rs` exactly
 * (same numeric values), so the UI, Rust subprocess flags, and Rust in-process sampler all agree.
 */

import { LLAMA_CLI_REVERSE_PROMPT } from './formatLlamaCliTranscript';

export interface LlamaSamplingOptions {
  temp: number;
  topK: number;
  topP: number;
  /**
   * `min_p` keeps only tokens whose probability is at least `min_p × max_prob`. Critical for
   * parity with `llama-cli` (default 0.05): without it, the long tail surviving `top_p` can
   * derail free-form generation into degenerate token loops.
   */
  minP: number;
  repeatPenalty: number;
  repeatLastN: number;
  reversePrompt: string;
}

export const DEFAULT_LLAMA_SAMPLING: LlamaSamplingOptions = {
  temp: 0.7,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  repeatPenalty: 1.1,
  repeatLastN: 64,
  reversePrompt: LLAMA_CLI_REVERSE_PROMPT,
};

/**
 * Snake-case shape consumed by Tauri commands (matches `LlamaCliStartOptions` field renames).
 * Always spread this into the `options` payload so both Rust spawn and in-process Pass 2 receive
 * the same numbers.
 */
export function defaultLlamaSamplingPayload() {
  return {
    temp: DEFAULT_LLAMA_SAMPLING.temp,
    topK: DEFAULT_LLAMA_SAMPLING.topK,
    topP: DEFAULT_LLAMA_SAMPLING.topP,
    minP: DEFAULT_LLAMA_SAMPLING.minP,
    repeatPenalty: DEFAULT_LLAMA_SAMPLING.repeatPenalty,
    repeatLastN: DEFAULT_LLAMA_SAMPLING.repeatLastN,
    reversePrompt: DEFAULT_LLAMA_SAMPLING.reversePrompt,
  };
}

/** Same shape as `AgentProfile.modelConfig` (snake_case in JSON / worker messages). */
export type AgentModelSamplingOverrides = {
  temperature?: number;
  top_k?: number;
  top_p?: number;
  min_p?: number;
  repeat_penalty?: number;
  repeat_last_n?: number;
  max_new_tokens?: number;
};

/**
 * Merge per-agent `modelConfig` into canonical defaults so **NSDAR in-process** and
 * **Agents → `llama-cli`** use identical numbers when the same agent is selected.
 */
export function applyAgentModelSampling(overrides?: AgentModelSamplingOverrides | null) {
  const base = defaultLlamaSamplingPayload();
  if (!overrides) return base;
  return {
    ...base,
    temp: typeof overrides.temperature === 'number' ? overrides.temperature : base.temp,
    topK: typeof overrides.top_k === 'number' ? overrides.top_k : base.topK,
    topP: typeof overrides.top_p === 'number' ? overrides.top_p : base.topP,
    minP: typeof overrides.min_p === 'number' ? overrides.min_p : base.minP,
    repeatPenalty:
      typeof overrides.repeat_penalty === 'number' ? overrides.repeat_penalty : base.repeatPenalty,
    repeatLastN:
      typeof overrides.repeat_last_n === 'number' ? overrides.repeat_last_n : base.repeatLastN,
    reversePrompt: base.reversePrompt,
  };
}

/** `max_new_tokens` for `-n` / `run_pass2_qvac`; agents often cap this (e.g. navigator `256`). */
export function maxNewTokensFromAgentConfig(
  overrides?: AgentModelSamplingOverrides | null,
  fallback = 1024,
): number {
  return typeof overrides?.max_new_tokens === 'number' ? overrides.max_new_tokens : fallback;
}
