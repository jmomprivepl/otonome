/**
 * Hermes orchestration + inference contracts (frontend).
 *
 * @see Flow: UserRequest → Hermes → routeIntent → SOP | SubAgent | Direct → InferenceEngine → output
 *
 * ```mermaid
 * flowchart TD
 *   userReq[UserRequest]
 *   hermes[HermesOrchestrator]
 *   intent[IntentRouter]
 *   sopReg[SOPRegistry]
 *   agentReg[SubAgentRegistry]
 *   branch{Route}
 *   sopRun[SOPRunner_sequentialSteps]
 *   subRun[SubAgentRunner]
 *   directRun[DirectInference]
 *   engine[InferenceEngine_LoFA_QVAC]
 *   out[AssistantOutput_and_UIState]
 *   userReq --> hermes
 *   hermes --> intent
 *   intent --> sopReg
 *   intent --> agentReg
 *   intent --> branch
 *   branch -->|SOP_match| sopRun
 *   branch -->|specialist| subRun
 *   branch -->|general| directRun
 *   sopRun -->|per_step| engine
 *   subRun --> engine
 *   directRun --> engine
 *   engine --> out
 *   sopRun --> out
 * ```
 */

export type HermesPhase =
  | 'idle'
  | 'understanding_intent'
  | 'sop_running'
  | 'delegating_sub_agent'
  | 'direct_inference'
  | 'error';

export type SopStepRunStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SopStepDescriptor {
  id: string;
  label: string;
}

/** Registry SOP (scaffold); distinct from `NormalizedSop` in agentDag. */
export interface HermesSopDefinition {
  id: string;
  title: string;
  steps: SopStepDescriptor[];
}

export interface SubAgentDescriptor {
  id: string;
  name: string;
  /** Short domain label for UX, e.g. "Financial". */
  domainTags: string[];
  systemPreamble?: string;
}

export interface TaskContext {
  userPrompt: string;
  /** When set, NSDAR Pass 2 merges this persona into the system block (finetuning / agent profile). */
  finetunePersonaSystem?: string | null;
  threadId?: string;
  attachmentsMeta?: Record<string, unknown>;
  /** Links a DAG workflow run back to the Kanban task (optional). */
  taskId?: string;
}

export type InferenceMode = 'sop_step' | 'sub_agent' | 'direct';

export interface InferenceRequest {
  prompt: string;
  context: string;
  mode: InferenceMode;
  metadata?: Record<string, unknown>;
  /**
   * When set (non-empty after trim), local NSDAR Pass 2 uses `buildFinetunePass2Transcript` for this slice.
   * Ignored by cloud Hermes engine.
   */
  finetunePersonaSystem?: string | null;
  /**
   * Optional full llama-cli `-p` transcript for Pass 2 (`System:` … `Assistant: `). When unset, the
   * local NSDAR engine builds the same transcript as the Agents page (`buildLlamaCliTranscript` with
   * one User turn). Pass 1 routing still uses merged `prompt` / `context` only.
   */
  initialPass2Prompt?: string | null;
}

export interface InferenceResult {
  text: string;
  telemetry?: string[];
}

export interface InferenceEngine {
  executeInference(req: InferenceRequest): Promise<InferenceResult>;
}

/** Per-step checklist row for SOP runs. */
export interface SopExecutionStepState {
  id: string;
  label: string;
  status: SopStepRunStatus;
  index: number;
  total: number;
}

export interface HermesUiSnapshot {
  phase: HermesPhase;
  headline: string;
  sopSteps: SopExecutionStepState[] | null;
}

export type RouteDecision =
  | { kind: 'sop'; sopId: string }
  | { kind: 'sub_agent'; agentId: string }
  | { kind: 'direct' };

export type HermesTraceEvent =
  | { type: 'log'; message: string }
  | { type: 'route'; decision: RouteDecision };

/** Output of `platformContracts.decideRoute` (Phase 1 classifier), surfaced in UI for SOP vs ad-hoc demos. */
export interface PlatformRouteSnapshot {
  mode: 'sop' | 'adhoc';
  confidence: number;
  rationaleTrace: string[];
  sopBundleId?: string;
  sopVersion?: string;
}

export interface HermesOrchestrationResult {
  finalText: string;
  trace: HermesTraceEvent[];
  route: RouteDecision;
  /** Number of `InferenceEngine.executeInference` invocations (SOP = one per step). */
  inferenceCallCount: number;
  platformRoute: PlatformRouteSnapshot;
}
