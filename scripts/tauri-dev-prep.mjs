/**
 * Stops a previous Tauri dev build on Windows so Cargo can overwrite app.exe.
 * No-op on other platforms and if the process is not running.
 */
import { execSync } from 'node:child_process';

if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM app.exe', { stdio: 'ignore' });
  } catch {
    /* not running or access denied — continue */
  }
}
