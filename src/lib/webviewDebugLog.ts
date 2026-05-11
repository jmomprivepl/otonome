import { isTauriRuntime } from '@/config/nativeLlm';

/** Emit a line to the Tauri host process stderr via Rust (`eprintln!`). Surfaces in the same terminal as `tauri dev`. */
export async function webviewDebugLog(message: string, data?: Record<string, unknown>): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('webview_debug_log', {
      payload: {
        message,
        dataJson: JSON.stringify(data ?? {}),
      },
    });
  } catch (e) {
    console.error('[webviewDebugLog] invoke failed — check Rust handler webview_debug_log', message, e);
  }
}
