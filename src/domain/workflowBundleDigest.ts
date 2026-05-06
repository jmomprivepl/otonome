import type { WorkflowBundleGraphPayload } from '@/types/workflowBundle';

/**
 * Stable JSON for hashing: object keys sorted; arrays preserve order (caller should sort if needed).
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t !== 'object') return JSON.stringify(String(value));

  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function bufferToHexLower(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 hex digest of the canonical graph encoding (`nodes` + `edges` only).
 */
export async function computeWorkflowContentDigest(
  graph: WorkflowBundleGraphPayload,
): Promise<string> {
  const canonical = stableStringify({ nodes: graph.nodes, edges: graph.edges });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHexLower(digest);
}

export function isProbableSha256Hex(s: string): boolean {
  return /^[a-f0-9]{64}$/.test(s);
}
