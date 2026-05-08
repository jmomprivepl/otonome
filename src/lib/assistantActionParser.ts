export type AssistantAction =
  | { kind: 'goto'; screenName: string }
  | {
      kind: 'create_task';
      task: {
        title: string;
        description?: string;
        project?: string;
        status?: string;
      };
    }
  | { kind: 'search'; request: string }
  | { kind: 'getanswer'; request: string }
  | { kind: 'list_records'; request: string }
  | {
      kind: 'decompose_task';
      subtasks: Array<{ title?: string; description?: string; suggestedAgent?: string }>;
    };

export type ParsedAssistantActions = {
  cleanText: string;
  actions: AssistantAction[];
};

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function normalizeActionObject(obj: unknown): AssistantAction | null {
  if (!isRecord(obj)) return null;
  const action = trimString(obj.action);
  if (!action) return null;

  if (action === 'goto') {
    const screenName = trimString(obj.screen_name ?? obj.screenName);
    return screenName ? { kind: 'goto', screenName } : null;
  }

  if (action === 'create_task') {
    const taskRaw = obj.task;
    const taskObj =
      typeof taskRaw === 'string' ? safeJsonParse(taskRaw) : taskRaw;
    if (!isRecord(taskObj)) return null;
    const title = trimString(taskObj.title) ?? trimString(taskRaw);
    if (!title) return null;
    const description = trimString(taskObj.description) ?? undefined;
    const project = trimString(taskObj.project) ?? undefined;
    const status = trimString(taskObj.status) ?? undefined;
    return { kind: 'create_task', task: { title, description, project, status } };
  }

  if (action === 'search' || action === 'getanswer' || action === 'list_records') {
    const request = trimString(obj.request ?? obj.table_id ?? obj.tableId);
    if (!request) return null;
    return { kind: action, request } as AssistantAction;
  }

  if (action === 'decompose_task') {
    const subtasks = obj.subtasks;
    if (!Array.isArray(subtasks)) return null;
    const normalized = subtasks
      .filter((s) => Boolean(s) && typeof s === 'object')
      .map((s) => s as Record<string, unknown>)
      .map((s) => ({
        title: trimString(s.title) ?? undefined,
        description: trimString(s.description) ?? undefined,
        suggestedAgent: trimString(s.suggestedAgent ?? s.suggested_agent) ?? undefined,
      }));
    return { kind: 'decompose_task', subtasks: normalized };
  }

  return null;
}

function stripCodeFences(raw: string): string {
  // Models often wrap JSON in ```json fences; remove them while keeping content.
  return raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * Extracts assistant-emitted action objects from a blob of text.
 *
 * Supported forms:
 * - Pure JSON object (entire payload is JSON)
 * - JSON object embedded in surrounding text
 * - JSON wrapped in ```json fences
 *
 * Intentional constraint: only parses a small set of known action shapes,
 * ignoring arbitrary JSON to keep offline/private behavior predictable.
 */
export function parseAssistantActions(rawText: string): ParsedAssistantActions {
  const raw = typeof rawText === 'string' ? rawText : String(rawText ?? '');
  if (!raw.trim()) return { cleanText: '', actions: [] };

  const actions: AssistantAction[] = [];
  let cleanText = raw;

  // 1) Best case: entire message is a JSON object.
  const fenced = stripCodeFences(raw);
  const wholeObj = safeJsonParse(fenced);
  const normalizedWhole = normalizeActionObject(wholeObj);
  if (normalizedWhole) {
    return { cleanText: '', actions: [normalizedWhole] };
  }

  // 2) Embedded JSON: find candidate objects containing `"action":`.
  // This is deliberately conservative: we don't attempt a full JSON tokenizer;
  // we just locate the smallest `{ ... }` spans that include `"action"`.
  const candidateRegex = /\{[\s\S]*?"action"\s*:\s*"(?:goto|create_task|search|getanswer|list_records|decompose_task)"[\s\S]*?\}/g;
  const matches = [...raw.matchAll(candidateRegex)];
  for (const m of matches) {
    const snippet = stripCodeFences(m[0]);
    const obj = safeJsonParse(snippet);
    const normalized = normalizeActionObject(obj);
    if (!normalized) continue;
    actions.push(normalized);
    cleanText = cleanText.replace(m[0], '').trim();
  }

  // 3) XML-ish goto tags (kept for backward compatibility in the sidebar chat).
  // Example: <action>goto</action><screen_name>tasks</screen_name>
  const actionTagMatch = raw.match(/<action>\s*(goto)\s*<\/action>/i);
  if (actionTagMatch) {
    const screenName = raw.match(/<screen_name>\s*([^<]+?)\s*<\/screen_name>/i)?.[1]?.trim();
    if (screenName) {
      actions.push({ kind: 'goto', screenName });
      cleanText = cleanText.replace(actionTagMatch[0], '').trim();
    }
  }

  return { cleanText: cleanText.trim(), actions };
}

