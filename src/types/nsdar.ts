/** Matches Rust `InferenceHardwareSnapshot` (camelCase). */
export type InferenceHardwareSnapshot = {
  profile: string;
  otonomeNGpuLayers: string | null;
  ggmlVkVisibleDevices: string | null;
  llamaBuild: string;
};

export function formatInferenceHardwareLine(h: InferenceHardwareSnapshot | undefined): string {
  if (!h) return '> Inference hardware: (unknown)';
  const layers = h.otonomeNGpuLayers ?? '—';
  const vk = h.ggmlVkVisibleDevices ?? '—';
  return `> Inference hardware: ${h.profile} · ${h.llamaBuild} · OTONOME_N_GPU_LAYERS=${layers} · GGML_VK_VISIBLE_DEVICES=${vk}`;
}

/** Matches Rust `NsdarSlotOverride` (camelCase). */
export type NsdarSlotOverride = {
  index: number;
  value: -1 | 0 | 1;
  locked: boolean;
};

export type RouteOutcome = {
  adapterId: string;
  score: number;
  runnerUpAdapterId: string | null;
  runnerUpScore: number | null;
};

export type Ambiguity = {
  topAdapters: string[];
  scores: number[];
};

export type NsdarRoutePreviewResponse = {
  /** Ternary coefficients; length matches Rust `TERNARY_VECTOR_LEN` (32). */
  vector: number[];
  elapsedMs: number;
  route: RouteOutcome | null;
  ambiguity: Ambiguity | null;
  /** Optional engine log lines (Pass 1) when running with `llama_cpp`. */
  logLines?: string[];
  inferenceHardware: InferenceHardwareSnapshot;
};

export type NsdarLocalCompleteResponse = {
  success: boolean;
  assistantText: string | null;
  logLines: string[];
  route: RouteOutcome | null;
  ambiguity: Ambiguity | null;
  error: string | null;
  inferenceHardware: InferenceHardwareSnapshot;
};
