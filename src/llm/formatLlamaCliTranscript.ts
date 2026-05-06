/**
 * Llama / BitNet instruct-style transcript: `System:` / `User:` / `Assistant:` + `<|eot_id|>` per closed turn.
 * Matches common Jinja chat templates; `-r "<|eot_id|>"` and `--special` make the token visible on stdout.
 */

/** Same string as `llama-cli -r` / `LlamaCliStartOptions.reverse_prompt` defaults in Rust. */
export const LLAMA_CLI_REVERSE_PROMPT = '<|eot_id|>';

/**
 * Default `System:` body for Agents / NSDAR / Tasks.
 * **Must match** `DEFAULT_WORKMATE_SYSTEM_PROMPT` in `src-tauri/src/llama_cli.rs` exactly.
 */
export const DEFAULT_SYSTEM = `You are Workmate Manager. Use JSON for app actions. Use brief text for casual chat.
Screens: /tasks, /agents, /data, /settings, /agent-sop, /playground

Example Input: go to tasks
Example Output: {"action": "goto", "screen_name": "/tasks"}

Example Input: create task [title]
Example Output: {"action": "create_task", "task": {"title": "[title]", "description": ""}}

Example Input: I want to write a LinkedIn post tomorrow
Example Output: {"action": "create_task", "task": {"title": "Write LinkedIn post", "description": "Tomorrow"}}

Example Input: what is your name?
Example Output: I am Workmate Manager. How can I help you today?`;

/**
 * After `DEFAULT_SYSTEM`, when agent / finetune persona text is included (native `llama-cli` `-p` and
 * in-process Pass 2). Keeps one consistent delimiter for subprocess and NSDAR Hermes paths.
 */
export const AGENT_INSTRUCTIONS_LEADER = '\n\n--- Agent instructions ---\n\n';

/**
 * Build the full `-p` transcript for one generation turn.
 *
 * All `role: system` turns are concatenated **into** the initial `System:` block after
 * [`DEFAULT_SYSTEM`] (separated by [`AGENT_INSTRUCTIONS_LEADER`]), so specialist prompts (e.g. Task
 * Manager `decompose_task` JSON) reach the model. User / assistant rows follow as separate turns.
 */
export function buildLlamaCliTranscript(
  messages: Array<{ role: string; content: string }>,
): string {
  const systemParts: string[] = [];
  for (const m of messages) {
    if (m.role !== 'system') continue;
    const t = String(m.content ?? '').trim();
    if (t) systemParts.push(t);
  }
  const mergedSystem =
    systemParts.length > 0
      ? `${DEFAULT_SYSTEM}${AGENT_INSTRUCTIONS_LEADER}${systemParts.join('\n\n')}`
      : DEFAULT_SYSTEM;

  let out = `System: ${mergedSystem}<|eot_id|>`;

  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'Assistant' : 'User';
    const text = String(m.content ?? '').trim();
    out += `${role}: ${text}<|eot_id|>`;
  }

  out += 'Assistant: ';
  return out;
}

/**
 * Pass-2 transcript for finetuning preview and NSDAR `finetunePersonaSystem`: same structure as
 * [`buildLlamaCliTranscript`] with one logical system block (Workmate + persona).
 */
export function buildFinetunePass2Transcript(personaSystem: string, userContent: string): string {
  const persona = personaSystem.trim();
  const user = String(userContent ?? '').trim();
  const systemBlock = `${DEFAULT_SYSTEM}${AGENT_INSTRUCTIONS_LEADER}${persona}`;
  return `System: ${systemBlock}<|eot_id|>User: ${user}<|eot_id|>Assistant: `;
}

/**
 * Continuation chunk for stdin on later turns (same llama-cli `-i` session).
 */
export function formatLlamaCliContinuingUserLine(userContent: string): string {
  const text = String(userContent ?? '').trim();
  return `User: ${text}<|eot_id|>Assistant: `;
}
