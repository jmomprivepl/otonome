import { agentProfiles } from '@/config/agentProfiles';
import type { AgentDagEdge } from '@/types/agentDag';
import type { PlaygroundDagNode, PlaygroundSubGraph } from '@/types/playgroundWorkflow';
import workerManager from '@/workers/workerManager';

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('No JSON object found in model output');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export type ParsedSubtask = { title: string; description: string };

export function parseDecomposeTaskResponse(text: string): ParsedSubtask[] {
  const obj = extractJsonObject(text) as Record<string, unknown>;
  const raw = obj.subtasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Response missing a non-empty "subtasks" array');
  }
  return raw.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const title = String(row.title ?? row.name ?? `Subtask ${index + 1}`).trim();
    const description = String(row.description ?? row.details ?? '').trim();
    return { title: title || `Step ${index + 1}`, description };
  });
}

const NORM_GAP = 280;

/** Build linear sub-workflow from Task Manager decomposition. */
export function subtasksToSubGraph(subtasks: ParsedSubtask[], parentRaciLayer: PlaygroundDagNode['raciLayer']): PlaygroundSubGraph {
  const ids = subtasks.map((_, idx) =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `tm-sub-${crypto.randomUUID()}`
      : `tm-sub-${Date.now()}-${idx}`,
  );
  const y = parentRaciLayer === 'accountable' ? 140 : parentRaciLayer === 'consulted' ? 280 : parentRaciLayer === 'informed' ? 420 : 0;
  const nodes: PlaygroundDagNode[] = subtasks.map((st, index) => ({
    id: ids[index],
    label: st.title.slice(0, 120),
    prompt: [st.description || st.title, st.description && st.description !== st.title ? `(from decomposition)` : '']
      .filter(Boolean)
      .join('\n\n'),
    executionTarget: 'localQvac',
    requiresSystemTool: false,
    systemToolName: null,
    systemToolArgsSummary: null,
    raciLayer: parentRaciLayer,
    position: { x: 40 + index * NORM_GAP, y },
  }));
  const edges: AgentDagEdge[] = [];
  for (let i = 0; i < ids.length - 1; i += 1) {
    edges.push({
      id: `tm-e-${ids[i]}-${ids[i + 1]}`,
      source: ids[i],
      target: ids[i + 1],
    });
  }
  return { nodes, edges };
}

/**
 * Runs the Task Manager agent (`agentProfiles.taskManager`) to obtain a structured decomposition.
 * Uses shared `workerManager` (native llama-cli in Tauri or ONNX worker in browser).
 */
export async function runTaskManagerDecomposition(args: {
  title: string;
  description: string;
}): Promise<string> {
  await workerManager.loadModel();
  const nodeId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `pg-tm-${crypto.randomUUID()}`
      : `pg-tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const agent = agentProfiles.taskManager;
  const prompt = [
    'Please help to decompose this workflow step into sequential sub-steps.',
    '',
    `Title: ${args.title}`,
    '',
    `Description / instructions:`,
    args.description || '(none)',
    '',
    'Respond ONLY with the JSON specified in your system instructions (single JSON object, no preamble).',
  ].join('\n');

  const messages = [
    { role: 'system', content: agent.systemPrompt },
    { role: 'user', content: prompt },
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    const finalize = () => {
      settled = true;
      workerManager.unregisterNode(nodeId);
    };

    const timeout = window.setTimeout(() => {
      if (!settled) {
        finalize();
        workerManager.sendMessage(nodeId, { type: 'cancel' });
        reject(new Error('Task Manager decomposition timed out'));
      }
    }, 300_000);

    workerManager.registerNode((data: unknown) => {
      const d = data as { status?: string; output?: string; data?: unknown; nodeId?: string };
      if (d.nodeId != null && d.nodeId !== '' && d.nodeId !== nodeId) return;

      switch (d.status) {
        case 'complete':
          if (!settled) {
            clearTimeout(timeout);
            finalize();
            resolve(String(d.output ?? ''));
          }
          break;
        case 'error':
          if (!settled) {
            clearTimeout(timeout);
            finalize();
            reject(new Error(String(d.data ?? 'Worker error')));
          }
          break;
        default:
          break;
      }
    }, nodeId);

    workerManager.sendMessage(nodeId, {
      type: 'generate',
      messages,
      modelConfig: agent.modelConfig ?? { temperature: 0.2, top_k: 3, max_new_tokens: 1024 },
    });
  });
}
