import { useCallback, useReducer } from 'react';
import { handleUserRequest, type WorkflowBundleStoreSlice } from '@/hermes/handleUserRequest';
import type { PersistedWorkflowSop } from '@/hermes/workflowDag';
import type {
  HermesOrchestrationResult,
  HermesTraceEvent,
  HermesUiSnapshot,
  InferenceEngine,
  TaskContext,
} from '@/types/hermesOrchestration';

const idleSnapshot: HermesUiSnapshot = {
  phase: 'idle',
  headline: 'Awaiting input…',
  sopSteps: null,
  platformRoute: null,
};

type OrchestrationState = {
  snapshot: HermesUiSnapshot;
  busy: boolean;
  trace: HermesTraceEvent[];
};

const initialState: OrchestrationState = {
  snapshot: idleSnapshot,
  busy: false,
  trace: [],
};

type Action =
  | { type: 'START_REQUEST' }
  | { type: 'SET_SNAPSHOT'; snapshot: HermesUiSnapshot }
  | { type: 'DONE'; result: HermesOrchestrationResult };

function reduce(state: OrchestrationState, action: Action): OrchestrationState {
  switch (action.type) {
    case 'START_REQUEST':
      return { ...state, busy: true, trace: [] };
    case 'SET_SNAPSHOT':
      return { ...state, snapshot: action.snapshot };
    case 'DONE':
      return {
        ...state,
        busy: false,
        snapshot: idleSnapshot,
        trace: action.result.trace,
      };
    default:
      return state;
  }
}

export type UseHermesOrchestrationOptions = {
  getPersistedWorkflowSops?: () => PersistedWorkflowSop[];
  getWorkflowBundleContext?: () => WorkflowBundleStoreSlice;
};

export function useHermesOrchestration(
  engine: InferenceEngine,
  options?: UseHermesOrchestrationOptions,
) {
  const [state, dispatch] = useReducer(reduce, initialState);

  const runUserPrompt = useCallback(
    async (task: TaskContext): Promise<HermesOrchestrationResult> => {
      dispatch({ type: 'START_REQUEST' });
      try {
        const result = await handleUserRequest(task, {
          engine,
          onProgress: (snap) => dispatch({ type: 'SET_SNAPSHOT', snapshot: snap }),
          getPersistedWorkflowSops: options?.getPersistedWorkflowSops,
          getWorkflowBundleContext: options?.getWorkflowBundleContext,
        });
        dispatch({ type: 'DONE', result });
        return result;
      } catch (e) {
        const err = String(e);
        const fallback: HermesOrchestrationResult = {
          finalText: `Error: ${err}`,
          trace: [{ type: 'log', message: `> error: ${err}` }],
          route: { kind: 'direct' },
          inferenceCallCount: 0,
          platformRoute: {
            mode: 'adhoc',
            confidence: 0,
            rationaleTrace: ['unreachable: orchestration wrapper error before classification'],
          },
        };
        dispatch({ type: 'DONE', result: fallback });
        return fallback;
      }
    },
    [engine, options?.getPersistedWorkflowSops, options?.getWorkflowBundleContext],
  );

  return {
    snapshot: state.snapshot,
    busy: state.busy,
    trace: state.trace,
    runUserPrompt,
  };
}
