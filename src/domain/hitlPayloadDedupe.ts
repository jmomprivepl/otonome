/**
 * Detect identical HITL payloads re-emitted by Tauri (retry, duplicate events).
 * Offline-only: no network; used to avoid redundant store updates / modal churn.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function isIdenticalHitlPayload<T>(previous: T | null, incoming: T): boolean {
  if (previous === null) return false;
  return stableStringify(previous) === stableStringify(incoming);
}
