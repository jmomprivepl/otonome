/** True when running inside the Tauri webview (not a normal browser tab). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getNativeLlmPaths(): { exePath: string; modelPath: string } {
  const exePath =
    (import.meta.env.VITE_LLAMA_CLI_EXE as string | undefined)?.trim() ||
    'qvac-fabric-llm.cpp\\build\\bin\\Release\\llama-cli.exe';
  const modelPath =
    (import.meta.env.VITE_LLAMA_MODEL_PATH as string | undefined)?.trim() ||
    'bitnet-b1.58-2B-4T-gguf\\ms-2b-4t-pure.gguf';
  return { exePath, modelPath };
}

/**
 * Use the llama-cli backend in the Tauri desktop app when paths are configured
 * (default relative paths match a sibling layout under the project root).
 * Set `VITE_USE_NATIVE_LLM=false` to force the browser/ONNX worker instead.
 */
export function shouldUseNativeLlm(): boolean {
  if (!isTauriRuntime()) return false;
  if (import.meta.env.VITE_USE_NATIVE_LLM === 'false') return false;
  const { exePath, modelPath } = getNativeLlmPaths();
  return Boolean(exePath && modelPath);
}
