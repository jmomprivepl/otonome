export type HermesRunAgentRequest = {
  /** Empty string allowed; backend selects default model. */
  model: string;
  userPrompt: string;
  /** Optional; backend defaults to 16. */
  maxTurns?: number;
};

import type { InferenceHardwareSnapshot } from '@/types/nsdar';

export type HermesSessionResult = {
  assistantFinal: string;
  turnsUsed: number;
  log: string[];
  inferenceHardware: InferenceHardwareSnapshot;
};

